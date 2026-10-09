import { s } from '../dom.js';

/*
 * From 960 pixels, thin lines run in the margin of the ladder from the home
 * base to each rung, one lane for each kind of love and each kind drawn in its
 * own pattern: game solid, TV dashed, film double, music dotted, person
 * dash-dot, book thick. They show at a glance which kinds of love led to which
 * rung. They are decoration, hidden from assistive technology: the chips on
 * each card say the same thing in words.
 */

const LANE_WIDTH = 9;
const FIRST_LANE = 8;
/** The width of the margin the lanes run in. Matches `.ladder-col` in styles.css. */
export const MARGIN = 56;
const RAIL_X = 60;

const KIND_ORDER = ['game', 'tv', 'film', 'music', 'person', 'book'];

/** Stroke settings for each kind. `double` draws a wide line with a thin line of the page colour on top of it. */
const PATTERNS = {
  game: { width: 2 },
  tv: { width: 2, dash: '7 4' },
  film: { width: 5, double: true },
  music: { width: 3, dash: '0.1 5', cap: 'round' },
  person: { width: 2, dash: '9 3 2 3' },
  book: { width: 4 },
};

const wide = () => globalThis.matchMedia?.('(min-width: 960px)').matches === true;

/**
 * Draws the lines for one ladder. `column` is the element that holds the home
 * base and the rail; `homeBase` and the rung list items are inside it.
 *
 * @param {HTMLElement} column  the ladder column (position: relative)
 * @param {HTMLElement | null} homeBase
 * @param {Array<{ li: HTMLElement, kinds: string[] }>} rungs  the open rungs, in order, with the kinds that led to each
 */
export function drawRailLines(column, homeBase, rungs) {
  column.querySelector(':scope > .rail-lines')?.remove();
  if (!wide() || !homeBase || rungs.length === 0) return;
  const origin = column.getBoundingClientRect();
  const top = (el) => el.getBoundingClientRect().top - origin.top;
  const startY = top(homeBase) + homeBase.getBoundingClientRect().height / 2;
  // The bar of a rung meets the rail 1.125rem below the top of the rung.
  const bar = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.125;

  const kinds = KIND_ORDER.filter((kind) => rungs.some((rung) => rung.kinds.includes(kind)));
  if (kinds.length === 0) return;
  const svg = s('svg', { class: 'rail-lines', width: MARGIN + 6, height: Math.ceil(origin.height), viewBox: `0 0 ${MARGIN + 6} ${Math.ceil(origin.height)}`, 'aria-hidden': 'true', focusable: 'false' });

  kinds.forEach((kind, lane) => {
    const x = FIRST_LANE + lane * LANE_WIDTH;
    const nudge = (lane - (kinds.length - 1) / 2) * 3;
    const ys = rungs.filter((rung) => rung.kinds.includes(kind)).map((rung) => top(rung.li) + bar + nudge);
    const first = startY + nudge;
    const last = Math.max(...ys);
    let d = `M ${MARGIN} ${first} H ${x} V ${last}`;
    for (const y of ys) d += ` M ${x} ${y} H ${RAIL_X}`;
    const pattern = PATTERNS[kind];
    const path = (extra) => s('path', { d, fill: 'none', 'stroke-linejoin': 'miter', 'stroke-linecap': pattern.cap ?? 'butt', ...extra });
    svg.append(path({ class: `rail-lines__line rail-lines__line--${kind}`, 'stroke-width': pattern.width, ...(pattern.dash ? { 'stroke-dasharray': pattern.dash } : {}) }));
    if (pattern.double) svg.append(path({ class: 'rail-lines__inner', 'stroke-width': 1.5 }));
    // a small dot where the line leaves the home base
    svg.append(s('circle', { class: `rail-lines__dot rail-lines__dot--${kind}`, cx: MARGIN, cy: first, r: 2.5 }));
  });
  column.prepend(svg);
}
