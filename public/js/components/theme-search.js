import { announce, h, replaceChildren, uid } from '../dom.js';
import { LIMITS } from '../api.js';
import { button, errorPanel, field, toggleChip } from './ui.js';
import { session } from '../session.js';

/*
 * "Search for a theme to rule out": looks a word up as a book tag (POST
 * /api/themes) and shows the tags as chips to switch on. The chosen tags are
 * the adult's own rule-outs and are sent as they are. A search sends at most 40
 * characters, and never the child's name or nickname.
 */

/**
 * @param {{ getTags: () => Array<{id: string, name: string}>, setTags: (tags: Array) => void, owner: string, max?: number }} options
 */
export function themeSearch({ getTags, setTags, owner, max = LIMITS.excludedTags }) {
  const input = h('input', { type: 'search', autocomplete: 'off', spellcheck: 'false', maxlength: String(LIMITS.word) });
  const search = field({ label: 'Search for a theme to rule out', hint: 'One word, such as dragons or ghosts. Rung looks it up as a book tag.', control: input });
  const results = h('div', { class: 'theme-results', 'aria-live': 'polite' });
  const chosen = h('div', { class: 'theme-chosen' });
  let controller = null;
  const gate = { busy: false };

  function renderChosen() {
    const tags = getTags();
    replaceChildren(
      chosen,
      tags.length === 0
        ? null
        : h(
            'div',
            null,
            h('p', { class: 'label' }, `Ruled out by search (${tags.length} of ${max})`),
            h('ul', { class: 'toggle-grid' }, tags.map((tag) => h('li', null, toggleChip({ label: tag.name, pressed: true, ariaLabel: `Ruled out: ${tag.name}. Press to allow it again`, onToggle: () => {
              setTags(getTags().filter((one) => one.id !== tag.id));
              renderChosen();
              announce(`${tag.name} is no longer ruled out.`);
            } })))),
          ),
    );
  }

  function showTags(tags, word) {
    if (tags.length === 0) {
      replaceChildren(results, h('p', { class: 'fine' }, `Rung found no book tag for “${word}”. Try another word, or a shorter one.`));
      return;
    }
    replaceChildren(
      results,
      h('p', { class: 'label' }, `Tags for “${word}”. Press to rule out`),
      h('ul', { class: 'toggle-grid' }, tags.map((tag) => {
        const on = getTags().some((one) => one.id === tag.id);
        return h('li', null, toggleChip({
          label: tag.name,
          pressed: on,
          onToggle(next) {
            const others = getTags().filter((one) => one.id !== tag.id);
            if (next && others.length >= max) {
              announce(`Rung keeps at most ${max} ruled-out themes.`);
              return;
            }
            setTags(next ? [...others, { id: tag.id, name: tag.name, ...(tag.type ? { type: tag.type } : {}) }] : others);
            renderChosen();
            announce(next ? `${tag.name} ruled out.` : `${tag.name} allowed again.`);
          },
        }));
      })),
    );
  }

  async function run() {
    const word = input.value.replace(/\s+/g, ' ').trim();
    if (word === '') {
      search.error('Type a word to search for.');
      input.focus();
      return;
    }
    search.error(null);
    if (gate.busy) return;
    gate.busy = true;
    controller?.abort();
    controller = new AbortController();
    go.setAttribute('aria-disabled', 'true');
    replaceChildren(results, h('p', { role: 'status', class: 'fine' }, `Looking up “${word}”`));
    try {
      const answer = await session.api.themes(word, { signal: controller.signal });
      session.logTrace(owner, 'Theme search', answer.trace);
      showTags(answer.tags, word);
      announce(answer.tags.length === 0 ? 'No tags found.' : `${answer.tags.length} tags found.`);
    } catch (error) {
      replaceChildren(results, errorPanel(error, { onRetry: run, onSample: () => session.useSample?.() }));
    } finally {
      gate.busy = false;
      go.removeAttribute('aria-disabled');
    }
  }

  const go = button({ label: 'Search', variant: 'secondary', icon: 'search', onClick: run, ariaLabel: 'Search for this theme' });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });
  renderChosen();
  const id = uid('themes');
  return {
    el: h('div', { class: 'theme-search', id }, h('div', { class: 'inline-form inline-form--one' }, search.el, go), results, chosen),
    refresh: renderChosen,
    dispose() {
      controller?.abort();
    },
  };
}
