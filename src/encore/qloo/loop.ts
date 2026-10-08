import { actionable } from '../agent/rules';
import { settle } from '../agent/settle';
import type { Advisor, AgentLimits, Decision, Observation } from '../agent/types';
import { fetchPage, mergeItems, type DomainContext, type ListState } from './domain';
import { recoverableFailure } from './faults';
import { STOP_STEP, callStep, decisionStep, reasonFor, stopReason, type StopWhy } from './narrate';
import { observe, type MapFacts, type Observed } from './observe';
import { applyMove } from './query';
import type { DecisionNote } from './traced';

/*
 * The agent loop: observe, decide, act, and observe again.
 *
 * After the first round of calls every list is described in an observation.
 * For each list that is thin and still has a move open, an advisor picks one
 * move or accepts the list. The moves are made, their answers merged in, and
 * the next round observes the result.
 *
 * It always ends, whatever the advisor says:
 * - at most `maxRounds` rounds are played;
 * - at most `maxExtraCalls` calls are made, each move costing exactly one;
 * - a move can be made once for a list, so a list runs out of moves;
 * - the advisor has `advisorTimeoutMs` to answer and its answer goes through
 *   `settle`, so a slow, broken or stubborn advisor only hands the choice to
 *   the rules;
 * - no round starts after `deadlineMs`.
 * The calls go through the same gate as every other call, three at a time.
 */

export interface LoopInput {
  ctx: DomainContext;
  /** One state for each list. Changed in place as answers arrive. */
  states: readonly ListState[];
  facts: MapFacts;
  advisor: Advisor;
  limits: AgentLimits;
  /** Milliseconds since this map began to be built. */
  elapsed: () => number;
}

/**
 * Asks the advisor, within the time limit, and settles what it says. A late,
 * failed or unusable answer leaves every choice to the rules. The advisor gets
 * a copy, so it cannot change what the builder goes on to use.
 */
async function consult(advisor: Advisor, observation: Observation, timeoutMs: number): Promise<{ decisions: Decision[]; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let proposed: unknown;
  try {
    proposed = await Promise.race([
      Promise.resolve().then(() => advisor.advise(structuredClone(observation))),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), Math.max(0, timeoutMs));
      }),
    ]);
  } catch {
    proposed = undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return { decisions: settle(observation, proposed), ms: Date.now() - started };
}

/** Runs the loop over the lists of one map. Resolves when it has stopped; a fatal Qloo error is thrown. */
export async function runLoop(input: LoopInput): Promise<void> {
  const { ctx, states, facts, advisor, limits, elapsed } = input;
  const maxRounds = Math.max(0, Math.floor(limits.maxRounds));
  let callsLeft = Math.max(0, Math.floor(limits.maxExtraCalls));
  let asked = 0;
  let played = 0;
  let why: StopWhy | undefined;

  const look = (round: number): Observed => observe(states, facts, { round, roundsLeft: Math.max(0, maxRounds - round + 1), callsLeft });

  async function act(decision: Decision, seen: Observed, round: number, ms: number): Promise<void> {
    const state = states.find((candidate) => candidate.domain === decision.domain);
    const list = seen.observation.lists.find((candidate) => candidate.domain === decision.domain);
    if (state === undefined || list === undefined) return;

    const note: DecisionNote = {
      step: decisionStep(decision.action, decision.domain),
      reason: reasonFor(decision, list, seen.observation),
      decidedBy: decision.decidedBy,
      action: decision.action,
      round,
      count: list.counted,
      ms,
      domain: decision.domain,
    };
    if (decision.action === 'accept') {
      state.accepted = true;
      ctx.traced.decide(note);
      return;
    }

    const move = decision.action;
    const before = state.query;
    state.query = applyMove(before, move, seen.moves[decision.domain]);
    state.tried.push(move);
    if (move === 'drop_country' && before.country !== undefined) state.country = { code: before.country, before: list.counted, added: 0 };
    if (move === 'widen_years' && before.years !== undefined && state.query.years !== undefined) {
      state.years = { from: before.years, to: state.query.years, before: list.counted, added: 0 };
    }

    let merged: { added: number; remarked: number };
    try {
      const page = await fetchPage(ctx, decision.domain, callStep(move, decision.domain), state.query, note);
      merged = mergeItems(state, page.items, page.dropped);
    } catch (error) {
      recoverableFailure(error); // the move is spent and the list keeps what it had
      return;
    }
    // Moves add up, so everything a later call brings came through each relaxation made so far.
    // An item that only counts as inside the years because they were widened is shown thanks to the widening too.
    if (state.country !== undefined) state.country.added += merged.added;
    if (state.years !== undefined) state.years.added += merged.added + merged.remarked;
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    const seen = look(round);
    if (actionable(seen.observation).length === 0) {
      why = 'done';
      break;
    }
    if (callsLeft <= 0) {
      why = 'budget';
      break;
    }
    if (elapsed() >= limits.deadlineMs) {
      why = 'time';
      break;
    }
    const { decisions, ms } = await consult(advisor, seen.observation, limits.advisorTimeoutMs);
    if (elapsed() >= limits.deadlineMs) {
      why = 'time';
      break;
    }

    played = round;
    const moves = decisions.filter((decision) => decision.action !== 'accept').length;
    callsLeft -= moves;
    asked += moves;
    await Promise.all(decisions.map((decision) => act(decision, seen, round, ms)));
  }

  const last = look(played + 1).observation;
  const short = last.lists.filter((list) => list.thin);
  // Say nothing when there was nothing to decide: a map whose lists were all full, or a loop that is switched off.
  if (played === 0 && !(why === 'time' && short.length > 0)) return;
  why ??= actionable(last).length === 0 ? 'done' : callsLeft <= 0 ? 'budget' : 'rounds';
  ctx.traced.decide({
    step: STOP_STEP,
    reason: stopReason(why, asked, last.lists, facts.target),
    decidedBy: 'rules',
    action: 'stop',
    round: Math.max(1, played),
    count: last.lists.reduce((total, list) => total + list.usable, 0),
    ms: 0,
  });
}
