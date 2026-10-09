import { h } from '../dom.js';
import { linkButton } from '../components/ui.js';
import { kindMark } from '../kinds.js';
import { EXAMPLE_GROUP, EXAMPLE_READERS } from '../examples.js';
import { session } from '../session.js';
import { AGE_BANDS } from '../words.js';

/* Home: two doors, the examples, and a link to what is saved. */

function ladderGraphic() {
  // Decorative: five steps of the ladder motif.
  const steps = [1, 2, 3, 4, 5].map((n) => h('span', { class: 'steps__step', style: { '--n': n } }));
  return h('div', { class: 'steps', 'aria-hidden': 'true' }, steps);
}

function door({ number, title, text, href, cta }) {
  return h(
    'section',
    { class: 'door', 'aria-labelledby': `door-${number}` },
    h('p', { class: 'label door__number', 'aria-hidden': 'true' }, `0${number}`),
    h('h2', { id: `door-${number}`, class: 'door__title' }, title),
    h('p', null, text),
    linkButton({ label: cta, href, variant: 'primary', icon: 'arrow' }),
  );
}

function readerCard(example) {
  const band = AGE_BANDS.find((one) => one.id === example.ageBand)?.label ?? '';
  const kinds = [...new Set(example.loves.map((love) => love.kind))];
  return h(
    'li',
    { class: 'example' },
    h('article', { class: 'card example__card', 'aria-labelledby': `ex-${example.id}` },
      h('p', { class: 'label' }, `Ages ${band}`),
      h('h3', { id: `ex-${example.id}`, class: 'example__name' }, example.nickname),
      h('p', { class: 'example__blurb' }, example.blurb),
      h('p', { class: 'example__loves' }, example.loves.map((love) => love.name).join(', ')),
      h('p', { class: 'example__kinds', 'aria-hidden': 'true' }, kinds.map((kind) => kindMark(kind))),
      linkButton({ label: 'Try this', href: `#/reader/try/${example.id}`, variant: 'primary', ariaLabel: `Try this example: ${example.nickname}, ages ${band}` }),
    ),
  );
}

function groupCard() {
  const readers = EXAMPLE_GROUP.rows.reduce((sum, row) => sum + row.headcount, 0);
  return h(
    'article',
    { class: 'card example__card example__card--group', 'aria-labelledby': 'ex-group' },
    h('p', { class: 'label' }, `${readers} readers, ${EXAMPLE_GROUP.rows.length} taste groups`),
    h('h3', { id: 'ex-group', class: 'example__name' }, EXAMPLE_GROUP.label),
    h('p', { class: 'example__blurb' }, 'A club with six different tables. Which shared book would leave someone cold, and what then?'),
    linkButton({ label: 'Try this', href: '#/group/try', variant: 'primary', ariaLabel: `Try this example: ${EXAMPLE_GROUP.label}, ${readers} readers` }),
  );
}

export async function homeView() {
  const saved = session.store.readers().length + session.store.groups().length;
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'From what they play to what they read');
  const root = h(
    'div',
    { class: 'page home' },
    h('header', { class: 'hero' },
      h('p', { class: 'label' }, 'For parents, teachers and librarians'),
      title,
      h('p', { class: 'lede' }, 'Tell Rung the games, programmes, films and music a reluctant reader of about 8 to 16 already loves. It builds a short ladder of books, closest to what they love first and stepping outward, and says why each one is there.'),
      ladderGraphic(),
    ),
    h('div', { class: 'doors' },
      door({ number: 1, title: 'One reader', text: 'Pick what they love, tap once, and get the first rung of a ladder. Then tell Rung how each book went.', href: '#/reader/new', cta: 'Start with one reader' }),
      door({ number: 2, title: 'A group or class', text: 'See which shared book would leave someone cold, who it would leave cold, and how to split in two.', href: '#/group/new', cta: 'Start with a group' }),
    ),
    h('section', { class: 'section', 'aria-labelledby': 'try-heading' },
      h('h2', { id: 'try-heading' }, 'Try an example'),
      h('p', { class: 'section__lede' }, 'No typing needed. Each button builds a full ladder or a full table from invented readers.'),
      h('ul', { class: 'example-list' }, EXAMPLE_READERS.map(readerCard)),
      groupCard(),
    ),
    h('section', { class: 'section how', 'aria-labelledby': 'how-heading' },
      h('h2', { id: 'how-heading' }, 'How it works'),
      h('ol', { class: 'how__list' },
        h('li', null, h('strong', null, 'Say what they love.'), ' Games, programmes, films, music and people they follow. One to eight.'),
        h('li', null, h('strong', null, 'Climb the ladder.'), ' Three to five books. The first is closest to what they love. Each next one steps a little further out.'),
        h('li', null, h('strong', null, 'Tap how it went.'), ' Loved it, finished it, or gave up and why. Rung re-plans and says what changed.'),
      ),
    ),
    h('p', { class: 'fine home__fine' }, 'Rung is a book-choosing aid. It matches taste, so it is not an age rating and it does not assess reading. You decide what a child reads.'),
    saved > 0 ? h('p', { class: 'home__saved' }, linkButton({ label: 'Saved on this device', href: '#/saved', icon: 'save' })) : null,
  );
  return { title: 'Books a reluctant reader might finish', el: root, heading: title };
}
