// An in-page confirmation step for destructive actions. No alert, confirm or
// prompt dialogs: the question appears next to the button that asked it.

import { h, uid } from '../dom.js';

/**
 * Returns { el, open, close }. `el` holds the trigger button and the hidden question.
 * options: { triggerLabel, triggerClass, question, detail, confirmLabel, cancelLabel, onConfirm }
 */
export function confirmAction(options) {
  const headingId = uid('confirm');
  const trigger = h(
    'button',
    { type: 'button', class: options.triggerClass || 'btn btn--danger-outline', 'aria-expanded': 'false', 'aria-label': options.triggerAriaLabel, onClick: () => open() },
    options.triggerLabel,
  );
  const cancel = h('button', { type: 'button', class: 'btn btn--quiet', onClick: () => close(true) }, options.cancelLabel || 'Keep it');
  const confirm = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--danger',
      onClick: () => {
        close(false);
        options.onConfirm();
      },
    },
    options.confirmLabel || 'Yes, delete',
  );
  const panel = h(
    'div',
    { class: 'confirm', role: 'group', 'aria-labelledby': headingId, hidden: true },
    h('p', { class: 'confirm-question', id: headingId }, options.question),
    options.detail ? h('p', { class: 'confirm-detail' }, options.detail) : null,
    h('div', { class: 'actions' }, confirm, cancel),
  );
  const el = h('div', { class: 'confirm-wrap' }, trigger, panel);

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.hidden = true;
    cancel.focus();
  }

  function close(returnFocus) {
    panel.hidden = true;
    trigger.hidden = false;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  }

  return { el, open, close };
}
