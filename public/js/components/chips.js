import { h } from '../dom.js';
import { KIND_INFO, kindMark } from '../kinds.js';
import { STRENGTH_WORD } from '../words.js';

/* Chips for loves, with their kind marks. */

/** A love as a chip: kind mark, name, and the year when it is known. */
export function loveChip(love, { onRemove, removeLabel, strength } = {}) {
  const li = h(
    'li',
    { class: `love-chip love-chip--${love.kind}` },
    kindMark(love.kind),
    h('span', { class: 'love-chip__name' }, love.name),
    love.year ? h('span', { class: 'love-chip__year' }, String(love.year)) : null,
    strength ? h('span', { class: 'love-chip__strength' }, STRENGTH_WORD[strength] ?? strength) : null,
  );
  if (onRemove) {
    const remove = h('button', { type: 'button', class: 'chip-remove', 'aria-label': removeLabel ?? `Remove ${love.name}` }, h('span', { 'aria-hidden': 'true' }, '×'));
    remove.addEventListener('click', () => onRemove(love, remove));
    li.append(remove);
  }
  return li;
}

/** A chip for a love that is not matched yet (a typed name with the kind chosen, if any). */
export function nameChip(entry, { onRemove, removeLabel } = {}) {
  const li = h(
    'li',
    { class: `love-chip love-chip--${entry.kind || 'none'}` },
    entry.kind ? kindMark(entry.kind) : h('span', { class: 'kind kind--none' }, h('span', { class: 'kind__line', 'aria-hidden': 'true' }), h('span', { class: 'kind__word' }, 'Any kind')),
    h('span', { class: 'love-chip__name' }, entry.name),
  );
  if (onRemove) {
    const remove = h('button', { type: 'button', class: 'chip-remove', 'aria-label': removeLabel ?? `Remove ${entry.name}` }, h('span', { 'aria-hidden': 'true' }, '×'));
    remove.addEventListener('click', () => onRemove(entry, remove));
    li.append(remove);
  }
  return li;
}

export function kindOptions(selected = '', { any = 'Not sure' } = {}) {
  return [h('option', { value: '', selected: selected === '' }, any), ...Object.entries(KIND_INFO).map(([id, info]) => h('option', { value: id, selected: selected === id }, info.choice))];
}
