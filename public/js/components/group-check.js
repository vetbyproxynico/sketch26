import { announce, h, replaceChildren, uid } from '../dom.js';
import { LIMITS } from '../api.js';
import { chosenLove } from '../flows.js';
import { checkGroupBook } from '../group-flows.js';
import { session } from '../session.js';
import { Source } from '../words.js';
import { matchList } from './match-list.js';
import { button, errorPanel, field, loading, setBusy } from './ui.js';

/*
 * "Check a book we already have", for a group: the class set in the cupboard
 * gets a column of its own, with the same warm, lukewarm and cold cells. The
 * adult types a title, Rung finds it, the adult confirms which book was meant,
 * and each row's closeness to it is asked of Qloo.
 */

/**
 * @param {{ getRecord: () => object, getResults: () => object, onResults: (results: object) => void, owner: string, onTrace?: () => void }} options
 */
export function groupCheckTool({ getRecord, getResults, onResults, owner, onTrace }) {
  const input = h('input', { type: 'text', autocomplete: 'off', maxlength: String(LIMITS.name) });
  const titleField = field({ label: 'Title of a book you already have', hint: 'Type the title as it is on the spine.', control: input });
  const out = h('div', { class: 'book-check__out', 'aria-live': 'polite' });
  let controller = null;
  let busy = false;

  async function score(book) {
    const record = getRecord();
    controller = new AbortController();
    replaceChildren(out, loading(`Checking ${book.name} against every row`));
    const next = await checkGroupBook(record, getResults(), book, { signal: controller.signal });
    onTrace?.();
    onResults(next);
    announce(`Checked ${book.name}. It has a column on the board.`);
    replaceChildren(out, h('p', { class: 'fine' }, `${book.name} is on the board as “A book we already have”.`));
  }

  async function run() {
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (name === '') {
      titleField.error('Type a title to check.');
      input.focus();
      return;
    }
    titleField.error(null);
    const api = session.apiFor(getRecord());
    if (!api) {
      replaceChildren(out, h('p', { class: 'fine' }, 'The live service is not available now, so a book cannot be checked.'));
      return;
    }
    if (busy) return;
    busy = true;
    setBusy(go, true);
    controller?.abort();
    controller = new AbortController();
    replaceChildren(out, loading(`Looking up ${name}`));
    try {
      const found = await api.resolve([{ name, kind: 'book' }], { signal: controller.signal });
      session.logTrace(owner, 'Finding a book we have', found.trace);
      onTrace?.();
      const one = found.resolved[0];
      if (!one || one.status === 'unresolved') {
        replaceChildren(out, h('div', { class: 'note' }, h('p', { class: 'note__title' }, `${Source()} does not know this book`), h('p', null, one?.hint ?? 'Try the title without the subtitle, or check the spelling.')));
        announce(`${Source()} does not know this book.`);
        return;
      }
      const candidates = [one.chosen, ...one.alternatives.filter((other) => other.id !== one.chosen.id)].slice(0, 4);
      if (one.status === 'resolved' || candidates.length === 1) {
        await score(candidates[0]);
        return;
      }
      const entry = { key: uid('book'), query: name, kind: 'book', status: 'ambiguous', candidates, pick: 0, removed: false };
      const picker = matchList([entry]);
      const choose = button({
        label: 'Check the one I picked',
        variant: 'primary',
        onClick: async () => {
          if (busy) return;
          busy = true;
          setBusy(choose, true);
          try {
            await score(chosenLove(entry));
          } catch (error) {
            replaceChildren(out, errorPanel(error, { onRetry: () => choose.click(), onSample: () => session.useSample?.() }));
          } finally {
            busy = false;
            setBusy(choose, false);
          }
        },
      });
      replaceChildren(out, picker.el, h('div', { class: 'actions' }, choose));
      announce('More than one book matched. Pick the one you mean.');
    } catch (error) {
      replaceChildren(out, errorPanel(error, { onRetry: () => run(), onSample: () => session.useSample?.() }));
    } finally {
      busy = false;
      setBusy(go, false);
    }
  }

  const go = button({ label: 'Check this book', variant: 'secondary', onClick: run });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });
  return {
    el: h('div', { class: 'book-check' }, h('div', { class: 'inline-form inline-form--one' }, titleField.el, go), out),
    dispose() {
      controller?.abort();
    },
  };
}
