import { h } from '../dom.js';
import { EXAMPLES } from '../examples.js';
import { countryName, joinList } from '../format.js';
import { navigate } from '../router.js';
import { allPeople, createPerson, getPerson, savePerson, stageLabel, stageRoute } from '../store.js';

export function openExample(example) {
  let person = getPerson(example.id);
  if (!person) {
    person = createPerson(JSON.parse(JSON.stringify(example.input)), { id: example.id, example: true });
    savePerson(person);
  }
  navigate(stageRoute(person));
}

function exampleButton(example) {
  const { input } = example;
  const where = [input.place, countryName(input.country)].filter(Boolean).join(', ');
  const loves = joinList(input.favourites.slice(0, 3));
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'example', onClick: () => openExample(example) },
      h('span', { class: 'example-name' }, input.nickname),
      h('span', { class: 'example-where' }, `Born ${input.birthYear}${where ? ` in ${where}` : ''}`),
      h('span', { class: 'example-loves' }, `Loves ${loves} and more`),
      h('span', { class: 'stamp stamp--example', 'aria-hidden': 'true' }, h('span', { class: 'stamp-year' }, String(input.birthYear)), h('span', { class: 'stamp-kind' }, 'born')),
    ),
  );
}

export function homeView() {
  const saved = allPeople()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  const el = h(
    'div',
    { class: 'page page--home' },
    h(
      'section',
      { class: 'hero', 'aria-labelledby': 'home-title' },
      h('h1', { id: 'home-title' }, 'Things to talk about, from the years they grew up'),
      h(
        'p',
        { class: 'lede' },
        'Tell Encore a few things an older person loved, and it finds the films, television, music, books, people and brands from the years they grew up. Then it plans a week of short sessions with questions to start a conversation, for one person or for a whole common room.',
      ),
    ),
    h(
      'section',
      { class: 'block', 'aria-labelledby': 'examples-title' },
      h('h2', { id: 'examples-title' }, 'Try an example'),
      h('p', { class: 'block-intro' }, 'These three people are invented. Pick one to see Encore work from start to finish.'),
      h('ul', { class: 'example-grid' }, EXAMPLES.map(exampleButton)),
    ),
    h(
      'section',
      { class: 'block block--start', 'aria-labelledby': 'start-title' },
      h('h2', { id: 'start-title' }, 'Or plan for someone you know'),
      h('p', { class: 'block-intro' }, 'You need a nickname and a few of their favourites. A real name is not needed.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn--primary btn--large', href: '#/new' }, 'Start with someone you know'), h('a', { class: 'btn btn--secondary btn--large', href: '#/room' }, 'Plan for a common room')),
    ),
    saved.length
      ? h(
          'section',
          { class: 'block', 'aria-labelledby': 'saved-title' },
          h('h2', { id: 'saved-title' }, 'Pick up where you left off'),
          h(
            'ul',
            { class: 'resume-list' },
            saved.map((p) =>
              h('li', null, h('a', { class: 'resume-link', href: stageRoute(p) }, h('span', { class: 'resume-name' }, p.input.nickname), h('span', { class: 'resume-stage' }, stageLabel(p)))),
            ),
          ),
        )
      : null,
  );

  return { title: 'Memory sessions from what they loved', el };
}
