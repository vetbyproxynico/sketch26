import { h } from '../dom.js';

/*
 * The bar fixed to the foot of a phone screen, with the one main action in
 * reach of a thumb. The page gets bottom padding equal to the bar's height, so
 * the bar never covers the control that has focus. `mountDock` measures the
 * bar and returns a function that undoes it when the screen is left.
 */

export function dock(className, ...children) {
  return h('div', { class: `dock ${className}`.trim() }, ...children);
}

/** @returns {() => void} the clean-up for the screen's `dispose`. */
export function mountDock(el) {
  document.body.classList.add('has-dock');
  const set = () => document.documentElement.style.setProperty('--dock-h', `${el.offsetHeight}px`);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
  observer?.observe(el);
  set();
  return () => {
    observer?.disconnect();
    document.body.classList.remove('has-dock');
    document.documentElement.style.removeProperty('--dock-h');
  };
}
