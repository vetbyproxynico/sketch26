import { announce, focusEl, h, plural, replaceChildren } from '../dom.js';
import { ApiError, createGate } from '../api.js';
import { checkTool } from '../components/check-tool.js';
import { loveChip } from '../components/chips.js';
import { dock, mountDock } from '../components/dock.js';
import { drawRailLines } from '../components/rail-lines.js';
import { foldedRung, lookItUp, openRung } from '../components/rung.js';
import { tracePanel } from '../components/trace-panel.js';
import { button, errorPanel, linkButton, loading, noteList, note, toggleChip } from '../components/ui.js';
import { applyLadderAnswer, applyVerdictAnswer, climbed, displayName, isReading, openRungs, possessive, setAside } from '../records.js';
import { checkStore, persistReader, session } from '../session.js';
import { GIVE_UP_REASONS, SWAP_REASONS, verdictWords } from '../words.js';
import { runner } from './try.js';

/*
 * R3 to R5: the ladder. Home base, the stepped rungs, the one action for the
 * rung that is Now, verdicts, "What changed", the honest stop, the reading
 * links, "Check a book we already have" and "Show the working".
 *
 * The record is changed only after the server has answered with a good shape.
 * A failed answer leaves the ladder as it was, with a way to try again.
 */

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const numberWord = (count) => NUMBER_WORDS[count] ?? String(count);

const STOP_FALLBACK = 'Three in a row have not worked. The links Qloo has for these loves may be too weak. Add different loves, or stop here.';
const MAX_TAG_CHOICES = 24;

/** The record for an ID: the one being worked on, or a copy of the saved one. */
export function loadRecord(id) {
  const open = session.readers.get(id);
  if (open) return open;
  const saved = session.store.getReader(id);
  if (!saved) return undefined;
  const copy = structuredClone(saved);
  session.readers.set(id, copy);
  return copy;
}

export function missingReader() {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That reader is not here');
  return {
    title: 'Reader not found',
    el: h(
      'div',
      { class: 'page prose' },
      title,
      note('Rung keeps nothing until you save it, so a ladder that was not saved is gone after a reload. Start again, or open one you saved.'),
      h('div', { class: 'actions' }, linkButton({ label: 'Start a new reader', href: '#/reader/new', variant: 'primary', icon: 'arrow' }), linkButton({ label: 'See what is saved', href: '#/saved' })),
    ),
    heading: title,
  };
}

/** A note for a reader made with sample data that is open while the live service is in use. */
export function sampleRecordNote(record) {
  if (record.mode !== 'sample' || session.mode === 'sample') return null;
  return note('This reader was built with sample data, so every book on it is invented.', { tone: 'warn', title: 'Sample data' });
}

/** A saved reader that has loves but no ladder (an older save): ask for the ladder again, then show it. */
function rebuildLadderView(record) {
  const name = displayName(record);
  const api = session.apiFor(record);
  if (!api) {
    const title = h('h1', { class: 'page-title', tabindex: '-1' }, record.nickname ? `${possessive(name)} ladder` : 'Your ladder');
    return {
      title: 'Your ladder',
      el: h('div', { class: 'page prose' }, title, note('This reader was built with live data, but the live service is not available now. Try again when it is back.', { tone: 'warn', title: 'Read only for now' }), linkButton({ label: 'See what is saved', href: '#/saved' })),
      heading: title,
    };
  }
  return {
    title: 'Rebuilding the ladder',
    ...runner({
      heading: record.nickname ? `Building ${possessive(name)} ladder again` : 'Building the ladder again',
      summary: 'Rung keeps the loves on this device, not the answers. It asks Qloo again.',
      backHref: '#/saved',
      backLabel: 'Back to what is saved',
      async start({ signal, progress, isGone }) {
        progress('Finding books close to what they love');
        const answer = await api.ladder(record.state, false, { signal });
        if (isGone()) return;
        session.logTrace(record.id, 'Building the ladder', answer.trace);
        applyLadderAnswer(record, answer);
        if (session.store.hasReader(record.id)) persistReader(record);
        session.router.refresh();
      },
    }),
  };
}

export async function ladderView({ id }) {
  const record = loadRecord(id);
  if (!record) return missingReader();
  if (record.ladder === null) return rebuildLadderView(record);
  return buildView(record);
}

function buildView(record) {
  const gate = createGate();
  let controller = null;
  let disposed = false;
  let renderedOnce = false;
  let lineObserver = null;

  const ui = { mode: 'idle', pending: null, tags: new Set(), error: null, busy: false, armedAt: 0, fresh: false, offerBusy: false, retry: null };
  const title = h('h1', { class: 'page-title', tabindex: '-1' });
  const root = h('div', { class: 'page ladder-page' });
  const bar = dock('dock--ladder');
  bar.setAttribute('role', 'group');
  const unmountDock = mountDock(bar);

  const trace = tracePanel(record.id);
  const check = checkTool({ getRecord: () => record, getApi: () => session.apiFor(record), owner: record.id, onTrace: () => trace.refresh() });
  const coversHost = h('div', { class: 'covers' });

  const name = () => displayName(record);
  const frozen = () => session.apiFor(record) === null;
  const isSaved = () => session.store.hasReader(record.id);

  /* ------------------------------------------------------------ saving */

  function keepSaved() {
    if (isSaved()) persistReader(record);
  }

  /* --------------------------------------------------------- the actions */

  /**
   * A tap just after the screen changed is ignored. A double tap on "I have
   * checked it" must not land on "Finished and loved it", which takes its place,
   * and a double tap on "Gave up" must not pick a reason. Nobody reads a book in
   * the time it takes to start it, so that gap is long; picking a reason is
   * quicker, so that gap is short.
   */
  function arm(ms = 350) {
    ui.armedAt = Date.now() + ms;
  }
  const armed = (event) => Date.now() >= ui.armedAt && !(event && event.detail > 1);

  function open(mode, extra = {}) {
    ui.mode = mode;
    ui.pending = extra.pending ?? null;
    ui.tags = new Set();
    ui.error = null;
    arm();
    render({ focus: extra.focus ?? 'panel' });
  }

  function cancel(event) {
    if (!armed(event)) return;
    ui.mode = 'idle';
    ui.pending = null;
    ui.error = null;
    arm();
    render({ focus: 'primary' });
  }

  function startReading(rung, event) {
    if (!armed(event)) return;
    const progress = record.progress;
    if (!progress.checked.includes(rung.book.id)) progress.checked.push(rung.book.id);
    progress.reading = rung.book.id;
    record.updatedAt = new Date().toISOString();
    keepSaved();
    announce(`Reading ${rung.book.name}. When they have finished or given up, tap how it went.`);
    arm(1500);
    render({ focus: 'now' });
  }

  /** "Try again" after a failure does the same thing again, not just clears the message. */
  function retryNow() {
    const again = ui.retry;
    ui.error = null;
    if (again) again({ skipGuard: true });
    else render({ focus: 'primary' });
  }

  async function submit(rung, verdict, ruleOut, { skipGuard = false } = {}) {
    if (!skipGuard && !armed()) return;
    ui.retry = (options) => submit(rung, verdict, ruleOut, options);
    await gate.run(async () => {
      const api = session.apiFor(record);
      ui.error = null;
      if (!api) {
        ui.error = new ApiError({ kind: 'network', message: 'The live service is not available.' });
        render({ focus: 'error' });
        return;
      }
      controller = new AbortController();
      ui.busy = true;
      render({ focus: 'none' });
      try {
        const answer = await api.verdict({ state: record.state, ladder: record.ladder, rung: rung.number, verdict, ruleOut, readingLinks: record.readingLinks }, { signal: controller.signal });
        if (disposed) return;
        session.logTrace(record.id, `Verdict: ${verdictWords({ kind: verdict.kind, reason: verdict.reason === 'already_read' ? (verdict.liked ? 'already_read_liked' : 'already_read_not_liked') : verdict.reason }).word}`, answer.trace);
        applyVerdictAnswer(record, rung, verdict, answer);
        ui.mode = 'idle';
        ui.pending = null;
        ui.tags = new Set();
        ui.busy = false;
        ui.fresh = true;
        keepSaved();
        trace.refresh();
        const moved = answer.ladder.rungs.filter((one) => one.badge).length;
        announce(
          answer.stopped
            ? 'Recorded. Three give-ups in a row, so Rung has stopped.'
            : `Recorded. Ladder rebuilt. ${moved === 0 ? 'No rungs changed.' : `${plural(moved, 'rung')} changed.`}`,
        );
        render({ focus: answer.stopped ? 'stop' : 'changed' });
      } catch (error) {
        if (disposed) return;
        ui.busy = false;
        ui.error = error;
        render({ focus: 'error' });
      }
    });
  }

  async function startNext() {
    ui.retry = () => startNext();
    await gate.run(async () => {
      const api = session.apiFor(record);
      if (!api) return;
      controller = new AbortController();
      ui.busy = true;
      ui.error = null;
      render({ focus: 'none' });
      try {
        const answer = await api.ladder(record.state, true, { signal: controller.signal });
        if (disposed) return;
        session.logTrace(record.id, 'Starting the next ladder', answer.trace);
        applyLadderAnswer(record, answer);
        ui.busy = false;
        ui.fresh = false;
        keepSaved();
        trace.refresh();
        announce(`The next ladder is ready. ${plural(answer.ladder.rungs.length, 'rung')}.`);
        render({ focus: 'heading' });
      } catch (error) {
        if (disposed) return;
        ui.busy = false;
        ui.error = error;
        render({ focus: 'error' });
      }
    });
  }

  async function acceptOffer(tag) {
    if (record.state.excludedTags.length >= 20) {
      announce('Rung keeps at most 20 ruled-out themes.');
      return;
    }
    ui.retry = () => acceptOffer(tag);
    await gate.run(async () => {
      const api = session.apiFor(record);
      if (!api) return;
      controller = new AbortController();
      ui.offerBusy = true;
      ui.error = null;
      render({ focus: 'none' });
      try {
        const state = { ...record.state, excludedTags: [...record.state.excludedTags, tag] };
        const answer = await api.ladder(state, false, { signal: controller.signal });
        if (disposed) return;
        session.logTrace(record.id, `Ruling out ${tag.name}`, answer.trace);
        const rest = (record.lastChange?.offers ?? []).filter((one) => one.id !== tag.id);
        const previous = record.lastChange?.changes ?? [];
        applyLadderAnswer(record, answer);
        record.lastChange = { changes: [...previous, `Will not suggest books tagged ${tag.name} again, and the ladder is rebuilt without them.`], notes: [], offers: rest, at: new Date().toISOString() };
        ui.offerBusy = false;
        ui.fresh = true;
        keepSaved();
        trace.refresh();
        announce(`${tag.name} ruled out. Ladder rebuilt.`);
        render({ focus: 'changed' });
      } catch (error) {
        if (disposed) return;
        ui.offerBusy = false;
        ui.error = error;
        render({ focus: 'error' });
      }
    });
  }

  function declineOffer(tag) {
    if (!record.lastChange) return;
    record.lastChange.offers = record.lastChange.offers.filter((one) => one.id !== tag.id);
    keepSaved();
    announce(`Left ${tag.name} as it is.`);
    render({ focus: 'changed' });
  }

  /* ----------------------------------------------------- action buttons */

  function verdictButtons(rung) {
    return [
      button({ label: 'Finished and loved it', variant: 'primary', icon: 'heart', onClick: () => submit(rung, { kind: 'loved' }) }),
      button({ label: 'Finished it', variant: 'secondary', icon: 'check', onClick: () => submit(rung, { kind: 'finished' }) }),
      button({
        label: 'Gave up',
        variant: 'secondary',
        icon: 'cross',
        onClick: (event) => {
          if (armed(event)) open('gave_up', { focus: 'panel' });
        },
      }),
    ];
  }

  function mainActions(rung, where) {
    if (ui.busy || frozen()) return [];
    if (ui.mode !== 'idle') {
      return where === 'dock' ? [h('p', { class: 'dock__text' }, 'Answer the question in the card above.'), button({ label: 'Cancel', variant: 'secondary', onClick: cancel })] : [];
    }
    if (!isReading(record, rung)) {
      const start = button({ label: 'I have checked it. Start reading', variant: 'primary', icon: 'check', onClick: (event) => startReading(rung, event) });
      return where === 'dock' ? [h('p', { class: 'dock__text' }, rungLabel(rung)), start] : [start];
    }
    return verdictButtons(rung);
  }

  /** The question being asked on the current rung's card. */
  function panelFor(rung) {
    if (ui.mode === 'idle') return null;
    const wrap = (legend, hint, ...children) => h('fieldset', { class: 'ask', 'data-panel': ui.mode }, h('legend', { class: 'ask__legend', tabindex: '-1' }, legend), hint ? h('p', { class: 'fine' }, hint) : null, ...children);
    const cancelButton = button({ label: 'Cancel', variant: 'quiet', onClick: cancel });
    if (ui.mode === 'gave_up') {
      return wrap(
        'Why did they give up?',
        'One tap. Rung uses the reason to choose what comes next.',
        h('div', { class: 'ask__grid' }, GIVE_UP_REASONS.map((reason) => button({
          label: reason.label,
          variant: 'secondary',
          onClick: () => {
            if (!armed()) return;
            if (reason.id === 'too_scary') open('tags', { pending: { kind: 'gave_up', reason: reason.id }, focus: 'panel' });
            else submit(rung, { kind: 'gave_up', reason: reason.id });
          },
        }))),
        cancelButton,
      );
    }
    if (ui.mode === 'swap') {
      return wrap(
        'Why swap this book?',
        'It is taken off the ladder and does not count as a give-up.',
        h('div', { class: 'ask__grid' }, SWAP_REASONS.map((reason) => button({
          label: reason.label,
          variant: 'secondary',
          onClick: () => {
            if (!armed()) return;
            if (reason.id === 'already_read') open('liked', { focus: 'panel' });
            else if (reason.id === 'not_suitable') open('tags', { pending: { kind: 'swap', reason: 'not_suitable' }, focus: 'panel' });
            else submit(rung, { kind: 'swap', reason: 'cannot_get' });
          },
        }))),
        cancelButton,
      );
    }
    if (ui.mode === 'liked') {
      return wrap(
        'Did they like it?',
        null,
        h('div', { class: 'ask__grid' },
          button({ label: 'Yes, they liked it', variant: 'secondary', icon: 'heart', onClick: () => submit(rung, { kind: 'swap', reason: 'already_read', liked: true }) }),
          button({ label: 'No, they did not', variant: 'secondary', icon: 'cross', onClick: () => submit(rung, { kind: 'swap', reason: 'already_read', liked: false }) }),
        ),
        cancelButton,
      );
    }
    // tags: choose themes to rule out
    const tags = rung.book.tags.slice(0, MAX_TAG_CHOICES);
    const go = button({ label: 'Record it and rebuild the ladder', variant: 'primary', onClick: () => submit(rung, ui.pending, [...ui.tags]) });
    const relabel = () => {
      go.querySelector('.btn__text').textContent = ui.tags.size === 0 ? 'Record it without ruling anything out' : `Rule out ${plural(ui.tags.size, 'theme')} and rebuild the ladder`;
    };
    relabel();
    return wrap(
      'Which themes should Rung leave out from now on?',
      tags.length === 0 ? 'Qloo has no tags for this book, so there is nothing to rule out. A ruled-out theme can still appear in a book that is not tagged with it.' : 'Press the ones to rule out. These are Qloo’s tags for this book. You can choose none. A ruled-out theme can still appear in a book that is not tagged with it.',
      tags.length === 0
        ? null
        : h('ul', { class: 'toggle-grid' }, tags.map((tag) => h('li', null, toggleChip({
          label: tag.name,
          pressed: ui.tags.has(tag.id),
          onToggle(next) {
            if (next) ui.tags.add(tag.id);
            else ui.tags.delete(tag.id);
            relabel();
          },
        })))),
      h('div', { class: 'actions' }, go, cancelButton),
    );
  }

  function moreActions(rung) {
    const items = [];
    if (ui.busy) {
      items.push(loading('Recording that and rebuilding the ladder'));
      return items;
    }
    if (ui.error) {
      items.push(errorPanel(ui.error, { onRetry: retryNow, onSample: () => session.useSample?.() }));
    }
    if (isReading(record, rung) && ui.mode === 'idle') {
      items.push(h('p', { class: 'rung__reading' }, h('strong', null, 'Reading now.'), ' When they have finished or given up, tap how it went.'));
    }
    const panel = panelFor(rung);
    if (panel) items.push(panel);
    if (ui.mode === 'idle' && !frozen()) {
      items.push(button({ label: 'Swap this book', variant: 'secondary', icon: 'swap', onClick: (event) => { if (armed(event)) open('swap'); } }));
    }
    items.push(lookItUp(rung.book));
    return items;
  }

  const rungLabel = (rung) => {
    const position = positionFor(rung);
    return `Rung ${position.number} of ${position.total}: ${rung.book.name}`;
  };

  function positionFor(rung) {
    const before = climbed(record).length;
    return { number: before + rung.number, total: before + openRungs(record).length };
  }

  /* --------------------------------------------------------- the pieces */

  function homeBase() {
    return h(
      'section',
      { class: 'home-base', 'aria-labelledby': 'home-base-h' },
      h('h2', { id: 'home-base-h', class: 'home-base__title' }, 'Home base'),
      h('p', { class: 'fine home-base__lede' }, 'What they love. Every pick starts from here.'),
      h('ul', { class: 'chips', 'aria-label': 'What they love' }, record.state.loves.map((love) => loveChip(love))),
      h('p', { class: 'home-base__edit' }, linkButton({ label: 'Change loves or rules', href: `#/reader/edit/${record.id}`, variant: 'quiet' })),
    );
  }

  function changedPanel() {
    const change = record.lastChange;
    if (!change || (change.changes.length === 0 && change.offers.length === 0)) return null;
    const last = record.history[record.history.length - 1];
    const words = last ? verdictWords(last) : null;
    const offers = record.stopped ? [] : change.offers;
    const rungsMoved = (record.ladder?.rungs ?? []).filter((rung) => rung.badge).length;
    return h(
      'section',
      { class: 'changed', 'aria-labelledby': 'changed-h' },
      h('h2', { id: 'changed-h', class: 'changed__title', tabindex: '-1' }, 'What changed'),
      last ? h('p', { class: 'changed__lead' }, h('span', { class: 'label' }, 'Your answer'), ' ', `${words.word}: ${last.title}`) : null,
      h('ul', { class: 'plain-list' }, change.changes.map((line) => h('li', null, line))),
      rungsMoved > 0 ? h('p', { class: 'fine' }, `${plural(rungsMoved, 'rung')} below ${rungsMoved === 1 ? 'is' : 'are'} marked New or Moved.`) : null,
      offers.length > 0
        ? h('div', { class: 'offers' },
            h('p', { class: 'label' }, 'Your call'),
            h('ul', { class: 'offers__list' }, offers.map((tag) => h('li', { class: 'offer' },
              h('p', { class: 'offer__text' }, `Rule out books tagged ${tag.name} for good?`),
              h('div', { class: 'actions' },
                button({ label: 'Rule it out', variant: 'secondary', ariaLabel: `Rule it out: ${tag.name}`, onClick: () => acceptOffer(tag) }),
                button({ label: 'Not now', variant: 'quiet', ariaLabel: `Not now: ${tag.name}`, onClick: () => declineOffer(tag) }),
              ),
            ))),
          )
        : null,
    );
  }

  function stopPanel() {
    const message = record.notes.find((one) => one.code === 'stopped')?.message ?? STOP_FALLBACK;
    return h(
      'section',
      { class: 'stop', 'aria-labelledby': 'stop-h' },
      h('h2', { id: 'stop-h', class: 'stop__title', tabindex: '-1' }, 'Rung is stopping here'),
      h('p', null, message),
      h('p', { class: 'fine' }, 'Rung would rather say this than keep handing over books that are not working.'),
      h('div', { class: 'actions' },
        linkButton({ label: 'Add different loves', href: `#/reader/edit/${record.id}`, variant: 'primary', icon: 'plus' }),
        linkButton({ label: 'Stop here and see the shelf', href: `#/reader/${record.id}/shelf` }),
      ),
    );
  }

  function donePanel() {
    return h(
      'section',
      { class: 'done', 'aria-labelledby': 'done-h' },
      h('h2', { id: 'done-h', class: 'done__title', tabindex: '-1' }, 'Every rung is done'),
      h('p', null, 'That is the whole ladder. The next one starts from the books they finished and loved, with what they first loved moving to a supporting role.'),
      h('div', { class: 'actions' },
        button({ label: 'Start the next ladder', variant: 'primary', icon: 'arrow', onClick: () => startNext() }),
        linkButton({ label: 'See the shelf', href: `#/reader/${record.id}/shelf` }),
      ),
    );
  }

  function emptyPanel() {
    return h(
      'section',
      { class: 'empty', 'aria-labelledby': 'empty-h' },
      h('h2', { id: 'empty-h', tabindex: '-1' }, 'No books came back'),
      h('p', null, 'Qloo had no books for these loves with these rules. Add another love, or widen the years, then try again.'),
      h('div', { class: 'actions' }, linkButton({ label: 'Change loves or rules', href: `#/reader/edit/${record.id}`, variant: 'primary', icon: 'plus' })),
    );
  }

  function ladderList() {
    const done = climbed(record);
    const open = openRungs(record);
    const total = done.length + open.length;
    const items = [];
    const lines = [];
    done.forEach((entry, index) => items.push(foldedRung({ entry, number: index + 1, total, index })));
    let nowCard = null;
    open.forEach((rung, position) => {
      const number = done.length + rung.number;
      const index = done.length + position;
      const current = position === 0 && !frozen();
      const card = openRung({ rung, number, total, index, current });
      if (current) {
        nowCard = card;
        replaceChildren(card.primary, ...mainActions(rung, 'card'));
        replaceChildren(card.more, ...moreActions(rung));
      } else {
        replaceChildren(card.more, lookItUp(rung.book));
      }
      items.push(card.li);
      lines.push({ li: card.li, kinds: [...new Set(rung.links.map((link) => link.kind))] });
    });
    return { items, nowCard, now: open[0], lines };
  }

  function readingLinks() {
    const links = record.readingLinks;
    const loves = record.state.loves;
    const strengthOf = (love) => links.find((one) => one.sourceId === love.id)?.strength;
    const none = loves.filter((love) => strengthOf(love) === 'none');
    const others = loves.length - none.length;
    const sentence =
      none.length === 0
        ? null
        : others === 0
          ? `Qloo found no reading link for ${none.map((love) => love.name).join(', ')}, so Rung has nothing to lean on.`
          : `Qloo found no reading link for ${none.length === 1 ? none[0].name : `${none.slice(0, -1).map((love) => love.name).join(', ')} and ${none[none.length - 1].name}`}, so the ladder leans on the other ${numberWord(others)}.`;
    return h(
      'section',
      { class: 'side-block', 'aria-labelledby': 'links-h' },
      h('h2', { id: 'links-h' }, 'Reading links'),
      h('p', { class: 'fine' }, 'How much each thing they love pulled on these picks, from Qloo’s data.'),
      links.length === 0
        ? h('p', null, 'Qloo gave no reading links for this ladder.')
        : h('ul', { class: 'chips chips--stack', 'aria-label': 'Reading links' }, loves.map((love) => loveChip(love, { strength: strengthOf(love) ?? 'none' }))),
      sentence ? h('p', { class: 'links-note' }, sentence) : null,
    );
  }

  function tasteWords() {
    if (record.tasteWords.length === 0) return null;
    return h(
      'section',
      { class: 'side-block', 'aria-labelledby': 'taste-h' },
      h('h2', { id: 'taste-h' }, 'Their taste, in Qloo’s words'),
      h('p', { class: 'fine' }, 'Tags Qloo attaches to the books near what they love.'),
      h('ul', { class: 'tag-chips' }, record.tasteWords.map((tag) => h('li', null, h('span', { class: 'chip' }, tag.name)))),
    );
  }

  function coversSwitch() {
    const any = (record.ladder?.rungs ?? []).some((rung) => rung.book.imageUrl);
    if (!any) {
      replaceChildren(coversHost);
      return;
    }
    replaceChildren(
      coversHost,
      h('section', { class: 'side-block', 'aria-labelledby': 'covers-h' },
        h('h2', { id: 'covers-h' }, 'Cover pictures'),
        h('p', { class: 'fine' }, 'Covers load from an address Qloo gives, so your browser contacts that site. They are off until you turn them on.'),
        toggleChip({
          label: 'Show cover pictures',
          pressed: session.coversOn,
          onToggle(next) {
            session.coversOn = next;
            checkStore(session.store.savePrefs({ covers: next }));
            announce(next ? 'Covers on.' : 'Covers off.');
            render({ focus: 'none' });
          },
        }),
      ),
    );
  }

  function setAsideList() {
    const swapped = setAside(record);
    if (swapped.length === 0) return null;
    return h('details', { class: 'aside-list' }, h('summary', null, `Set aside (${swapped.length})`), h('ul', { class: 'plain-list' }, swapped.map((entry) => h('li', null, h('strong', null, entry.title), ': ', verdictWords(entry).word))));
  }

  function actionBar() {
    const saved = isSaved();
    const row = h('div', { class: 'actions ladder-head__actions' });
    row.append(
      saved
        ? h('p', { class: 'saved-mark' }, h('strong', null, 'Saved on this device.'), ' ', h('a', { href: '#/saved' }, 'See what is saved'))
        : button({
            label: 'Save on this device',
            variant: 'secondary',
            icon: 'save',
            onClick: () => {
              const ok = persistReader(record);
              if (!ok) return;
              announce('Saved on this device.');
              render({ focus: 'save' });
            },
          }),
      linkButton({ label: 'Shelf', href: `#/reader/${record.id}/shelf`, ariaLabel: 'Shelf: what has been read' }),
      linkButton({ label: 'Print the slip', href: `#/reader/${record.id}/slip`, icon: 'print' }),
    );
    return [row, saved ? null : h('p', { class: 'fine ladder-head__unsaved' }, 'Not saved yet. Rung keeps nothing unless you save it, so closing this page loses the ladder and every tap on it.')];
  }

  /* ------------------------------------------------------------ render */

  function render({ focus = 'none' } = {}) {
    const open = openRungs(record);
    const list = ladderList();
    const status = record.ladder?.status ?? 'empty';
    const finished = !record.stopped && open.length === 0 && climbed(record).length > 0;
    const noBooks = !record.stopped && open.length === 0 && climbed(record).length === 0;

    title.textContent = record.nickname ? `${possessive(name())} ladder` : 'Your ladder';

    const serverNotes = record.notes.filter((one) => one.code !== 'stopped' && !(record.lastChange?.changes ?? []).includes(one.message));
    const lead = record.stopped
      ? 'The ladder stopped after three give-ups in a row. What was tried stays on the page.'
      : finished
        ? 'Every rung on this ladder has been done.'
        : noBooks
          ? 'Qloo had no books to put on a ladder for these loves and rules.'
          : 'Closest to what they love first. Each rung after it steps a little further out. Check every book yourself before you hand it over.';

    const railNote = status === 'short' && open.length > 0 ? note('Qloo came back with fewer books than a full ladder, so this one is short.') : null;

    const ladderCol = h(
      'section',
      { class: 'ladder-col', 'aria-labelledby': 'ladder-h' },
      homeBase(),
      h('h2', { id: 'ladder-h', class: 'ladder-col__title' }, 'The ladder'),
      noteList(serverNotes, { heading: 'Notes from Rung' }),
      railNote,
      record.stopped ? stopPanel() : null,
      finished ? donePanel() : null,
      noBooks ? emptyPanel() : null,
      list.items.length > 0
        ? h('div', { class: 'rail' },
            h('p', { class: 'rail__label rail__label--top', 'aria-hidden': 'true' }, 'closest'),
            h('ol', { class: 'ladder', role: 'list', 'aria-label': 'The ladder, closest rung first' }, list.items),
            h('p', { class: 'rail__label rail__label--bottom', 'aria-hidden': 'true' }, 'furthest'),
          )
        : null,
      setAsideList(),
      ui.error && !list.now ? errorPanel(ui.error, { onRetry: retryNow, onSample: () => session.useSample?.() }) : null,
      ui.busy && !list.now ? loading('Working on the next ladder') : null,
    );

    coversSwitch();
    trace.refresh();
    const side = h('aside', { class: 'side', 'aria-label': 'Reading links and tools' },
      readingLinks(),
      tasteWords(),
      h('section', { class: 'side-block', 'aria-labelledby': 'check-h' },
        h('h2', { id: 'check-h' }, 'Check a book we already have'),
        h('p', { class: 'fine' }, 'Type a title from the cupboard or the shelf. Rung shows how close it is to this reader.'),
        check.el,
      ),
      coversHost,
    );

    replaceChildren(
      root,
      h('header', { class: 'ladder-head' },
        h('p', { class: 'label' }, record.mode === 'sample' ? 'Sample ladder' : 'Ladder'),
        title,
        h('p', { class: 'lede' }, lead),
        ...actionBar(),
      ),
      sampleRecordNote(record),
      frozen() ? note('This reader was built with live data, but the live service is not available now. You can look at the ladder and the shelf. To change it, load the page again when the service is back.', { tone: 'warn', title: 'Read only for now' }) : null,
      h('div', { class: 'ladder-layout' }, changedPanel(), ladderCol, side, h('section', { class: 'trace-section', 'aria-label': 'The working' }, trace.el)),
      bar,
    );

    // The bar at the foot of a phone screen repeats the main action.
    replaceChildren(bar);
    if (list.now && !frozen()) {
      bar.hidden = false;
      bar.setAttribute('aria-label', `Actions for ${rungLabel(list.now)}`);
      bar.classList.toggle('dock--verdict', isReading(record, list.now) && ui.mode === 'idle' && !ui.busy);
      replaceChildren(bar, ...mainActions(list.now, 'dock'));
      if (bar.childElementCount === 0) bar.hidden = true;
    } else {
      bar.hidden = true;
    }

    // The lines in the margin need the cards in place to be measured, and are drawn again if the column changes height.
    lineObserver?.disconnect();
    const redraw = () => drawRailLines(ladderCol, ladderCol.querySelector('.home-base'), list.lines);
    requestAnimationFrame(redraw);
    if (typeof ResizeObserver === 'function') {
      lineObserver = new ResizeObserver(() => requestAnimationFrame(redraw));
      lineObserver.observe(ladderCol);
    }

    root.classList.toggle('is-fresh', ui.fresh);
    ui.fresh = false;
    document.title = `${title.textContent} | Rung`;
    renderedOnce = true;
    applyFocus(focus, list);
  }

  const visible = (nodes) => [...nodes].find((node) => node.offsetParent !== null || node.getClientRects().length > 0);

  function applyFocus(focus, list) {
    if (focus === 'none' || !renderedOnce) return;
    const pick = (selector) => visible(root.querySelectorAll(selector));
    let target = null;
    if (focus === 'changed') target = root.querySelector('#changed-h') ?? title;
    else if (focus === 'stop') target = root.querySelector('#stop-h') ?? title;
    else if (focus === 'heading') target = title;
    else if (focus === 'now') target = list.nowCard?.li.querySelector('.rung__title');
    else if (focus === 'panel') target = pick('.ask .ask__legend');
    else if (focus === 'primary') target = pick('.rung--now .rung__primary button, .dock--ladder button') ?? list.nowCard?.li.querySelector('.rung__title');
    else if (focus === 'error') target = root.querySelector('.alert-panel h2');
    else if (focus === 'save') target = root.querySelector('.saved-mark a');
    if (target) focusEl(target, { scroll: true });
  }

  render({ focus: 'none' });
  return {
    title: record.nickname ? `${possessive(name())} ladder` : 'Your ladder',
    el: root,
    heading: title,
    dispose() {
      disposed = true;
      controller?.abort();
      check.dispose();
      lineObserver?.disconnect();
      unmountDock();
    },
  };
}
