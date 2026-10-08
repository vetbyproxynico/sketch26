import { announce, focusEl, h, normaliseName, replaceChildren, uid } from '../dom.js';
import { chosenLove } from '../flows.js';
import { kindMark } from '../kinds.js';
import { button } from './ui.js';

/*
 * "Did we get these right?" One block for each typed name: a clean match, a
 * name that could be several things (pick up to four), or a name Qloo does not
 * know (greyed, left out, nothing invented). Each can be removed. Used by the
 * confirm screen for one reader and for a group.
 */

const quoted = (text) => `“${text}”`;

function loveLine(love) {
  return [kindMark(love.kind), h('span', { class: 'match__name' }, love.name), love.year ? h('span', { class: 'match__year' }, String(love.year)) : null];
}

/**
 * @param {Array<object>} entries from `resolveNames`; changed in place (`pick`, `removed`)
 * @param {{ onChange?: () => void, usedBy?: (entry: object) => string | null }} options
 */
export function matchList(entries, { onChange, usedBy } = {}) {
  const list = h('ul', { class: 'matches' });

  function itemFor(entry) {
    const li = h('li', { class: 'match' });
    const draw = () => {
      li.className = `match match--${entry.removed ? 'removed' : entry.status}`;
      const who = usedBy?.(entry);
      const nameForLabels = chosenLove({ ...entry, removed: false })?.name ?? entry.query;
      const typed = normaliseName(entry.query) === normaliseName(nameForLabels) ? null : h('p', { class: 'match__typed' }, `You typed ${quoted(entry.query)}.`);
      const used = who ? h('p', { class: 'match__used' }, who) : null;

      if (entry.removed) {
        const back = button({
          label: 'Put it back',
          variant: 'secondary',
          ariaLabel: `Put back ${quoted(entry.query)}`,
          onClick: () => {
            entry.removed = false;
            draw();
            onChange?.();
            announce(`Put back ${entry.query}.`);
            focusEl(li.querySelector('.match__remove'));
          },
        });
        replaceChildren(li, h('p', { class: 'match__line' }, h('span', { class: 'match__state' }, 'Removed'), h('span', { class: 'match__name' }, quoted(entry.query))), back);
        return;
      }

      const remove = button({
        label: 'Remove',
        variant: 'quiet',
        className: 'match__remove',
        ariaLabel: `Remove ${quoted(entry.query)}`,
        onClick: () => {
          entry.removed = true;
          draw();
          onChange?.();
          announce(`Removed ${entry.query}.`);
          focusEl(li.querySelector('button'));
        },
      });

      if (entry.status === 'unresolved') {
        replaceChildren(
          li,
          h('p', { class: 'match__line' }, h('span', { class: 'match__state' }, 'Not found'), h('span', { class: 'match__name' }, quoted(entry.query))),
          h('p', { class: 'match__why' }, 'Qloo does not know this one. Rung leaves it out and invents nothing.'),
          entry.hint ? h('p', { class: 'match__hint' }, entry.hint) : null,
          used,
          remove,
        );
        return;
      }

      if (entry.status === 'ambiguous' && entry.candidates.length > 1) {
        const group = `match-${uid('m')}`;
        const fieldset = h('fieldset', { class: 'match__choices' }, h('legend', { class: 'match__legend' }, `${quoted(entry.query)} could be more than one thing. Pick the one you mean.`));
        entry.candidates.forEach((candidate, index) => {
          const id = uid('cand');
          const input = h('input', { type: 'radio', name: group, id, value: String(index), checked: entry.pick === index, class: 'choice__input' });
          input.addEventListener('change', () => {
            entry.pick = index;
            onChange?.();
            announce(`Chosen: ${candidate.name}${candidate.year ? `, ${candidate.year}` : ''}.`);
          });
          fieldset.append(
            h('div', { class: 'choice' }, input, h('label', { for: id, class: 'choice__label' }, h('span', { class: 'choice__main' }, ...loveLine(candidate)), candidate.disambiguation ? h('span', { class: 'choice__more' }, candidate.disambiguation) : null)),
          );
        });
        replaceChildren(li, fieldset, used, remove);
        return;
      }

      const love = chosenLove(entry);
      replaceChildren(
        li,
        h('p', { class: 'match__line' }, h('span', { class: 'match__state' }, entry.status === 'ambiguous' ? 'Best guess' : 'Matched'), ...(love ? loveLine(love) : [h('span', { class: 'match__name' }, quoted(entry.query))])),
        typed,
        love?.disambiguation ? h('p', { class: 'match__hint' }, love.disambiguation) : null,
        used,
        remove,
      );
    };
    draw();
    return li;
  }

  for (const entry of entries) list.append(itemFor(entry));

  return {
    el: list,
    /** How many entries will be used. */
    usable: () => entries.filter((entry) => chosenLove(entry) !== undefined).length,
  };
}
