// "How Encore built this map": the work the map builder did, put where it is seen
// without opening the trace. One sentence with the numbers for this map, the
// decisions it took in plain words and who took each, and a button for the full
// trace. It is a quiet block that comes after the map's own notices and before
// its lists.

import * as api from '../api.js';
import { h, uid } from '../dom.js';
import { DECIDED_BY, mapWorkSentence } from '../format.js';
import { openTracePanel } from './trace-panel.js';

/**
 * `work` is the record saved with the map (see `mapWorkFromTrace` in shape.js).
 * `sample` is true when the map came from sample data. Returns null when there
 * is no record, as for a map saved before Encore kept one.
 */
export function mapWorkBlock(work, sample) {
  if (!work) return null;
  const titleId = uid('map-work-title');
  const decisions = work.decisions;

  const trace = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--secondary btn--small',
      'aria-haspopup': 'dialog',
      onClick: (event) => openTracePanel(event.currentTarget),
    },
    'Open the full trace',
  );

  return h(
    'section',
    { class: 'map-work', 'aria-labelledby': titleId },
    h('h2', { id: titleId, class: 'map-work-title' }, 'How Encore built this map'),
    h('p', { class: 'map-work-summary' }, mapWorkSentence(work, sample)),
    sample ? h('p', { class: 'hint' }, 'Sample data is on, so nothing was really asked or decided. These lines show what Encore would do.') : null,
    decisions.length
      ? h(
          'ol',
          { class: 'map-work-list' },
          decisions.map((decision) =>
            h(
              'li',
              null,
              h('span', { class: 'map-work-reason' }, decision.reason),
              ' ',
              // Said in words, so that the difference between the rules and the model never rests on a colour.
              h('span', { class: `map-work-by map-work-by--${decision.decidedBy}` }, sample ? `${DECIDED_BY[decision.decidedBy]} (sample)` : DECIDED_BY[decision.decidedBy]),
            ),
          ),
        )
      : null,
    // The trace itself is kept in memory only, so after a reload there is less to open.
    api.getTrace().length === 0 ? h('p', { class: 'hint' }, 'The full trace is kept only until the page is closed or reloaded, so it is empty now. Build the map again to fill it.') : null,
    h('div', { class: 'map-work-actions' }, trace),
  );
}
