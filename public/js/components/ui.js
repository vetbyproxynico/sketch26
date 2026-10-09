import { announce, announceAlert, focusEl, h, s, uid } from '../dom.js';
import { describeError } from '../api.js';
import { sampleMode } from '../words.js';

/* Small shared pieces: icons, buttons, form fields, notices, errors and loading. */

const ICON_PATHS = {
  check: 'M4 12.5l5 5 11-11',
  cross: 'M5 5l14 14M19 5L5 19',
  heart: 'M12 20.5C5 15 3.5 11.5 3.5 8.8 3.5 6.3 5.4 4.5 7.8 4.5c1.8 0 3.3 1 4.2 2.6.9-1.6 2.4-2.6 4.2-2.6 2.4 0 4.3 1.8 4.3 4.3 0 2.7-1.5 6.2-8.5 11.7z',
  swap: 'M4 8h14l-3.5-3.5M20 16H6l3.5 3.5',
  plus: 'M12 4v16M4 12h16',
  print: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
};

/** A small decorative icon. It is hidden from assistive technology: a word always sits beside it. */
export function icon(name) {
  return s(
    'svg',
    { class: 'icon', viewBox: '0 0 24 24', width: '20', height: '20', 'aria-hidden': 'true', focusable: 'false', fill: name === 'heart' ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': '2.5', 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' },
    s('path', { d: ICON_PATHS[name] ?? ICON_PATHS.check }),
  );
}

/**
 * A button. `variant`: primary, secondary, quiet, danger. `busy` shows the
 * pending state while the work runs; a pending button ignores clicks.
 */
export function button({ label, variant = 'secondary', onClick, icon: iconName, ariaLabel, type = 'button', pressed, expanded, controls, disabled, className = '', describedBy }) {
  const el = h(
    'button',
    {
      type,
      class: `btn btn--${variant} ${className}`.trim(),
      'aria-label': ariaLabel,
      'aria-pressed': pressed === undefined ? undefined : String(pressed),
      'aria-expanded': expanded === undefined ? undefined : String(expanded),
      'aria-controls': controls,
      'aria-describedby': describedBy,
      disabled,
    },
    iconName ? icon(iconName) : null,
    h('span', { class: 'btn__text' }, label),
  );
  if (onClick) {
    el.addEventListener('click', (event) => {
      if (el.getAttribute('aria-disabled') === 'true') {
        event.preventDefault();
        return;
      }
      onClick(event, el);
    });
  }
  return el;
}

/** Marks a button as working, so a second click does nothing. */
export function setBusy(el, busy) {
  if (!el) return;
  if (busy) {
    el.setAttribute('aria-disabled', 'true');
    el.dataset.busy = 'true';
  } else {
    el.removeAttribute('aria-disabled');
    delete el.dataset.busy;
  }
}

/** An anchor that looks like a button. */
export function linkButton({ label, href, variant = 'secondary', icon: iconName, ariaLabel, external = false }) {
  return h(
    'a',
    { href, class: `btn btn--${variant}`, 'aria-label': ariaLabel, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) },
    iconName ? icon(iconName) : null,
    h('span', { class: 'btn__text' }, label),
  );
}

/**
 * A labelled field. Returns the wrapper and the control. `error(message)`
 * shows text next to the field and links it to the control.
 */
export function field({ label, hint, control, id = uid('field') }) {
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const errorEl = h('p', { class: 'field__error', id: errorId, hidden: true });
  const wrapper = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', for: id }, label),
    hint ? h('p', { class: 'field__hint', id: hintId }, hint) : null,
    control,
    errorEl,
  );
  const base = hintId ?? '';
  if (base) control.setAttribute('aria-describedby', base);
  return {
    el: wrapper,
    control,
    error(message) {
      if (message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', `${base} ${errorId}`.trim());
      } else {
        errorEl.textContent = '';
        errorEl.hidden = true;
        control.removeAttribute('aria-invalid');
        if (base) control.setAttribute('aria-describedby', base);
        else control.removeAttribute('aria-describedby');
      }
    },
  };
}

/** A plain note: information, not an error. */
export function note(text, { tone = 'info', title } = {}) {
  return h('div', { class: `note note--${tone}` }, title ? h('p', { class: 'note__title' }, title) : null, h('p', null, text));
}

/** A list of notes from the server, each in plain words. `level` is the heading level under the one above. */
export function noteList(notes, { heading, level = 3 } = {}) {
  if (!notes || notes.length === 0) return null;
  return h(
    'section',
    { class: 'note-list', 'aria-label': heading ?? 'Things to know' },
    heading ? h(`h${level}`, { class: 'label-heading' }, heading) : null,
    h('ul', { class: 'plain-list' }, notes.map((item) => h('li', null, item.message))),
  );
}

/**
 * A busy message with the real step in words. `role="status"` makes it
 * polite for a screen reader.
 */
export function loading(message) {
  announce(message);
  const slow = h('p', { class: 'loading__slow', hidden: true }, sampleMode() ? 'Still working. This can take a few seconds.' : 'Still working. Rung asks Qloo many questions for one ladder or board, one after another, so this can take a few seconds.');
  const el = h('div', { class: 'loading', role: 'status' }, h('span', { class: 'loading__bar', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')), h('div', { class: 'loading__text' }, h('p', null, message), slow));
  // Said only if the wait goes on, and only while this message is still on the page.
  setTimeout(() => {
    if (el.isConnected) slow.hidden = false;
  }, 6000);
  return el;
}

/**
 * An error panel: what happened, in plain words, and a way forward. A 429
 * counts down and enables "Try again" when the wait is over.
 *
 * @param {unknown} error
 * @param {{ onRetry?: () => void, onSample?: () => void, backHref?: string, backLabel?: string }} actions
 */
export function errorPanel(error, { onRetry, onSample, backHref, backLabel = 'Go back' } = {}) {
  const info = describeError(error);
  // The control that was in use when this went wrong, so closing the message can put focus back on it.
  const trigger = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const panel = h('div', { class: 'alert-panel', role: 'alert' });
  const message = info.message ? h('p', null, info.message) : null;
  panel.append(h('h2', { class: 'alert-panel__title' }, info.title), message);
  const actionsRow = h('div', { class: 'actions' });
  let retry = null;
  if (info.retryable && onRetry) {
    retry = button({ label: info.wait > 0 ? `Try again in ${info.wait} seconds` : 'Try again', variant: 'primary', onClick: () => onRetry() });
    if (info.wait > 0) {
      retry.setAttribute('aria-disabled', 'true');
      let left = info.wait;
      const timer = setInterval(() => {
        left -= 1;
        if (!retry.isConnected || left <= 0) {
          clearInterval(timer);
          if (retry.isConnected) {
            retry.removeAttribute('aria-disabled');
            retry.querySelector('.btn__text').textContent = 'Try again';
            announce('You can try again now.');
          }
          return;
        }
        retry.querySelector('.btn__text').textContent = `Try again in ${left} seconds`;
      }, 1000);
    }
    actionsRow.append(retry);
  }
  if (info.offerSample && onSample) actionsRow.append(button({ label: 'Use sample data instead', variant: 'primary', onClick: onSample }));
  if (backHref) actionsRow.append(linkButton({ label: backLabel, href: backHref }));
  // An error that a retry cannot mend (a refused request, a missing route) still needs a way on: close it and change what was entered.
  if (!info.retryable && !info.offerSample && !backHref && !info.silent) {
    actionsRow.append(
      button({
        label: 'Close this message',
        variant: 'secondary',
        onClick: () => {
          panel.remove();
          announce('Message closed.');
          focusEl(trigger?.isConnected ? trigger : document.querySelector('main h1'));
        },
      }),
    );
  }
  if (actionsRow.childElementCount > 0) panel.append(actionsRow);
  announceAlert(`${info.title}. ${info.message}`);
  return panel;
}

/** A chip with text only. */
export function chip(text, className = '') {
  return h('span', { class: `chip ${className}`.trim() }, text);
}

/** The yellow block on the rail that carries a rung number. Ink on yellow with an ink border. The heading of the rung says the same thing in words, so the block is hidden from assistive technology. */
export function rungBlock(number) {
  return h('span', { class: 'rung-block', 'aria-hidden': 'true' }, h('span', { class: 'rung-block__number' }, String(number)));
}

/** A toggle button for a chip that can be switched on (pressed) or off. */
export function toggleChip({ label, pressed, onToggle, ariaLabel, className = '', children }) {
  const el = h(
    'button',
    { type: 'button', class: `toggle ${className}`.trim(), 'aria-pressed': String(Boolean(pressed)), 'aria-label': ariaLabel },
    h('span', { class: 'toggle__box', 'aria-hidden': 'true' }, icon('check')),
    children ?? h('span', { class: 'toggle__text' }, label),
  );
  el.addEventListener('click', () => {
    const next = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', String(next));
    onToggle(next, el);
  });
  return el;
}

/** A group of radio buttons that look like a row of blocks. Returns the element and a getter. */
export function segmented({ name, legend, options, value, onChange, hint }) {
  const fieldset = h('fieldset', { class: 'segmented' }, h('legend', { class: 'field__label' }, legend), hint ? h('p', { class: 'field__hint' }, hint) : null);
  const row = h('div', { class: 'segmented__row' });
  const groupName = `${name}-${uid('seg')}`;
  for (const option of options) {
    const id = uid('opt');
    const input = h('input', { type: 'radio', name: groupName, id, value: option.id, checked: option.id === value, class: 'segmented__input' });
    input.addEventListener('change', () => onChange(option.id));
    row.append(h('div', { class: 'segmented__option' }, input, h('label', { for: id, class: 'segmented__label' }, option.label)));
  }
  fieldset.append(row);
  return fieldset;
}
