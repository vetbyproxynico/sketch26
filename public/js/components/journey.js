// The short trail shown on every page about one person: details, favourites, map, plan.
// It is a true sequence, so it is numbered.

import { h } from '../dom.js';

export function journey(person, current) {
  const id = encodeURIComponent(person.id);
  const steps = [
    { key: 'details', label: 'Details', href: `#/edit/${id}`, reached: true },
    { key: 'favourites', label: 'Favourites', href: `#/person/${id}/favourites`, reached: true },
    { key: 'map', label: 'Map', href: `#/person/${id}/map`, reached: Boolean(person.profile) },
    { key: 'plan', label: 'Plan', href: `#/person/${id}/plan`, reached: Boolean(person.map) },
  ];
  const items = steps.map((step, index) => {
    const isCurrent = step.key === current;
    const content = [h('span', { class: 'journey-num', 'aria-hidden': 'true' }, String(index + 1)), h('span', { class: 'journey-label' }, step.label)];
    let inner;
    if (isCurrent) {
      inner = h('span', { class: 'journey-link', 'aria-current': 'step' }, content);
    } else if (step.reached) {
      inner = h('a', { class: 'journey-link', href: step.href }, content);
    } else {
      inner = h('span', { class: 'journey-link journey-link--later' }, content);
    }
    return h('li', { class: `journey-item${isCurrent ? ' is-current' : ''}${step.reached ? '' : ' is-later'}` }, inner);
  });
  return h('nav', { class: 'journey', 'aria-label': `Steps for ${person.input.nickname}` }, h('ol', null, items));
}
