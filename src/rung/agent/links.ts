import type { Gathering, InputAverages } from '../ports';
import { joinNames, numberWord } from '../text';
import type { LinkStrength, Love, Note, ReadingLink } from '../types';
import { LINK_FLOOR, STRONG_AT } from './ladder';

/** The window of Qloo's average influence that stands for "the picks": the top ten results, then the nearest that exists. */
function windowOf(averages: InputAverages): Readonly<Record<string, number>> | undefined {
  return averages.top10 ?? averages.top5 ?? averages.top3 ?? averages.all;
}

function strengthOfAverage(average: number): LinkStrength {
  if (average >= STRONG_AT) return 'strong';
  return average >= LINK_FLOOR ? 'some' : 'none';
}

/**
 * The "Reading links" strip: for each love, how much it pulled on the picks.
 *
 * - A kind that is not used (its route is off, or the hop found nothing) is `none`.
 * - With Qloo's top-level averages (OQ8's primary design): `strong`, `some` or
 *   `none` by the love's average influence over the top results; a love that is
 *   not among the averages is `none`.
 * - Without them (explainability failed): from the pool of that kind on its own
 *   (C4), which is the fallback source the spec names. A kind with books is
 *   `some`, never `strong`, because nothing says how much.
 */
export function readingLinks(
  loves: readonly Love[],
  gathering: Pick<Gathering, 'averages' | 'kindPools' | 'unusedKinds'>,
): ReadingLink[] {
  const window = gathering.averages === undefined ? undefined : windowOf(gathering.averages);
  return loves.map((love): ReadingLink => {
    const link: ReadingLink = { sourceId: love.id, name: love.name, kind: love.kind, strength: 'none' };
    if (gathering.unusedKinds.includes(love.kind)) return link;
    if (gathering.averages === undefined) {
      link.strength = (gathering.kindPools[love.kind]?.length ?? 0) > 0 ? 'some' : 'none';
      return link;
    }
    const average = window?.[love.id];
    if (average !== undefined) {
      link.average = average;
      link.strength = strengthOfAverage(average);
    }
    return link;
  });
}

/** One plain note saying which loves have no reading link, and what the ladder leans on instead. Empty when every love has one. */
export function readingLinkNotes(links: readonly ReadingLink[]): Note[] {
  const none = links.filter((link) => link.strength === 'none');
  if (none.length === 0) return [];
  const rest = links.length - none.length;
  const names = joinNames(none.map((link) => link.name));
  const message =
    rest === 0
      ? `Qloo found no reading link for ${names}, so there is nothing for the ladder to lean on.`
      : `Qloo found no reading link for ${names}, so the ladder leans on the other ${numberWord(rest)}.`;
  return [{ code: 'no_reading_link', message }];
}
