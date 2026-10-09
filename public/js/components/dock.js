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

/**
 * A bar fixed to the foot of the screen is a help on a phone and a wall when the
 * text is large or the screen is short: at 200% text it can fill half of a small
 * phone. Then it is not fixed: the button sits in the card, or at the end of
 * the form, where the content is.
 */
export function dockIsStatic() {
  const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return fontSize >= 24 || window.innerHeight < 450;
}

/** @returns {() => void} the clean-up for the screen's `dispose`. */
export function mountDock(el) {
  document.body.classList.add('has-dock');
  const set = () => {
    const fixed = !dockIsStatic();
    document.body.classList.toggle('dock-static', !fixed);
    document.documentElement.style.setProperty('--dock-h', fixed ? `${el.offsetHeight}px` : '0px');
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
  observer?.observe(el);
  window.addEventListener('resize', set);
  set();
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', set);
    document.body.classList.remove('has-dock', 'dock-static');
    document.documentElement.style.removeProperty('--dock-h');
  };
}
