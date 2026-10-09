// Sample mode. Used when the live taste service is not connected, or when the
// page is opened with ?sample=1. Every route returns data in the shapes of
// src/encore/types.ts. Everything here is invented: names say "Sample", years
// and scores are made up, and nothing comes from the taste service.

const DELAY_MS = 350;

const DOMAINS = ['film', 'tv', 'music', 'book', 'person', 'brand'];

const ENTITY_TYPE = {
  film: 'urn:entity:movie',
  tv: 'urn:entity:tv_show',
  music: 'urn:entity:artist',
  book: 'urn:entity:book',
  person: 'urn:entity:person',
  brand: 'urn:entity:brand',
};

const KIND = {
  film: 'Film',
  tv: 'Television programme',
  music: 'Singer or band',
  book: 'Book',
  person: 'Person',
  brand: 'Brand',
};

const HEADING = {
  film: 'films',
  tv: 'television',
  music: 'music',
  book: 'books',
  person: 'people',
  brand: 'brands',
};

const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

const POOL_NAME = {
  film: (n) => `Sample Film ${WORDS[n]}`,
  tv: (n) => `Sample Programme ${WORDS[n]}`,
  music: (n) => `Sample Singer ${WORDS[n]}`,
  book: (n) => `Sample Novel ${WORDS[n]}`,
  person: (n) => `Sample Star ${WORDS[n]}`,
  brand: (n) => `Sample Brand ${WORDS[n]}`,
};

const FAVOURITE_DOMAINS = ['music', 'film', 'tv', 'music', 'book', 'person', 'brand'];

const TASTE_WORDS = ['sing-along', 'comedy', 'romance', 'family evenings', 'countryside', 'dance hall'];

const THEMES = [
  'Sample theme: Songs for a Saturday night',
  'Sample theme: Evenings by the television',
  'Sample theme: A good story',
  'Sample theme: Faces from the screen',
  'Sample theme: Things from the shop',
  'Sample theme: Dancing and laughing',
  'Sample theme: Talking about home',
];

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function hash(text) {
  let h = 5381;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Entry point: answers one route the way the live API would. */
export async function sampleCall(route, body) {
  await wait(DELAY_MS);
  const input = body || {};
  switch (route) {
    case 'intake':
      return { input: sampleIntake(input.text) };
    case 'resolve':
      return sampleResolve(input);
    case 'map':
      return sampleMap(input.profile);
    case 'plan':
      return samplePlan(input);
    case 'feedback':
      return sampleFeedback(input);
    case 'room':
      return sampleRoom(input);
    default:
      throw new Error(`No sample data for ${route}`);
  }
}

function trace(step, endpoint, params, count) {
  return { step, endpoint, params, status: 200, count, ms: 0, cached: false };
}

/**
 * A decision of the map builder, in the shape the live API sends it: it asks
 * nothing, so it has no endpoint and no parameters. Every sample reason starts
 * with "Sample:", because nothing was really seen or decided.
 */
function decision(step, action, round, count, reason, domain) {
  return {
    step,
    endpoint: '',
    params: {},
    status: 0,
    count,
    ms: 0,
    cached: false,
    kind: 'decision',
    reason,
    decidedBy: 'rules',
    action,
    round,
    ...(domain ? { domain } : {}),
  };
}

// ---------------------------------------------------------------- intake

const COUNTRY_WORDS = [
  [/\b(england|scotland|wales|britain|british|english|scottish|welsh|uk)\b/i, 'GB'],
  [/\b(ireland|irish)\b/i, 'IE'],
  [/\b(america|american|usa|united states)\b/i, 'US'],
  [/\b(canada|canadian)\b/i, 'CA'],
  [/\b(australia|australian)\b/i, 'AU'],
  [/\b(new zealand)\b/i, 'NZ'],
  [/\b(france|french)\b/i, 'FR'],
  [/\b(germany|german)\b/i, 'DE'],
  [/\b(italy|italian)\b/i, 'IT'],
  [/\b(spain|spanish)\b/i, 'ES'],
  [/\b(netherlands|dutch|holland)\b/i, 'NL'],
  [/\b(poland|polish)\b/i, 'PL'],
  [/\b(israel|israeli)\b/i, 'IL'],
  [/\b(india|indian)\b/i, 'IN'],
  [/\b(south africa)\b/i, 'ZA'],
];

const NOT_NAMES = new Set(['My', 'She', 'He', 'Her', 'His', 'The', 'They', 'Our', 'We', 'Mum', 'Dad', 'Grandad', 'Nan', 'This', 'There']);

function splitList(text) {
  return text
    .split(/,|;|\band\b/i)
    .map((part) => part.replace(/[.!]+$/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function sampleIntake(text) {
  const t = String(text || '');
  const result = { nickname: '', favourites: [], avoid: [], gentle: true };
  const nameMatch = t.match(/^\s*([A-Z][a-z]{1,20})\b/);
  if (nameMatch && !NOT_NAMES.has(nameMatch[1])) result.nickname = nameMatch[1];
  const year = t.match(/\b(19[0-5]\d)\b/);
  if (year) result.birthYear = Number(year[1]);
  for (const [pattern, code] of COUNTRY_WORDS) {
    if (pattern.test(t)) {
      result.country = code;
      break;
    }
  }
  const loved = t.match(/(?:loved|loves|liked|likes|enjoyed|enjoys|fan of|favourites?(?: were| are| include| included)?:?)\s+([^.]+)/i);
  if (loved) result.favourites = splitList(loved[1].split(/\b(?:but|avoid|although|however)\b/i)[0]);
  const avoid = t.match(/(?:avoid|dislikes?|hates?|upset by|does not like|doesn't like)\s+([^.]+)/i);
  if (avoid) result.avoid = splitList(avoid[1]);
  return result;
}

// --------------------------------------------------------------- resolve

function favouriteRef(index, domain, suffix) {
  const year = 1946 + ((index + 1) * 7) % 24;
  return {
    id: `sample:fav:${index}${suffix || ''}`,
    name: `Sample Favourite ${WORDS[index]}${suffix ? ` ${suffix.toUpperCase()}` : ''}`,
    entityType: ENTITY_TYPE[domain],
    domain,
    disambiguation: `${KIND[domain]}, ${year + (suffix ? 6 : 0)}`,
    ...(domain === 'brand' ? {} : { year: year + (suffix ? 6 : 0) }),
  };
}

function sampleResolve(body) {
  const names = Array.isArray(body.names) ? body.names : [];
  const favourites = names.map((query, index) => {
    const domain = FAVOURITE_DOMAINS[index % FAVOURITE_DOMAINS.length];
    if (index >= 6 && hash(query) % 5 === 0) {
      return { query, status: 'unresolved', alternatives: [] };
    }
    const chosen = favouriteRef(index, domain);
    if (index === 2) {
      return {
        query,
        status: 'ambiguous',
        chosen,
        alternatives: [favouriteRef(index, domain, 'b'), favouriteRef(index, 'film', 'c')],
      };
    }
    return { query, status: 'resolved', chosen, alternatives: [] };
  });
  return {
    favourites,
    trace: names.map((query, i) =>
      trace(`look up favourite ${i + 1}`, '/search', { query, ...(body.country ? { country: body.country } : {}) }, favourites[i].chosen ? 1 : 0),
    ),
  };
}

// ------------------------------------------------------------------- map

const COUNTS = { film: 5, tv: 4, music: 4, book: 3, person: 4, brand: 3 };

function sampleMap(profile) {
  const p = profile || {};
  const birth = p.birthYear;
  const window = birth ? { fromYear: birth + 10, toYear: birth + 30 } : undefined;
  const excluded = new Set(p.excludedEntityIds || []);
  const favourites = Array.isArray(p.favourites) ? p.favourites : [];
  const byDomain = {};
  const traceEntries = [];
  const followUps = [];

  for (const domain of DOMAINS) {
    const items = [];
    for (let n = 0; n < 8 && items.length < COUNTS[domain]; n += 1) {
      const id = `sample:${domain}:${n}`;
      if (excluded.has(id)) continue;
      items.push(sampleItem(domain, n, items.length, window, favourites));
    }
    byDomain[domain] = items;
    const params = {
      'filter.type': ENTITY_TYPE[domain],
      'signal.interests.entities': favourites.map((f) => f.id).join(','),
      'feature.explainability': 'true',
    };
    if (window && domain === 'film') Object.assign(params, { 'filter.release_year.min': String(window.fromYear), 'filter.release_year.max': String(window.toYear) });
    if (window && domain === 'tv') Object.assign(params, { 'filter.release_year.min': String(window.fromYear), 'filter.release_year.max': String(window.toYear) });
    if (window && domain === 'book') Object.assign(params, { 'filter.publication_year.min': String(window.fromYear), 'filter.publication_year.max': String(window.toYear) });
    if (window && domain === 'person') Object.assign(params, { 'filter.date_of_birth.min': String(window.fromYear - 40), 'filter.date_of_birth.max': String(window.fromYear - 10) });
    if (p.country && (domain === 'film' || domain === 'tv')) params['filter.release_country'] = p.country;
    // Two lists pretend to come back short at first, so the sample trace can show what a decision looks like.
    const dropsCountry = domain === 'tv' && Boolean(p.country) && items.length > 1;
    const widensYears = domain === 'book' && Boolean(window) && items.length > 1;
    const firstCount = dropsCountry || widensYears ? 1 : items.length;
    traceEntries.push(trace(`cultural map: ${HEADING[domain]}`, '/v2/insights', params, firstCount));
    if (domain === 'music' || domain === 'brand') {
      traceEntries.push(
        trace(`age check: ${HEADING[domain]}`, '/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': items.map((i) => i.entity.id).join(',') }, items.length),
      );
    }
    if (dropsCountry) {
      const { 'filter.release_country': _country, ...anyCountry } = params;
      followUps.push(
        decision(
          'decision: television from any country',
          'drop_country',
          1,
          1,
          `Sample: only 1 television programme from their country${window ? ` from ${window.fromYear} to ${window.toYear}` : ''}. Trying television from any country.`,
          'tv',
        ),
        trace('cultural map: television (any country)', '/v2/insights', anyCountry, items.length),
      );
    }
    if (widensYears) {
      const wider = { ...params, 'filter.publication_year.min': String(window.fromYear - 5), 'filter.publication_year.max': String(window.toYear + 5) };
      followUps.push(
        decision(
          'decision: books from 5 more years either side',
          'widen_years',
          1,
          1,
          `Sample: only 1 book from ${window.fromYear} to ${window.toYear}. Trying 5 more years either side, from ${window.fromYear - 5} to ${window.toYear + 5}.`,
          'book',
        ),
        trace('cultural map: books (wider years)', '/v2/insights', wider, items.length),
      );
    }
  }
  traceEntries.push(trace('taste in words', '/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': favourites.map((f) => f.id).join(',') }, TASTE_WORDS.length));
  // As in a live map: the first questions, then each decision directly before the question it led to, then the decision to stop.
  if (followUps.length > 0) {
    const asked = followUps.length / 2;
    const total = DOMAINS.reduce((sum, domain) => sum + byDomain[domain].length, 0);
    traceEntries.push(
      ...followUps,
      decision('decision: stop asking', 'stop', 1, total, `Sample: stopped after ${asked} extra ${asked === 1 ? 'question' : 'questions'}. Nothing more was needed.`),
    );
  }

  const warnings = [];
  if (!birth) {
    warnings.push({ code: 'no_birth_year', message: 'No birth year was given, so the suggestions are not limited to a set of years.' });
  }
  warnings.push({
    domain: 'music',
    code: 'no_era_filter',
    message: 'Music cannot be limited to a range of years, so Encore checked how popular each one is with people over 55 instead.',
  });
  warnings.push({
    domain: 'brand',
    code: 'no_era_filter',
    message: 'Brands cannot be limited to a range of years either, so the same check was used.',
  });

  return {
    map: {
      profileId: p.id || 'sample-profile',
      ...(window ? { window } : {}),
      byDomain,
      tasteWords: TASTE_WORDS.map((w) => ({ id: `sample:tag:${w.replace(/\s+/g, '-')}`, name: `Sample ${w}`, type: 'genre' })),
      warnings,
    },
    trace: traceEntries,
  };
}

function sampleItem(domain, n, index, window, favourites) {
  const dated = domain !== 'music' && domain !== 'brand';
  let year;
  if (window && dated) {
    const span = window.toYear - window.fromYear;
    year = domain === 'person' ? window.fromYear - 22 - n * 2 : window.fromYear + ((n * 4 + index) % (span + 1));
  } else if (domain === 'music') {
    year = 1925 + n * 3;
  }
  const entity = {
    id: `sample:${domain}:${n}`,
    name: POOL_NAME[domain](n),
    entityType: ENTITY_TYPE[domain],
    domain,
    ...(year ? { year, disambiguation: `${KIND[domain]}, ${year}` } : { disambiguation: KIND[domain] }),
  };
  const contributions = [];
  const count = Math.min(3, favourites.length);
  for (let k = 0; k < count; k += 1) {
    const fav = favourites[(index + k) % favourites.length];
    contributions.push({ entityId: fav.id, name: fav.name, score: round2(Math.max(0.12, 0.82 - k * 0.24 - index * 0.04)) });
  }
  let eraCheck = 'unchecked';
  let ageSkew55Plus;
  if (window && dated) {
    eraCheck = 'filter';
  } else if (domain === 'music') {
    eraCheck = 'age_skew';
    ageSkew55Plus = round2(0.6 - index * 0.15);
  } else if (domain === 'brand' && index < 2) {
    eraCheck = 'age_skew';
    ageSkew55Plus = round2(0.5 - index * 0.6);
  }
  return {
    entity,
    domain,
    affinity: round2(Math.max(0.2, 0.92 - index * 0.08)),
    contributions,
    eraCheck,
    ...(ageSkew55Plus === undefined ? {} : { ageSkew55Plus }),
    ...(index % 2 === 0 ? { description: `An invented ${KIND[domain].toLowerCase()} that shows how this page looks.` } : {}),
    tags: [{ id: `sample:tag:${TASTE_WORDS[(n + index) % TASTE_WORDS.length].replace(/\s+/g, '-')}`, name: `Sample ${TASTE_WORDS[(n + index) % TASTE_WORDS.length]}`, type: 'genre' }],
  };
}

// ------------------------------------------------------------------ plan

function reasonFor(item, nickname) {
  const lead = item.contributions && item.contributions[0];
  if (!lead) return `Chosen to suit ${nickname}.`;
  return `Linked to ${lead.name}, which ${nickname} loved (strength ${Math.round(lead.score * 100)}%).`;
}

function samplePlan(body) {
  const profile = body.profile || {};
  const map = body.map || { byDomain: {} };
  const nickname = profile.nickname || 'them';
  const requested = Number(body.days);
  const days = Math.min(7, Math.max(1, Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 5));
  const used = new Set();
  const sessions = [];
  const allItems = DOMAINS.flatMap((d) => (map.byDomain && map.byDomain[d]) || []);

  for (let d = 0; d < days; d += 1) {
    const wanted = [DOMAINS[d % 6], DOMAINS[(d + 1) % 6]];
    if (d % 2 === 0) wanted.push(DOMAINS[(d + 2) % 6]);
    const picks = [];
    for (const domain of wanted) {
      const list = (map.byDomain && map.byDomain[domain]) || [];
      const next = list.find((i) => !used.has(i.entity.id));
      if (next) {
        used.add(next.entity.id);
        picks.push(next);
      }
    }
    if (picks.length === 0 && allItems.length > 0) picks.push(allItems[d % allItems.length]);
    const names = picks.map((i) => i.entity.name);
    sessions.push({
      id: `sample-day-${d + 1}`,
      day: d + 1,
      theme: THEMES[d % THEMES.length],
      opener: `Today we have a few things from ${nickname}'s younger years. Shall we see what you remember?`,
      items: picks.map((item) => ({ item, reason: reasonFor(item, nickname) })),
      prompts: [
        `What do you remember about ${names[0] || 'this'}?`,
        names[1] ? `Where were you when you first came across ${names[1]}?` : 'Where were you when you first came across it?',
        'Who would you have shared it with?',
      ],
    });
  }
  return { plan: { profileId: profile.id || 'sample-profile', sessions, generatedAt: new Date().toISOString() } };
}

// -------------------------------------------------------------- feedback

function sampleFeedback(body) {
  const profile = clone(body.profile || {});
  const map = clone(body.map || { byDomain: {} });
  const plan = clone(body.plan || { sessions: [] });
  const feedback = body.feedback || { reactions: [] };
  const nickname = profile.nickname || 'them';
  const changes = [];

  profile.liked = profile.liked || [];
  profile.excludedEntityIds = profile.excludedEntityIds || [];
  const lookup = new Map();
  for (const s of plan.sessions) for (const si of s.items) lookup.set(si.item.entity.id, si.item);

  for (const r of feedback.reactions || []) {
    const item = lookup.get(r.entityId);
    const name = item ? item.entity.name : 'That item';
    if (r.reaction === 'lit_up') {
      if (item && !profile.liked.some((e) => e.id === r.entityId)) profile.liked.push(item.entity);
      changes.push(`${name} lit up, so things like it will come first.`);
    } else if (r.reaction === 'not_today') {
      if (!profile.excludedEntityIds.includes(r.entityId)) profile.excludedEntityIds.push(r.entityId);
      changes.push(`${name} will not be suggested again.`);
    }
  }

  const excluded = new Set(profile.excludedEntityIds);
  for (const domain of DOMAINS) map.byDomain[domain] = (map.byDomain[domain] || []).filter((i) => !excluded.has(i.entity.id));

  const inPlan = new Set();
  for (const s of plan.sessions) for (const si of s.items) inPlan.add(si.item.entity.id);
  for (const s of plan.sessions) {
    const kept = [];
    for (const si of s.items) {
      if (!excluded.has(si.item.entity.id)) {
        kept.push(si);
        continue;
      }
      const replacement = (map.byDomain[si.item.domain] || []).find((i) => !inPlan.has(i.entity.id));
      if (replacement) {
        inPlan.add(replacement.entity.id);
        kept.push({ item: replacement, reason: reasonFor(replacement, nickname) });
        changes.push(`Day ${s.day}: swapped ${si.item.entity.name} for ${replacement.entity.name}.`);
      } else {
        changes.push(`Day ${s.day}: took out ${si.item.entity.name} and found nothing to replace it.`);
      }
    }
    s.items = kept;
  }

  const note = (feedback.note || '').trim();
  if (note) changes.push('Your note was read and kept with this session.');
  if (changes.length === 0) changes.push('Nothing changed, because every reaction was neutral.');
  plan.generatedAt = new Date().toISOString();

  return {
    profile,
    map,
    plan,
    changes,
    // A real replan builds the map again, so its trace is a map's trace, decisions included. The page saves that
    // record with the map, and "How Encore built this map" must not lose its decisions after an update.
    trace: sampleMap(profile).trace,
  };
}

// ------------------------------------------------------------------ room

function sampleRoom(body) {
  const profiles = Array.isArray(body.profiles) ? body.profiles : [];
  const maps = Array.isArray(body.maps) ? body.maps : [];

  const candidates = new Map();
  for (let round = 0; round < 3; round += 1) {
    for (const map of maps) {
      for (const domain of DOMAINS) {
        const item = ((map.byDomain && map.byDomain[domain]) || [])[round];
        if (item && !candidates.has(item.entity.id)) candidates.set(item.entity.id, item);
      }
    }
  }

  const scored = [...candidates.values()].map((item) => {
    const perPerson = profiles.map((p) => {
      const h = hash(`${p.id}|${item.entity.id}`);
      return { profileId: p.id, affinity: h % 17 === 0 ? null : round2(0.2 + (h % 75) / 100) };
    });
    const known = perPerson.map((x) => x.affinity).filter((v) => v !== null);
    const anyNull = known.length < perPerson.length;
    const min = anyNull || known.length === 0 ? 0 : Math.min(...known);
    const mean = known.length ? round2(known.reduce((a, b) => a + b, 0) / known.length) : 0;
    return { item, score: { entityId: item.entity.id, perPerson, min: round2(min), mean } };
  });
  scored.sort((a, b) => b.score.min - a.score.min || b.score.mean - a.score.mean);
  const chosen = scored.slice(0, 5);
  // One item that suits most of the room but not everyone, so the "may be left out" flag and companion show up.
  const stretch = scored
    .slice(5)
    .filter((c) => c.score.min < 0.4)
    .sort((a, b) => b.score.mean - a.score.mean)[0];
  if (stretch) chosen.push(stretch);
  else if (scored[5]) chosen.push(scored[5]);
  const chosenIds = new Set(chosen.map((c) => c.item.entity.id));

  const items = chosen.map(({ item, score }) => {
    const leftOut = score.perPerson.filter((x) => x.affinity === null || x.affinity < 0.4).map((x) => x.profileId);
    const companions = [];
    for (const profileId of leftOut) {
      const index = profiles.findIndex((p) => p.id === profileId);
      const own = index >= 0 && maps[index] ? DOMAINS.flatMap((d) => maps[index].byDomain[d] || []) : [];
      const best = own.filter((i) => !chosenIds.has(i.entity.id)).sort((a, b) => (b.affinity || 0) - (a.affinity || 0))[0];
      if (best) companions.push({ profileId, item: best });
    }
    return { item, score, leftOut, companions };
  });

  const windows = profiles.filter((p) => p.birthYear).map((p) => [p.birthYear + 10, p.birthYear + 30]);
  const sharedGround = [];
  if (windows.length > 1) {
    const from = Math.max(...windows.map((w) => w[0]));
    const to = Math.min(...windows.map((w) => w[1]));
    sharedGround.push(
      from <= to
        ? `Sample: everyone's younger years overlap between ${from} and ${to}.`
        : 'Sample: the younger years of these residents do not overlap, so the programme leans on things that crossed generations.',
    );
  }
  sharedGround.push('Sample: sing-along and comedy came up for most of the room.');
  sharedGround.push('Sample: everyone has at least one favourite from music.');

  const warnings = [];
  if (profiles.some((p) => !p.birthYear)) {
    warnings.push({ code: 'no_birth_year', message: 'At least one person has no birth year, so their years could not be matched.' });
  }

  return {
    programme: { items, sharedGround, warnings },
    trace: [
      trace('common room: compare residents', '/v2/analysis/compare', { 'a.signal.interests.entities': 'sample', 'b.signal.interests.entities': 'sample' }, profiles.length),
      ...profiles.map((p) =>
        trace(`common room: score for ${p.nickname || 'resident'}`, '/v2/insights', { 'filter.type': 'urn:entity:movie', 'filter.results.entities': [...candidates.keys()].slice(0, 6).join(',') }, scored.length),
      ),
    ],
  };
}
