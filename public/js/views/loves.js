import { announce, focusEl, h, normaliseName, replaceChildren } from '../dom.js';
import { createGate, LIMITS } from '../api.js';
import { kindOptions, nameChip } from '../components/chips.js';
import { dock, mountDock } from '../components/dock.js';
import { themeSearch } from '../components/theme-search.js';
import { button, errorPanel, field, linkButton, loading, note, segmented, setBusy, toggleChip } from '../components/ui.js';
import { allClean, buildReader, lovesOfDraft, resolveNames } from '../flows.js';
import { KIND_INFO, kindMark } from '../kinds.js';
import { QUICK_PICKS } from '../quick-picks.js';
import { draftFromRecord, emptyDraft } from '../records.js';
import { session } from '../session.js';
import { AGE_BANDS, CAUTION_WORDS, defaultCautions, PUBLISHED, sampleMode, sentenceStatement, Source } from '../words.js';

/*
 * R1: "What are they into?" The form for one reader: nickname (never sent
 * anywhere), age band, quick picks, a typed name, an optional sentence, what to
 * rule out and the years to look in. The primary button looks the names up and,
 * when every one matches cleanly, goes straight to the ladder.
 */

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function buildForm({ existing }) {
  const draft = session.draft;
  const gate = createGate();
  let controller = null;
  const themes = [];

  const title = h('h1', { class: 'page-title', tabindex: '-1' }, existing ? 'Change what they love' : 'What are they into?');
  const root = h('div', { class: 'page form-page' });
  const errorHost = h('div', { class: 'error-host' });
  const statusHost = h('div', { class: 'status-host' });

  /* ---- the list of loves, and everything that depends on it */
  const chosenHost = h('div', { class: 'chosen' });
  const counterText = h('span', null);
  const dockText = h('p', { class: 'dock__text', 'aria-live': 'polite' });
  const quickButtons = new Map();

  const total = () => draft.loves.length;
  const isChosen = (name, kind) => draft.loves.some((one) => normaliseName(one.name) === normaliseName(name) && (one.kind === kind || one.kind === '' || kind === ''));

  function refresh() {
    renderChosen();
    for (const [key, el] of quickButtons) {
      const pick = QUICK_PICKS.find((one) => `${one.name}|${one.kind}` === key);
      el.setAttribute('aria-pressed', String(isChosen(pick.name, pick.kind)));
    }
    counterText.textContent = `${total()} of ${LIMITS.loves} chosen`;
    dockText.textContent = total() === 0 ? 'Choose at least one thing they love.' : `${total()} of ${LIMITS.loves} chosen`;
  }

  function addLove({ name, kind }) {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean === '') return { ok: false, message: 'Type a name first.' };
    if (clean.length > LIMITS.name) return { ok: false, message: `A name can be at most ${LIMITS.name} characters.` };
    if (total() >= LIMITS.loves) return { ok: false, message: `Rung takes at most ${LIMITS.loves} loves. Remove one to add another.` };
    if (isChosen(clean, kind)) return { ok: false, message: `${clean} is already on the list.` };
    draft.loves.push({ name: clean, kind: kind || '' });
    refresh();
    announce(`Added ${clean}. ${total()} of ${LIMITS.loves} chosen.`);
    return { ok: true };
  }

  function removeAt(index) {
    const [gone] = draft.loves.splice(index, 1);
    refresh();
    announce(`Removed ${gone.name}. ${total()} of ${LIMITS.loves} chosen.`);
  }

  function renderChosen() {
    replaceChildren(
      chosenHost,
      h('p', { class: 'label' }, counterText),
      total() === 0
        ? h('p', { class: 'fine' }, 'Nothing chosen yet. Tap a quick pick, or type a name.')
        : h(
            'ul',
            { class: 'chosen-list', 'aria-label': 'What they love' },
            draft.loves.map((entry, index) => {
              const li = nameChip(entry.love ? { ...entry.love } : entry, { onRemove: () => removeAt(index), removeLabel: `Remove ${entry.name}` });
              if (entry.kind === '') {
                const select = h('select', { class: 'chosen-kind', 'aria-label': `Kind of ${entry.name}` }, kindOptions('', { any: 'Not sure of the kind' }));
                select.addEventListener('change', () => {
                  entry.kind = select.value;
                  refresh();
                  focusEl(chosenHost.querySelectorAll('.chosen-kind')[0] ?? chosenHost, { scroll: false });
                });
                li.append(select);
              }
              return li;
            }),
          ),
    );
  }

  /* ---- about the reader */
  const nicknameInput = h('input', { type: 'text', maxlength: String(LIMITS.nickname), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: draft.nickname });
  nicknameInput.addEventListener('input', () => {
    draft.nickname = nicknameInput.value;
  });
  const nickname = field({
    label: 'A nickname or initials. Not a full name.',
    hint: 'Up to 20 characters. It stays on this device and is never sent anywhere. Leave it empty if you prefer.',
    control: nicknameInput,
  });

  const cautionHost = h('div', { class: 'cautions' });
  const onlyTagged = h('div', { class: 'only-tagged' });

  function renderCautions() {
    replaceChildren(
      cautionHost,
      h('ul', { class: 'toggle-grid', 'aria-label': 'Themes to rule out' },
        [...CAUTION_WORDS, ...draft.extraWords.filter((word) => !CAUTION_WORDS.includes(word))].map((word) =>
          h('li', null, toggleChip({
            label: cap(word),
            pressed: draft.cautions.includes(word) || draft.extraWords.includes(word),
            onToggle(next) {
              draft.cautionsTouched = true;
              const set = (list) => (next ? [...new Set([...list, word])] : list.filter((one) => one !== word));
              if (CAUTION_WORDS.includes(word)) draft.cautions = set(draft.cautions);
              else draft.extraWords = set(draft.extraWords);
              announce(`${cap(word)} ${next ? 'ruled out' : 'allowed'}.`);
            },
          })),
        ),
      ),
    );
    replaceChildren(
      onlyTagged,
      draft.ageBand === '8_to_10'
        ? h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: draft.onlyAgeTagged, onchange: (event) => { draft.onlyAgeTagged = event.target.checked; } }),
            h('span', null, `Only books that carry an age-band tag. ${Source()} may not have these tags, and then this does nothing.`))
        : null,
    );
  }

  const band = segmented({
    name: 'age',
    legend: 'Age band (optional)',
    hint: 'Used to start with sensible cautions. Rung does not rate books by age.',
    options: [...AGE_BANDS, { id: '', label: 'No band' }],
    value: draft.ageBand,
    onChange(value) {
      draft.ageBand = value;
      if (!draft.cautionsTouched) {
        draft.cautions = defaultCautions(value || undefined);
        announce(draft.cautions.length === 0 ? 'Cautions are offered but switched off for 14 to 16.' : 'The usual cautions are switched on.');
      }
      renderCautions();
    },
  });

  /* ---- quick picks */
  const pickGroups = Object.keys(KIND_INFO)
    .filter((kind) => QUICK_PICKS.some((pick) => pick.kind === kind))
    .map((kind) =>
      h('div', { class: 'pick-group', role: 'group', 'aria-label': KIND_INFO[kind].choice },
        h('p', { class: 'label' }, kindMark(kind)),
        h('ul', { class: 'toggle-grid' },
          QUICK_PICKS.filter((pick) => pick.kind === kind).map((pick) => {
            const el = toggleChip({
              label: pick.name,
              className: 'pick',
              pressed: isChosen(pick.name, pick.kind),
              onToggle(next) {
                if (next) {
                  const result = addLove(pick);
                  if (!result.ok) {
                    el.setAttribute('aria-pressed', 'false');
                    announce(result.message);
                    showFormError(result.message);
                  } else clearFormError();
                } else {
                  const index = draft.loves.findIndex((one) => normaliseName(one.name) === normaliseName(pick.name));
                  if (index >= 0) removeAt(index);
                }
              },
            });
            quickButtons.set(`${pick.name}|${pick.kind}`, el);
            return h('li', null, el);
          }),
        ),
      ),
    );

  /* ---- add by name */
  const nameInput = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(LIMITS.name) });
  const nameField = field({ label: 'Name', control: nameInput });
  const kindSelect = h('select', null, kindOptions('', { any: 'Not sure' }));
  const kindField = field({ label: 'What kind is it?', control: kindSelect });
  const addByName = () => {
    const result = addLove({ name: nameInput.value, kind: kindSelect.value });
    nameField.error(result.ok ? null : result.message);
    if (result.ok) {
      nameInput.value = '';
      clearFormError();
    }
    nameInput.focus();
  };
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addByName();
    }
  });

  /* ---- the sentence */
  const sentenceInput = h('textarea', { rows: '3', maxlength: String(LIMITS.sentence), autocomplete: 'off', spellcheck: 'true' });
  sentenceInput.value = draft.sentence;
  const sentenceCount = h('p', { class: 'counter' });
  const updateCount = () => {
    draft.sentence = sentenceInput.value;
    sentenceCount.textContent = `${sentenceInput.value.length} of ${LIMITS.sentence} characters`;
  };
  sentenceInput.addEventListener('input', updateCount);
  updateCount();
  const sentenceField = field({ label: 'One line about what they like', hint: 'For example: she plays Minecraft for hours and has watched Wednesday twice.', control: sentenceInput });
  const sentenceResult = h('div', { class: 'sentence-result', 'aria-live': 'polite' });
  const readButton = button({
    label: 'Read my sentence',
    variant: 'secondary',
    async onClick() {
      const text = sentenceInput.value.trim();
      if (text === '') {
        sentenceField.error('Type a sentence first.');
        sentenceInput.focus();
        return;
      }
      const nick = draft.nickname.trim();
      if (nick.length >= 2 && normaliseName(text).includes(normaliseName(nick))) {
        sentenceField.error('This sentence contains the nickname. Take it out first: nicknames stay on this device.');
        sentenceInput.focus();
        return;
      }
      sentenceField.error(null);
      if (readButton.getAttribute('aria-disabled') === 'true') return;
      setBusy(readButton, true);
      replaceChildren(sentenceResult, loading('Reading your sentence'));
      try {
        const answer = await session.api.parse(text, { signal: controller?.signal });
        let added = 0;
        const skipped = [];
        for (const love of answer.loves) {
          const result = addLove(love);
          if (result.ok) added += 1;
          else skipped.push(love.name);
        }
        for (const word of answer.ruleOutWords) {
          if (CAUTION_WORDS.includes(word)) draft.cautions = [...new Set([...draft.cautions, word])];
          else if (draft.extraWords.length < 4) draft.extraWords = [...new Set([...draft.extraWords, word])];
          draft.cautionsTouched = true;
        }
        renderCautions();
        replaceChildren(
          sentenceResult,
          h('p', { class: 'fine' }, `${added === 0 ? 'No new names were added.' : `Added ${added} ${added === 1 ? 'name' : 'names'}.`}${answer.ruleOutWords.length > 0 ? ` Ruled out: ${answer.ruleOutWords.join(', ')}.` : ''}${skipped.length > 0 ? ` Left out: ${skipped.join(', ')}.` : ''} Check the kind of each name in the list above before you go on.`),
        );
      } catch (error) {
        replaceChildren(sentenceResult, errorPanel(error, { onRetry: () => readButton.click(), onSample: () => session.useSample?.() }));
      } finally {
        setBusy(readButton, false);
      }
    },
  });
  const sentence = h('details', { class: 'sentence' },
    h('summary', null, 'Or paste a sentence'),
    h('div', { class: 'sentence__body' },
      h('p', { class: 'note-plain' }, sentenceStatement(session.health?.llmProvider, session.mode)),
      sentenceField.el,
      sentenceCount,
      readButton,
      sentenceResult,
    ),
  );

  /* ---- rule out */
  const search = themeSearch({
    owner: existing ? existing.id : 'draft',
    getTags: () => draft.excludedTags,
    setTags: (tags) => {
      draft.excludedTags = tags;
    },
  });
  themes.push(search);

  /* ---- error handling for the form as a whole */
  function showFormError(message) {
    replaceChildren(errorHost, h('div', { class: 'alert-panel', role: 'alert' }, h('h2', { class: 'alert-panel__title' }, 'Check this'), h('p', null, message)));
  }
  function clearFormError() {
    replaceChildren(errorHost);
  }

  /* ---- submit */
  const submit = button({
    label: existing ? 'Rebuild the ladder' : 'Find the first rung',
    variant: 'primary',
    icon: 'arrow',
    onClick: () => run(),
  });

  async function run() {
    if (total() === 0) {
      showFormError('Choose at least one thing they love, by tapping a quick pick or typing a name.');
      announce('Choose at least one thing they love.');
      return;
    }
    clearFormError();
    await gate.run(async () => {
      controller = new AbortController();
      setBusy(submit, true);
      root.setAttribute('aria-busy', 'true');
      const step = (text) => replaceChildren(statusHost, loading(text));
      try {
        const open = draft.loves.filter((entry) => !entry.love);
        const results = open.length === 0 ? new Map() : await resolveNames(open, { signal: controller.signal, progress: step, owner: existing ? existing.id : 'draft' });
        if (allClean(results)) {
          const loves = lovesOfDraft(draft.loves, results);
          const record = await buildReader(draft, loves, { signal: controller.signal, progress: step });
          replaceChildren(statusHost);
          session.draft = null;
          session.go(`/reader/${record.id}`, { replace: true });
          return;
        }
        replaceChildren(statusHost);
        session.pending = { scope: 'reader', results };
        session.go('/reader/confirm');
      } catch (error) {
        replaceChildren(statusHost);
        const panel = errorPanel(error, { onRetry: () => run(), onSample: () => session.useSample?.() });
        replaceChildren(errorHost, panel);
        if (panel) focusEl(panel.querySelector('h2'), { scroll: true });
      } finally {
        setBusy(submit, false);
        root.removeAttribute('aria-busy');
      }
    });
  }

  /* ---- assemble */
  const bar = dock('dock--form', dockText, submit);
  const unmountDock = mountDock(bar);

  renderCautions();
  refresh();

  replaceChildren(
    root,
    title,
    h('p', { class: 'lede' }, existing ? 'Change the loves or the rules. What has been read and ruled out is kept.' : 'Games, programmes, films, musicians and people they follow. Choose one to eight. Tap a quick pick, or type a name.'),
    h('section', { class: 'form-block', 'aria-labelledby': 'about-heading' },
      h('h2', { id: 'about-heading' }, 'About the reader'),
      nickname.el,
      band,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'picks-heading' },
      h('h2', { id: 'picks-heading' }, 'Quick picks'),
      h('p', { class: 'fine' }, 'Well-known games, programmes, films and music. They are only names to start from.'),
      ...pickGroups,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'add-heading' },
      h('h2', { id: 'add-heading' }, 'Add by name'),
      h('div', { class: 'inline-form inline-form--add', role: 'group', 'aria-labelledby': 'add-heading' },
        nameField.el,
        kindField.el,
        button({ label: 'Add', variant: 'secondary', icon: 'plus', onClick: addByName, ariaLabel: 'Add this name to the list' }),
      ),
      h('p', { class: 'fine' }, 'Choosing the kind helps Rung find the right one. A book they did finish counts too.'),
      sentence,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'chosen-heading' },
      h('h2', { id: 'chosen-heading' }, 'What they love'),
      chosenHost,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'rule-heading' },
      h('h2', { id: 'rule-heading' }, 'Rule out'),
      h('p', { class: 'fine' }, sampleMode() ? 'Rung leaves books with these themes out. A book that is not tagged with a theme can still contain it, so check each pick.' : 'Rung asks Qloo to leave books with these themes out, and checks the tags again on its own server. A book that is not tagged with a theme can still contain it, so check each pick.'),
      cautionHost,
      onlyTagged,
      search.el,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'years-heading' },
      h('h2', { id: 'years-heading' }, 'Published'),
      segmented({ name: 'published', legend: 'Which years to look in', options: PUBLISHED, value: draft.published, onChange: (value) => { draft.published = value; } }),
    ),
    errorHost,
    statusHost,
    bar,
  );

  return {
    title: existing ? 'Change what they love' : 'What are they into?',
    el: root,
    heading: title,
    dispose() {
      controller?.abort();
      unmountDock();
      for (const one of themes) one.dispose();
    },
  };
}

export async function newReaderView() {
  if (session.keepDraft && session.draft) {
    session.keepDraft = false;
  } else {
    session.draft = emptyDraft();
  }
  return buildForm({});
}

export async function editReaderView({ id }) {
  const existing = session.readers.get(id) ?? (session.store.getReader(id) ? (session.readers.set(id, structuredClone(session.store.getReader(id))), session.readers.get(id)) : undefined);
  if (!existing) {
    const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That reader is not here');
    return { title: 'Not found', el: h('div', { class: 'page prose' }, title, note('This reader was not saved on this device, so it cannot be changed after a reload.'), linkButton({ label: 'Start a new reader', href: '#/reader/new', variant: 'primary' })), heading: title };
  }
  if (session.keepDraft && session.draft?.editing === id) session.keepDraft = false;
  else session.draft = draftFromRecord(existing);
  return buildForm({ existing });
}
