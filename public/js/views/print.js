import { h } from '../dom.js';
import { entityLine } from '../format.js';
import { getPerson } from '../store.js';

export const FIXED_LINE = 'Encore suggests things to talk about. It is not medical advice.';

export function printView(id, day) {
  const person = getPerson(id);
  const session = person && person.plan ? person.plan.sessions.find((s) => String(s.day) === String(day)) : null;
  if (!person || !session) {
    return {
      title: 'Session not found',
      el: h('div', { class: 'page' }, h('h1', null, 'That session is not available'), h('p', { class: 'lede' }, 'Go back to the plan and choose a day to print.'), h('a', { class: 'btn btn--primary', href: person ? `#/person/${encodeURIComponent(person.id)}/plan` : '#/' }, 'Back to the plan')),
    };
  }

  const back = `#/person/${encodeURIComponent(person.id)}/plan`;
  const sheet = h(
    'article',
    { class: 'sheet', 'aria-labelledby': 'sheet-title' },
    h('p', { class: 'sheet-for' }, `Memory session for ${person.input.nickname}, day ${session.day}`),
    h('h1', { id: 'sheet-title', class: 'sheet-title' }, session.theme),
    session.opener ? h('p', { class: 'sheet-opener' }, h('strong', null, 'Open with: '), session.opener) : null,
    h('h2', { class: 'sheet-sub' }, 'Things to bring'),
    h(
      'ul',
      { class: 'sheet-items' },
      session.items.map((si) =>
        h('li', null, h('span', { class: 'sheet-item-name' }, si.item.entity.name), ' ', h('span', { class: 'sheet-item-kind' }, `(${entityLine(si.item.entity)})`), si.reason ? h('span', { class: 'sheet-item-reason' }, si.reason) : null),
      ),
    ),
    session.prompts && session.prompts.length ? [h('h2', { class: 'sheet-sub' }, 'Questions to ask'), h('ul', { class: 'sheet-prompts' }, session.prompts.map((p) => h('li', null, p)))] : null,
    h('h2', { class: 'sheet-sub' }, 'Notes'),
    h('div', { class: 'sheet-lines', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span')),
    h('p', { class: 'sheet-foot' }, FIXED_LINE),
  );

  const el = h(
    'div',
    { class: 'page page--print' },
    h(
      'div',
      { class: 'print-bar' },
      h('a', { class: 'btn btn--secondary', href: back }, 'Back to the plan'),
      h('button', { type: 'button', class: 'btn btn--primary', onClick: () => window.print() }, 'Print'),
      h('p', { class: 'hint' }, 'This is what will print: one page, black on white.'),
    ),
    sheet,
  );

  return { title: `Print day ${session.day} for ${person.input.nickname}`, el };
}
