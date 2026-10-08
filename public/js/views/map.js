import * as api from '../api.js';
import { entry } from '../components/entry.js';
import { journey } from '../components/journey.js';
import { mapWorkBlock } from '../components/map-work.js';
import { emptyBlock, errorBlock, loadingBlock, retryButton } from '../components/status.js';
import { announce, focusEl, h, scrollToEl } from '../dom.js';
import { buildMap, noteNames } from '../flow.js';
import { DOMAIN_EMPTY, DOMAIN_HEADING, DOMAIN_ORDER, SAMPLE_FILTER_NOTE, hasFilters, personSummary, plural } from '../format.js';
import { navigate } from '../router.js';
import { getPerson } from '../store.js';

export function mapView(id) {
  const person = getPerson(id);
  if (!person) return missing();
  if (!person.profile) {
    // Nothing confirmed yet: send the carer back one step.
    window.setTimeout(() => navigate(`/person/${encodeURIComponent(person.id)}/favourites`), 0);
    return { title: 'Redirecting', el: h('div', { class: 'page' }, h('h1', null, 'One moment')) };
  }

  let alive = true;
  let controller = null;
  const holder = h('div', { class: 'holder' });
  const el = h(
    'div',
    { class: 'page page--wide' },
    journey(person, 'map'),
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, `${person.input.nickname}'s cultural map`),
      h('p', { class: 'person-line' }, personSummary(person.input)),
    ),
    holder,
  );

  async function load(force) {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    // The button that was pressed is about to disappear, so keep the keyboard on this page.
    if (force) focusEl(el.querySelector('h1'));
    holder.replaceChildren(loadingBlock('Building the map...', 'Encore is asking the taste service about each kind of thing. This can take up to half a minute.'));
    try {
      if (force || !person.map || (person.sample && !api.isSample())) await buildMap(person, { signal });
      if (!alive) return;
      render();
      const total = countSuggestions(person.map);
      announce(total ? `The map is ready, with ${plural(total, 'suggestion', 'suggestions')}.` : 'The map is ready, but nothing was found for it.');
    } catch (error) {
      if (!alive || api.isAborted(error)) return;
      holder.replaceChildren(
        errorBlock('The map could not be built', api.plainError(error, 'build the map'), [
          retryButton('Try again', () => load(true)),
          h('a', { class: 'btn btn--quiet', href: `#/person/${encodeURIComponent(person.id)}/favourites` }, 'Back to favourites'),
        ]),
      );
    }
  }

  function planButton(extraClass) {
    return h(
      'a',
      { class: `btn btn--primary btn--large ${extraClass || ''}`, href: `#/person/${encodeURIComponent(person.id)}/plan` },
      'Plan the week',
    );
  }

  function render() {
    const map = person.map;
    const parts = [];
    const nothingFound = countSuggestions(map) === 0;

    if (map.window) {
      parts.push(
        h(
          'p',
          { class: 'lede' },
          `Films, television, books and people here come from ${map.window.fromYear} to ${map.window.toYear}, when ${person.input.nickname} was about 10 to 30.`,
        ),
      );
    }

    if (!nothingFound) {
      parts.push(
        h(
          'div',
          { class: 'actions actions--top' },
          planButton(),
          h('button', { type: 'button', class: 'btn btn--quiet btn--large', onClick: () => load(true) }, 'Build the map again'),
        ),
      );
    }

    // Warnings that say suggestions were left out because of the avoid list or gentle mode.
    const filterWarnings = (map.warnings || []).filter((w) => w.code === 'avoided' || w.code === 'gentle');
    const emptiedByFilters = new Set(filterWarnings.flatMap((w) => (Array.isArray(w.emptied) ? w.emptied : [])));

    const notes = noteNames(person);
    const messages = (map.warnings || []).map((w) => w.message);
    // Sample mode never reaches the server, so the avoid list and gentle mode do nothing: say so.
    if (api.isSample() && hasFilters(person.profile || person.input)) messages.push(SAMPLE_FILTER_NOTE);
    if (notes.length) messages.push(`${notes.join(', ')} could not be matched, so ${notes.length === 1 ? 'it was' : 'they were'} kept as ${notes.length === 1 ? 'a note' : 'notes'} and not used.`);
    if (messages.length) {
      parts.push(
        h('section', { class: 'notice notice--soft', 'aria-labelledby': 'good-to-know' }, h('h2', { id: 'good-to-know', class: 'notice-title' }, 'Good to know'), h('ul', null, messages.map((m) => h('li', null, m)))),
      );
    }

    // What the map builder did, after the notices and before the lists. Kept for a map that found nothing too: it says what was tried.
    const work = mapWorkBlock(person.mapWork, person.sample === true || api.isSample());
    if (work) parts.push(work);

    if (nothingFound && filterWarnings.length) {
      // Something was found, and the filters left out all of it.
      parts.push(
        emptyBlock('Your filters left nothing to show', 'Everything Encore found matched something you asked to avoid, or gentle mode. To see more, change the things to avoid, or turn gentle mode off, on the details page.', [
          h('a', { class: 'btn btn--primary', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Change the details'),
        ]),
      );
      holder.replaceChildren(...parts);
      return;
    }

    if (nothingFound) {
      parts.push(
        emptyBlock('Nothing was found for this map', 'The taste service had no suggestions for these favourites and years. Try other favourites, or build the map again in a moment.', [
          h('a', { class: 'btn btn--primary', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Change the favourites'),
          h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => load(true) }, 'Build the map again'),
        ]),
      );
      holder.replaceChildren(...parts);
      return;
    }

    if ((map.tasteWords || []).length) {
      parts.push(
        h(
          'section',
          { class: 'taste', 'aria-labelledby': 'taste-title' },
          h('h2', { id: 'taste-title' }, `${person.input.nickname}'s taste in words`),
          h('ul', { class: 'tags' }, map.tasteWords.map((t) => h('li', { class: 'tag' }, t.name))),
        ),
      );
    }

    parts.push(
      h(
        'details',
        { class: 'legend' },
        h('summary', null, 'What do the labels under each name mean?'),
        h(
          'dl',
          null,
          h('dt', null, 'From their years'),
          h('dd', null, `The date of the film, programme or book was checked against the years ${person.input.nickname} was about 10 to 30. For a person, it was the year they were born, in the decades around ${person.input.nickname}'s own.`),
          h('dt', null, 'From a little outside their years'),
          h('dd', null, 'Too little came back for their own years, so Encore also looked a few years either side. The label names the years it first asked for.'),
          h('dt', null, 'Popular with older people'),
          h('dd', null, 'Music and brands have no date to check, so Encore looked at how popular they are with people over 55.'),
          h('dt', null, 'Era not checked'),
          h('dd', null, 'There was no way to check, so treat it as a maybe.'),
          h('dt', null, 'Because they liked'),
          h('dd', null, 'The favourites that led to this suggestion, with the bar showing how strong the link is.'),
        ),
      ),
    );

    const jump = h('div', { class: 'jump', role: 'group', 'aria-label': 'Jump to a group' });
    const sections = [];
    for (const domain of DOMAIN_ORDER) {
      const items = (map.byDomain && map.byDomain[domain]) || [];
      const headingId = `map-${domain}`;
      const heading = h('h2', { id: headingId, class: 'domain-title', tabindex: '-1' }, DOMAIN_HEADING[domain], h('span', { class: 'domain-count' }, plural(items.length, 'suggestion', 'suggestions')));
      const warn = (map.warnings || []).filter((w) => w.domain === domain && w.code !== 'no_era_filter');
      const section = h(
        'section',
        { class: `domain domain--${domain}`, 'aria-labelledby': headingId },
        heading,
        warn.map((w) => h('p', { class: 'hint' }, w.message)),
        items.length
          ? h('ul', { class: 'entries' }, items.map((item) => h('li', null, entry(item, { headingLevel: 3, nickname: person.input.nickname, window: map.window }))))
          : emptiedByFilters.has(domain)
            ? emptyBlock('Nothing is left here after your filters', 'Everything Encore found in this group matched something you asked to avoid, or gentle mode. The other groups are not affected. To see more, change the things to avoid, or turn gentle mode off, on the details page.')
            : emptyBlock(DOMAIN_EMPTY[domain], 'The taste service had nothing to suggest here. The other groups are not affected.'),
      );
      sections.push(section);
      jump.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--chip',
            onClick: () => {
              scrollToEl(section);
              heading.focus({ preventScroll: true });
            },
          },
          `${DOMAIN_HEADING[domain]} (${items.length})`,
        ),
      );
    }
    parts.push(h('div', { class: 'jump-wrap' }, h('p', { class: 'jump-label' }, 'Jump to'), jump));
    parts.push(...sections);
    parts.push(h('div', { class: 'actions actions--end' }, planButton()));

    holder.replaceChildren(...parts);
  }

  load(false);

  return {
    title: `${person.input.nickname}'s cultural map`,
    el,
    dispose() {
      alive = false;
      if (controller) controller.abort();
    },
  };
}

function countSuggestions(map) {
  return DOMAIN_ORDER.reduce((n, d) => n + (map && map.byDomain && Array.isArray(map.byDomain[d]) ? map.byDomain[d].length : 0), 0);
}

function missing() {
  return {
    title: 'Person not found',
    el: h('div', { class: 'page' }, h('h1', null, 'That person is not saved here'), h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to the start')),
  };
}
