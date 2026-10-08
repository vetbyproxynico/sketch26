import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env';
import { createLlmProvider } from '../llm/factory';
import { createQlooClient } from '../qloo/from-env';
import { rateLimit } from '../ratelimit';
import { isRecord } from '../util';
import { createModelAdvisor } from './agent';
import { applyFeedback, buildPlan, candidatePool, chooseProgramme, filterMap, filterRoom, filterTags, scoreRoom } from './plan';
import type { TasteSource, Wordsmith } from './ports';
import { createTasteSource } from './qloo';
import { scoreRoomMembers } from './room-scoring';
import type { MapWarning, Profile, RoomProgramme, TagRef } from './types';
import {
  parseCountry,
  parseCulturalMap,
  parseDays,
  parseFeedback,
  parseIntakeText,
  parseNames,
  parsePlan,
  parseProfile,
  parseRoom,
} from './validate';
import { createWordsmith, fallbackDressings, fallbackIntake, fallbackNote, fallbackSharedGround } from './words';

/** Largest request body accepted. A room of eight maps fits comfortably. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Shared ground is asked for at most this many pairs of residents. */
const MAX_SHARED_PAIRS = 3;
const MAX_SHARED_TAGS = 8;

/** A wordsmith that uses only the deterministic fallbacks, for when no model is configured. */
const plainWordsmith: Wordsmith = {
  parseIntake: (text) => Promise.resolve(fallbackIntake(text)),
  dressSessions: (drafts) => Promise.resolve(fallbackDressings(drafts)),
  readNote: () => Promise.resolve(fallbackNote()),
  describeSharedGround: (tags, nicknames) => Promise.resolve(fallbackSharedGround(tags, nicknames)),
};

function wordsmithFor(env: Env): Wordsmith {
  try {
    return createWordsmith(createLlmProvider(env));
  } catch {
    // No model configured: the app still works, with plainer wording.
    return plainWordsmith;
  }
}

/**
 * One taste source per request, so its trace covers just this request. When a
 * model is configured it advises the map builder on its next question; with no
 * model the builder decides by its fixed rules.
 */
function tasteFor(env: Env): TasteSource {
  const client = createQlooClient(env);
  try {
    return createTasteSource(client, { advisor: createModelAdvisor(createLlmProvider(env)) });
  } catch {
    // No model configured: the rule advisor, which is the default.
    return createTasteSource(client);
  }
}

async function body(request: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new HTTPException(400, { message: 'The request body must be JSON.' });
  }
  if (!isRecord(parsed)) throw new HTTPException(400, { message: 'The request body must be a JSON object.' });
  return parsed;
}

/** Tags shared between the first few pairs of residents, most widely shared first. */
async function sharedTags(taste: TasteSource, profiles: readonly Profile[]): Promise<TagRef[]> {
  const pairs: Array<[Profile, Profile]> = [];
  for (let i = 0; i < profiles.length && pairs.length < MAX_SHARED_PAIRS; i += 1) {
    for (let j = i + 1; j < profiles.length && pairs.length < MAX_SHARED_PAIRS; j += 1) {
      const a = profiles[i];
      const b = profiles[j];
      if (a && b) pairs.push([a, b]);
    }
  }
  const results = await Promise.all(pairs.map(([a, b]) => taste.sharedGround(a, b)));

  const counts = new Map<string, { tag: TagRef; count: number }>();
  for (const tags of results) {
    for (const tag of tags) {
      const seen = counts.get(tag.id);
      if (seen) seen.count += 1;
      else counts.set(tag.id, { tag, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((x, y) => y.count - x.count)
    .slice(0, MAX_SHARED_TAGS)
    .map(({ tag }) => tag);
}

export function registerEncoreRoutes(app: Hono<{ Bindings: Env }>): void {
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: 'The request is too large.' });
    },
  });
  // Per-visitor request budgets, checked before anything is read or paid for.
  app.post('/api/*', rateLimit());
  for (const path of ['/api/intake', '/api/resolve', '/api/map', '/api/plan', '/api/feedback', '/api/room']) {
    app.use(path, limit);
  }

  app.post('/api/intake', async (c) => {
    const text = parseIntakeText((await body(c.req))['text']);
    return c.json({ input: await wordsmithFor(c.env).parseIntake(text) });
  });

  app.post('/api/resolve', async (c) => {
    const request = await body(c.req);
    const names = parseNames(request['names']);
    const country = parseCountry(request['country']);
    const taste = tasteFor(c.env);
    const favourites = await taste.resolve(names, country === undefined ? undefined : { country });
    return c.json({ favourites, trace: taste.trace() });
  });

  app.post('/api/map', async (c) => {
    const profile = parseProfile((await body(c.req))['profile']);
    const taste = tasteFor(c.env);
    // Avoided items never reach the map: the filter runs on what Qloo returned.
    const { map } = filterMap(await taste.culturalMap(profile), profile);
    return c.json({ map, trace: taste.trace() });
  });

  app.post('/api/plan', async (c) => {
    const request = await body(c.req);
    const profile = parseProfile(request['profile']);
    const days = parseDays(request['days']);
    // The map came from the browser, so it is filtered again rather than trusted to be clean.
    const { map, warnings } = filterMap(parseCulturalMap(request['map']), profile);
    const plan = await buildPlan(profile, map, wordsmithFor(c.env), days === undefined ? {} : { days });
    return c.json({ plan, warnings });
  });

  app.post('/api/feedback', async (c) => {
    const request = await body(c.req);
    const profile = parseProfile(request['profile']);
    const plan = parsePlan(request['plan']);
    const feedback = parseFeedback(request['feedback']);
    // The previous map is validated because the contract sends it, then replaced.
    parseCulturalMap(request['map']);

    const taste = tasteFor(c.env);
    const wordsmith = wordsmithFor(c.env);
    const session = plan.sessions.find((s) => s.id === feedback.sessionId);
    const noted =
      feedback.note === undefined || session === undefined
        ? fallbackNote()
        : await wordsmith.readNote(
            feedback.note,
            session.items.map(({ item }) => item),
          );

    // The note may have added to the avoid list, so the new map is filtered with the updated profile.
    const outcome = applyFeedback(profile, plan, feedback, noted.avoidNotes);
    const { map } = filterMap(await taste.culturalMap(outcome.profile), outcome.profile);
    const next = await buildPlan(outcome.profile, map, wordsmith, { days: Math.max(1, plan.sessions.length) });
    return c.json({ profile: outcome.profile, map, plan: next, changes: outcome.changes, trace: taste.trace() });
  });

  app.post('/api/room', async (c) => {
    const request = await body(c.req);
    const parsed = parseRoom(request['profiles'], request['maps']);
    const { profiles } = parsed;
    const taste = tasteFor(c.env);
    const wordsmith = wordsmithFor(c.env);

    // Whatever any resident must avoid is left out for the whole room, whatever the maps say.
    const left = filterRoom(profiles, parsed.maps);
    const maps = left.maps;
    const candidates = candidatePool(maps);
    const warnings: MapWarning[] = [...left.warnings];
    if (candidates.length === 0 && left.warnings.length === 0) {
      warnings.push({ code: 'empty', message: 'There is nothing to choose from yet: build a map for each person first.' });
    }

    const entities = candidates.map((candidate) => candidate.entity);
    // A person Qloo could not score is scored from their own map and named in a
    // warning; an error is answered only when scoring failed for everyone.
    const [scoring, tags] = await Promise.all([scoreRoomMembers(taste, profiles, maps, entities), sharedTags(taste, profiles)]);
    warnings.push(...scoring.warnings);
    const roomScores = scoreRoom(profiles, candidates, scoring.scores);
    const programme: RoomProgramme = {
      items: chooseProgramme(profiles, maps, candidates, roomScores),
      sharedGround: await wordsmith.describeSharedGround(
        filterTags(profiles, tags),
        profiles.map((profile) => profile.nickname),
      ),
      warnings,
    };
    return c.json({ programme, trace: taste.trace() });
  });
}
