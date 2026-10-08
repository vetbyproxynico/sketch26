import * as api from '../api.js';
import { createTagInput } from '../components/tag-input.js';
import { journey } from '../components/journey.js';
import { announce, focusEl, h, isBusy, setBusy, uid } from '../dom.js';
import { COUNTRIES } from '../format.js';
import { navigate } from '../router.js';
import { createPerson, getPerson, savePerson } from '../store.js';

const MAX_FAVOURITES = 12;
const MAX_INTAKE_TEXT = 2000;

export function intakeView(editId) {
  const person = editId ? getPerson(editId) : null;
  if (editId && !person) return notFound();
  const initial = person
    ? person.input
    : { nickname: '', favourites: [], avoid: [], gentle: true };

  const ids = {
    nickname: uid('nickname'),
    year: uid('year'),
    country: uid('country'),
    place: uid('place'),
    gentle: uid('gentle'),
    describe: uid('describe'),
  };

  // ---- the free-text helper -------------------------------------------------
  const describeBox = h('textarea', {
    id: ids.describe,
    class: 'textarea',
    rows: '5',
    maxlength: String(MAX_INTAKE_TEXT),
    'aria-describedby': `${ids.describe}-hint ${ids.describe}-privacy ${ids.describe}-count`,
  });
  const describeCount = h('p', { class: 'tag-count', id: `${ids.describe}-count` }, `0 of ${MAX_INTAKE_TEXT} characters`);
  const describeStatus = h('div', { class: 'inline-status', role: 'status' });
  const describeButton = h('button', { type: 'button', class: 'btn btn--secondary', onClick: runDescribe }, 'Fill in the form from this');
  describeBox.addEventListener('input', () => {
    describeCount.textContent = `${describeBox.value.length} of ${MAX_INTAKE_TEXT} characters`;
  });

  // ---- the form -------------------------------------------------------------
  const nickname = h('input', {
    id: ids.nickname,
    class: 'input',
    type: 'text',
    maxlength: '40',
    autocomplete: 'off',
    required: true,
    'aria-describedby': `${ids.nickname}-hint ${ids.nickname}-error`,
    value: initial.nickname || '',
  });
  const year = h('input', {
    id: ids.year,
    class: 'input input--short',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    maxlength: '4',
    autocomplete: 'off',
    'aria-describedby': `${ids.year}-hint ${ids.year}-error`,
    value: initial.birthYear ? String(initial.birthYear) : '',
  });
  const country = h(
    'select',
    { id: ids.country, class: 'select' },
    h('option', { value: '' }, 'Choose a country'),
    COUNTRIES.map(([code, name]) => h('option', { value: code }, name)),
    h('option', { value: 'OTHER' }, 'Other'),
  );
  setCountry(initial.country);
  const place = h('input', {
    id: ids.place,
    class: 'input',
    type: 'text',
    maxlength: '80',
    autocomplete: 'off',
    value: initial.place || '',
  });
  const favourites = createTagInput({
    label: 'Favourites',
    hint: 'Singers, bands, films, television programmes, books, actors, shops or brands. Type one, then press Enter or a comma. Three or more works best, up to 12.',
    max: MAX_FAVOURITES,
    placeholder: 'For example: Vera Lynn',
    noun: 'favourite',
  });
  favourites.setValues(initial.favourites);
  const avoid = createTagInput({
    label: 'Things to avoid',
    hint: 'Anything that would upset them or that they do not enjoy, such as war or westerns. Short phrases work best. Encore leaves out any suggestion whose title, description or themes match what you type here. It also checks a few related words, so "war" covers wartime, soldiers and battles. It can only check what it can see, so it cannot know everything about a film. Please still look over each plan. Optional.',
    max: MAX_FAVOURITES,
    placeholder: 'For example: war films',
    noun: 'thing to avoid',
    nounPlural: 'things to avoid',
  });
  avoid.setValues(initial.avoid);
  const gentle = h('input', { id: ids.gentle, class: 'switch-input', type: 'checkbox', role: 'switch', 'aria-describedby': `${ids.gentle}-hint` });
  gentle.checked = initial.gentle !== false;
  const gentleState = h('span', { class: 'switch-state' }, gentle.checked ? 'On' : 'Off');
  gentle.addEventListener('change', () => {
    gentleState.textContent = gentle.checked ? 'On' : 'Off';
  });

  const errorSummary = h('div', { class: 'error-summary', role: 'alert', hidden: true, tabindex: '-1' });

  const form = h(
    'form',
    { class: 'form', novalidate: true, onSubmit },
    errorSummary,
    h(
      'div',
      { class: 'field' },
      h('label', { for: ids.nickname, class: 'label' }, 'Nickname'),
      h('p', { class: 'hint', id: `${ids.nickname}-hint` }, 'A first name or a nickname is enough. A real name is not needed.'),
      h('p', { class: 'field-error', id: `${ids.nickname}-error`, hidden: true }),
      nickname,
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { for: ids.year, class: 'label' }, 'Birth year'),
      h('p', { class: 'hint', id: `${ids.year}-hint` }, 'Four digits, such as 1938. A rough year is fine. It sets the years Encore looks in.'),
      h('p', { class: 'field-error', id: `${ids.year}-error`, hidden: true }),
      year,
    ),
    h('div', { class: 'field-pair' }, h('div', { class: 'field' }, h('label', { for: ids.country, class: 'label' }, 'Country they grew up in'), country), h('div', { class: 'field' }, h('label', { for: ids.place, class: 'label' }, 'Town or city'), place)),
    favourites.el,
    h('p', { class: 'field-error', id: 'favourites-error', hidden: true }),
    avoid.el,
    h(
      'div',
      { class: 'field field--switch' },
      h('label', { class: 'switch', for: ids.gentle }, gentle, h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })), h('span', { class: 'switch-text' }, 'Gentle mode'), gentleState),
      h('p', { class: 'hint', id: `${ids.gentle}-hint` }, 'When this is on, Encore leaves out suggestions with upsetting themes: war and combat, graphic violence, horror, murder and true crime, abuse, disaster, terminal illness and suicide. It looks at each suggestion\'s themes, and at its title and description for strong words only. It can miss something, and it can leave out an item that is harmless. When it is off, only the things to avoid are left out. Keep it on if you are not sure.'),
    ),
    h(
      'div',
      { class: 'actions actions--end' },
      h('button', { type: 'submit', class: 'btn btn--primary btn--large' }, 'Continue to favourites'),
      h('a', { class: 'btn btn--quiet btn--large', href: person ? `#/person/${encodeURIComponent(person.id)}/favourites` : '#/' }, 'Cancel'),
    ),
  );

  const el = h(
    'div',
    { class: 'page page--form' },
    person ? journey(person, 'details') : null,
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, person ? `Change the details for ${person.input.nickname}` : 'Who are we planning for?'),
      h('p', { class: 'lede' }, 'Fill in what you know. Only the nickname and one favourite are needed.'),
    ),
    h(
      'section',
      { class: 'panel panel--helper', 'aria-labelledby': 'describe-title' },
      h('h2', { id: 'describe-title' }, 'Describe them in your own words'),
      h('p', { class: 'hint', id: `${ids.describe}-hint` }, 'Write a few sentences about them, such as where they grew up and what they loved. Encore fills in the form below for you to check. Please leave out real names and addresses.'),
      h('p', { class: 'hint', id: `${ids.describe}-privacy` }, 'What you write here is sent to a language model, exactly as you typed it. Later, when Encore plans the sessions, the model is also sent the nickname and the things to avoid, as typed, words that describe their taste, and the name, kind, year, description and themes of each suggestion. A note you write after a session is sent as typed too. The model is not sent the favourites, the birth year, the country or the town. Encore cannot tell whether a real name has been typed, so please keep real names out of the nickname, the things to avoid and the notes.'),
      h('label', { for: ids.describe, class: 'visually-hidden' }, 'Describe them in your own words'),
      describeBox,
      describeCount,
      h('div', { class: 'actions' }, describeButton),
      describeStatus,
    ),
    h('section', { 'aria-labelledby': 'details-title' }, h('h2', { id: 'details-title' }, 'The details'), form),
  );

  function setCountry(code) {
    if (!code) country.value = '';
    else if (COUNTRIES.some(([c]) => c === code)) country.value = code;
    else country.value = 'OTHER';
  }

  async function runDescribe() {
    if (isBusy(describeButton)) return;
    const text = describeBox.value.trim();
    if (!text) {
      describeStatus.replaceChildren(h('p', { class: 'inline-message inline-message--warn' }, 'Write a sentence or two first, then press the button.'));
      describeBox.focus();
      return;
    }
    setBusy(describeButton, true);
    describeStatus.replaceChildren(h('p', { class: 'inline-message' }, h('span', { class: 'spinner spinner--small', 'aria-hidden': 'true' }), 'Reading what you wrote...'));
    try {
      const data = await api.call('intake', { text: text.slice(0, MAX_INTAKE_TEXT) });
      const input = data.input || {};
      if (input.nickname) nickname.value = String(input.nickname).slice(0, 40);
      if (input.birthYear) year.value = String(input.birthYear);
      if (input.country !== undefined) setCountry(input.country);
      if (input.place !== undefined) place.value = input.place || '';
      if (Array.isArray(input.favourites)) favourites.setValues(input.favourites.slice(0, MAX_FAVOURITES));
      if (Array.isArray(input.avoid)) avoid.setValues(input.avoid.slice(0, MAX_FAVOURITES));
      if (typeof input.gentle === 'boolean') {
        gentle.checked = input.gentle;
        gentleState.textContent = input.gentle ? 'On' : 'Off';
      }
      const note = api.isSample() ? ' (Sample mode read it with a simple rule, not the writing helper.)' : '';
      const message = `The form below is filled in. Please check it before you carry on.${note}`;
      describeStatus.replaceChildren(h('p', { class: 'inline-message inline-message--ok' }, message));
      announce(message);
      form.scrollIntoView({ behavior: 'auto', block: 'start' });
      nickname.focus();
    } catch (error) {
      if (api.isAborted(error)) return;
      describeStatus.replaceChildren(h('p', { class: 'inline-message inline-message--error', role: 'alert' }, `${api.plainError(error, 'read that description')} You can fill in the form by hand.`));
    } finally {
      setBusy(describeButton, false);
    }
  }

  function clearErrors() {
    errorSummary.hidden = true;
    errorSummary.replaceChildren();
    for (const node of form.querySelectorAll('.field-error')) {
      node.hidden = true;
      node.textContent = '';
    }
    for (const node of form.querySelectorAll('[aria-invalid]')) node.removeAttribute('aria-invalid');
  }

  function showError(errorId, control, message) {
    const node = document.getElementById(errorId) || form.querySelector(`#${errorId}`);
    if (node) {
      node.hidden = false;
      node.textContent = message;
    }
    if (control) control.setAttribute('aria-invalid', 'true');
  }

  function onSubmit(event) {
    event.preventDefault();
    clearErrors();
    const problems = [];
    const nick = nickname.value.replace(/\s+/g, ' ').trim();
    if (!nick) {
      problems.push({ message: 'Add a nickname. A first name is fine.', control: nickname, errorId: `${ids.nickname}-error` });
    }
    const yearText = year.value.trim();
    let birthYear;
    if (yearText) {
      const n = Number(yearText);
      const latest = new Date().getFullYear();
      if (!/^\d{4}$/.test(yearText) || n < 1900 || n > latest) {
        problems.push({ message: `Use a four-digit year between 1900 and ${latest}, or leave it empty.`, control: year, errorId: `${ids.year}-error` });
      } else {
        birthYear = n;
      }
    }
    const favs = favourites.getValues();
    if (favs.length === 0) {
      problems.push({ message: 'Add at least one favourite. Type a name and press Enter.', control: favourites.input, errorId: 'favourites-error' });
    }
    if (problems.length) {
      for (const p of problems) showError(p.errorId, p.control, p.message);
      errorSummary.hidden = false;
      errorSummary.replaceChildren(h('p', { class: 'error-summary-title' }, problems.length === 1 ? 'One thing needs fixing' : `${problems.length} things need fixing`), h('ul', null, problems.map((p) => h('li', null, h('a', { href: `#${p.control.id}`, onClick: (e) => { e.preventDefault(); p.control.focus(); } }, p.message)))));
      focusEl(errorSummary);
      return;
    }

    const input = {
      nickname: nick,
      ...(birthYear ? { birthYear } : {}),
      ...(country.value && country.value !== 'OTHER' ? { country: country.value } : {}),
      ...(place.value.trim() ? { place: place.value.trim() } : {}),
      favourites: favs,
      avoid: avoid.getValues(),
      gentle: gentle.checked,
    };

    let target = person;
    if (target) {
      const before = JSON.stringify(target.input);
      if (before !== JSON.stringify(input)) {
        const sameLookup = JSON.stringify(target.input.favourites) === JSON.stringify(input.favourites) && target.input.country === input.country;
        target.input = input;
        if (!sameLookup) target.resolved = null;
        target.profile = null;
        target.map = null;
        target.plan = null;
        target.changes = null;
        target.draft = {};
      }
    } else {
      target = createPerson(input);
    }
    savePerson(target);
    navigate(`/person/${encodeURIComponent(target.id)}/favourites`);
  }

  return { title: person ? `Change details for ${person.input.nickname}` : 'Who are we planning for?', el };
}

function notFound() {
  return {
    title: 'Person not found',
    el: h('div', { class: 'page' }, h('h1', null, 'That person is not saved here'), h('p', { class: 'lede' }, 'They may have been deleted, or saved in a different browser.'), h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to the start')),
  };
}
