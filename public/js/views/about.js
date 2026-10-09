import { h } from '../dom.js';
import { linkButton } from '../components/ui.js';
import { session } from '../session.js';

/* About: what Rung is, what it does not know, what leaves the browser, and how it is made. */

const FLOWS = [
  { data: 'Nickname', browser: 'Yes', server: 'Never', qloo: 'Never', model: 'Never' },
  { data: 'Age band (one of three)', browser: 'Yes', server: 'Yes', qloo: 'No. Only the IDs of its tags', model: 'Yes, as a hint about how to write' },
  { data: 'Names of loves', browser: 'Yes', server: 'Yes', qloo: 'Yes, as search text and IDs', model: 'Yes, if the server has a model: to write the reasons, and to read the sentence box' },
  { data: 'The sentence about tastes, if you use it', browser: 'No', server: 'Yes, once, not kept', qloo: 'No', model: 'Yes, after emails, phone numbers and web addresses are removed' },
  { data: 'Search word for a theme to rule out (40 characters at most)', browser: 'No', server: 'Yes', qloo: 'Yes, as a tag search', model: 'Never' },
  { data: 'Verdicts (fixed choices, no free text)', browser: 'Yes', server: 'Yes', qloo: 'No. Only the IDs they add or remove', model: 'Never' },
  { data: 'Headcount for a group row (a number)', browser: 'Yes', server: 'Yes', qloo: 'No', model: 'Counts only' },
];

function flowCard(flow) {
  const row = (term, value) => h('div', { class: 'flow__row' }, h('dt', null, term), h('dd', null, value));
  return h('li', { class: 'flow' }, h('h3', { class: 'flow__title' }, flow.data), h('dl', { class: 'flow__list' }, row('Kept in this browser', flow.browser), row('Sent to Rung’s server', flow.server), row('Sent to Qloo', flow.qloo), row('Sent to a language model', flow.model)));
}

export async function aboutView() {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'About Rung');
  const llm = session.health?.llmProvider ?? 'none';
  const modelLine =
    session.mode === 'sample'
      ? 'You are in sample mode. Nothing is sent to any server or model.'
      : llm === 'anthropic'
        ? 'This server uses a language model run by Anthropic for three small writing jobs.'
        : llm === 'workers-ai'
          ? 'This server uses a language model on Cloudflare Workers AI for three small writing jobs.'
          : 'This server uses no language model at the moment, so every line Rung writes comes from a template.';

  const root = h(
    'div',
    { class: 'page prose' },
    title,
    h('p', { class: 'lede' }, 'Rung helps an adult choose the next book for a child who can read but will not finish one. It starts from what the child already loves that is not a book.'),

    h('section', { 'aria-labelledby': 'what' },
      h('h2', { id: 'what' }, 'What Rung is'),
      h('p', null, 'You tell Rung the games, programmes, films, musicians and people a reader loves. Rung asks Qloo, a taste service, which books are loved by people who love the same things. It puts the closest books on the first rung of a short ladder and steps outward from there. Each pick comes with a reason in the child’s own terms.'),
      h('p', null, 'After each book you tap one verdict. Rung re-plans and tells you what changed. Without Qloo there would be no candidate books, no closeness and no reasons.'),
    ),

    h('section', { 'aria-labelledby': 'not' },
      h('h2', { id: 'not' }, 'What Rung does not know'),
      h('ul', { class: 'plain-list plain-list--bold' },
        h('li', null, 'Rung does not know whether a book is suitable for a child of any age.'),
        h('li', null, 'Rung does not know how long or how hard a book is.'),
        h('li', null, 'A ruled-out theme can still appear in a book if the book is not tagged with it.'),
        h('li', null, 'Rung makes no claim that it improves reading.'),
      ),
      h('p', null, 'Rung is not an age-rating service and not a reading scheme. It does not assess reading ability. The adult decides what a child reads. Nothing is handed over until you press “I have checked it. Start reading”.'),
      h('p', null, 'What Rung does promise: picks that are close in taste to what the child loves, with the evidence shown; any theme you rule out is sent to Qloo and checked again on Rung’s server against the tags each book carries; and a book that Qloo’s data shows as liked mostly by adults carries a flag.'),
    ),

    h('section', { 'aria-labelledby': 'flow' },
      h('h2', { id: 'flow' }, 'What leaves your browser, and to whom'),
      h('ul', { class: 'flow-list' }, FLOWS.map(flowCard)),
      h('p', null, 'The server keeps nothing about a reader. The browser holds the reader and sends it with each request. The only thing the server stores is a private cache of Qloo answers, keyed by the question, which holds IDs and filters and nothing that names a person.'),
      h('p', null, modelLine),
      h('p', null, 'To stop one visitor using up the free demo, the server keeps a count of requests for a short time against a one-way hash of your network address, mixed with the day. It is not used for anything else.'),
    ),

    h('section', { 'aria-labelledby': 'saved' },
      h('h2', { id: 'saved' }, 'What is saved on this device'),
      h('p', null, 'Nothing is saved until you press “Save on this device”. A shared staff-room computer is the reason. What you save stays in this browser: the nickname, the age band, the loves, the ladder and the verdicts with their dates. You can see all of it, and delete it, on one page.'),
      linkButton({ label: 'See and delete what is saved here', href: '#/saved', icon: 'save' }),
    ),

    h('section', { 'aria-labelledby': 'third' },
      h('h2', { id: 'third' }, 'Requests to other sites'),
      h('p', null, 'This page loads no fonts, scripts, analytics or cookies from anywhere else, and the browser never talks to Qloo. Two things can reach another site, and only when you choose them. “Look it up” opens a web search for a title and author in a new tab. Cover pictures, if you turn them on, load from the address Qloo gives, so that site learns the book was looked at.'),
    ),

    h('section', { 'aria-labelledby': 'made' },
      h('h2', { id: 'made' }, 'How it is made'),
      h('p', null, 'Rung is an entry for the Qloo Agentic Hackathon. It is open source under the MIT licence. It was built with AI assistance (Claude, by Anthropic), and the code, the tests and this wording were all written that way.'),
      h('p', null, 'A language model, when the server has one, does three small jobs: it reads your sentence about tastes, writes the one-line reasons, and says in a sentence or two why some readers are left cold. It never chooses a book and never sees an ID or a score. Every reply is checked, and each job has a plain template when there is no model.'),
    ),
  );
  return { title: 'About', el: root, heading: title };
}
