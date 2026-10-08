import { announce, h, replaceChildren, uid } from '../dom.js';
import { LIMITS } from '../api.js';
import { becauseChips, flagList } from './rung.js';
import { matchList } from './match-list.js';
import { button, errorPanel, field, loading, setBusy } from './ui.js';
import { chosenLove } from '../flows.js';
import { session } from '../session.js';

/*
 * "Check a book we already have": the adult types a title, Rung finds it, and
 * shows how close it is to this reader and which loves it connects to. The
 * answer is shown and then forgotten. It changes nothing about the ladder.
 */

function closenessLine(closeness, rungs) {
  if (closeness === null) return 'Qloo gave no closeness score for this book, so Rung cannot say how close it is.';
  const scores = rungs.map((rung) => rung.closeness);
  if (scores.length === 0) return 'The ladder has no books to compare it with.';
  const high = Math.max(...scores);
  const low = Math.min(...scores);
  if (closeness >= high) return 'Closer than every book on this ladder.';
  if (closeness >= low) return 'Within the range of the books on this ladder.';
  return 'Not as close as any book on this ladder.';
}

/**
 * @param {{ getRecord: () => object, getApi: () => object | null, owner: string, onTrace?: () => void }} options
 */
export function checkTool({ getRecord, getApi, owner, onTrace }) {
  const input = h('input', { type: 'text', autocomplete: 'off', maxlength: String(LIMITS.name) });
  const titleField = field({ label: 'Title of a book you already have', hint: 'Type the title as it is on the spine.', control: input });
  const out = h('div', { class: 'book-check__out', 'aria-live': 'polite' });
  let controller = null;
  let busy = false;

  function showResult(book, answer) {
    const record = getRecord();
    const meter = answer.closeness === null ? null : h('meter', { class: 'book-check__meter', min: '0', max: '1', value: String(Math.min(1, Math.max(0, answer.closeness))), 'aria-label': `Closeness ${Math.round(answer.closeness * 100)} out of 100` }, String(Math.round(answer.closeness * 100)));
    const flags = [];
    if (answer.adultSkew) flags.push('adult_skew');
    replaceChildren(
      out,
      h(
        'div',
        { class: 'book-check__result card' },
        h('h3', { class: 'book-check__title' }, book.name),
        meter ? h('p', { class: 'book-check__score' }, meter, h('span', { class: 'book-check__number' }, `${Math.round(answer.closeness * 100)} out of 100`)) : null,
        h('p', null, closenessLine(answer.closeness, record.ladder?.rungs ?? [])),
        answer.alreadyDone ? h('p', { class: 'book-check__done' }, 'This book is already on this reader’s done list, so Rung will not suggest it.') : null,
        answer.links.length > 0
          ? h('div', null, h('p', { class: 'label' }, 'Loves it connects to'), becauseChips(answer.links))
          : h('p', null, 'Qloo found no link between this book and what they love.'),
        flagList(flags),
        h('p', { class: 'fine' }, 'This only shows closeness in taste. It does not say whether the book is suitable or how hard it is. You decide.'),
      ),
    );
    announce(`Checked ${book.name}.`);
  }

  async function checkBook(book) {
    const api = getApi();
    controller = new AbortController();
    replaceChildren(out, loading(`Checking ${book.name}`));
    const answer = await api.check(getRecord().state, book, { signal: controller.signal });
    session.logTrace(owner, 'Checking a book we have', answer.trace);
    onTrace?.();
    showResult(book, answer);
  }

  async function run() {
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (name === '') {
      titleField.error('Type a title to check.');
      input.focus();
      return;
    }
    if (name.length > LIMITS.name) {
      titleField.error(`A title can be at most ${LIMITS.name} characters.`);
      return;
    }
    titleField.error(null);
    const api = getApi();
    if (!api) {
      replaceChildren(out, h('p', { class: 'fine' }, 'The live service is not available now, so this reader cannot be checked against a book.'));
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
        replaceChildren(out, h('div', { class: 'note' }, h('p', { class: 'note__title' }, 'Qloo does not know this book'), h('p', null, one?.hint ?? 'Try the title without the subtitle, or check the spelling.')));
        announce('Qloo does not know this book.');
        return;
      }
      const candidates = [one.chosen, ...one.alternatives.filter((other) => other.id !== one.chosen.id)].slice(0, 4);
      if (one.status === 'resolved' || candidates.length === 1) {
        await checkBook(candidates[0]);
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
            await checkBook(chosenLove(entry));
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
  const el = h('div', { class: 'book-check' }, h('div', { class: 'inline-form inline-form--one' }, titleField.el, go), out);
  return {
    el,
    dispose() {
      controller?.abort();
    },
  };
}

