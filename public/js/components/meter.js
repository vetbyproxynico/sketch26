// A thin horizontal bar for strengths and fit. The bar is decoration: the
// number next to it always carries the same information in text.

import { h } from '../dom.js';
import { percent } from '../format.js';

export function bar(value, tone) {
  const p = percent(value);
  return h('span', { class: `bar${tone ? ` bar--${tone}` : ''}`, 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { '--v': String(p / 100) } }));
}
