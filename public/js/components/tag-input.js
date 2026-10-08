// A tag-style input: type a name, press Enter or comma, and it becomes a chip
// that can be removed. Works with keyboard, touch and paste.

import { announce, h, uid } from '../dom.js';

/**
 * options: { label, hint, max, maxLength, placeholder, noun, nounPlural }
 * Returns { el, getValues, setValues, flush, input }.
 */
export function createTagInput(options) {
  const max = options.max || 12;
  const maxLength = options.maxLength || 200;
  const noun = options.noun || 'item';
  const nounPlural = options.nounPlural || `${noun}s`;
  const inputId = uid('tags');
  const hintId = `${inputId}-hint`;
  const countId = `${inputId}-count`;
  let values = [];

  const chips = h('ul', { class: 'chips', 'aria-label': `Added ${nounPlural}` });
  const input = h('input', {
    id: inputId,
    class: 'tag-text',
    type: 'text',
    maxlength: String(maxLength),
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'false',
    enterkeyhint: 'done',
    placeholder: options.placeholder || '',
    'aria-describedby': `${hintId} ${countId}`,
  });
  const count = h('p', { class: 'tag-count', id: countId, role: 'status' });
  const addButton = h('button', { type: 'button', class: 'btn btn--secondary btn--small', onClick: () => commit(true) }, 'Add');
  const box = h('div', { class: 'tag-box' }, chips, input);

  const el = h(
    'div',
    { class: 'field tags-field' },
    h('label', { for: inputId, class: 'label' }, options.label),
    options.hint ? h('p', { class: 'hint', id: hintId }, options.hint) : h('span', { id: hintId, hidden: true }),
    box,
    h('div', { class: 'tag-actions' }, addButton, count),
  );

  box.addEventListener('click', (event) => {
    if (event.target === box || event.target === chips) input.focus();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(true);
    }
  });

  input.addEventListener('input', () => {
    if (input.value.includes(',')) {
      const parts = input.value.split(',');
      const tail = parts.pop();
      parts.forEach((part) => add(part));
      input.value = tail;
    }
  });

  input.addEventListener('blur', () => commit(false));

  input.addEventListener('paste', (event) => {
    const text = event.clipboardData && event.clipboardData.getData('text');
    if (text && /[,\n]/.test(text)) {
      event.preventDefault();
      text.split(/[,\n]/).forEach((part) => add(part));
    }
  });

  function add(raw) {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (values.some((v) => v.toLowerCase() === text.toLowerCase())) {
      announce(`${text} is already in the list.`);
      return false;
    }
    if (values.length >= max) {
      announce(`The most you can add is ${max}. Remove one to add another.`);
      return false;
    }
    values.push(text.slice(0, maxLength));
    render();
    return true;
  }

  function commit(refocus) {
    const text = input.value;
    if (!text.trim()) {
      if (refocus) input.focus();
      return;
    }
    if (add(text)) input.value = '';
    else if (values.length >= max) updateCount();
    if (refocus) input.focus();
  }

  function remove(index) {
    const [gone] = values.splice(index, 1);
    render();
    announce(`Removed ${gone}.`);
    input.focus();
  }

  function updateCount() {
    const full = values.length >= max;
    count.textContent = full
      ? `${values.length} of ${max} added. That is the most. Remove one to add another.`
      : `${values.length} of ${max} added`;
    count.classList.toggle('is-full', full);
    addButton.disabled = full;
  }

  function render() {
    chips.replaceChildren(
      ...values.map((value, index) =>
        h(
          'li',
          { class: 'chip' },
          h('span', { class: 'chip-text' }, value),
          h(
            'button',
            { type: 'button', class: 'chip-remove', 'aria-label': `Remove ${value}`, onClick: () => remove(index) },
            h('span', { class: 'chip-x', 'aria-hidden': 'true' }),
          ),
        ),
      ),
    );
    chips.hidden = values.length === 0;
    updateCount();
  }

  render();

  return {
    el,
    input,
    getValues() {
      commit(false);
      return values.slice();
    },
    setValues(next) {
      values = [];
      (next || []).forEach((v) => add(v));
      render();
    },
    hasPending() {
      return input.value.trim().length > 0;
    },
  };
}
