// A very small stand-in for the browser's document, just enough for the page's
// own `h()` helper to build elements, so a component can be rendered in a test
// and its words read back. There is no layout and no styling here. Nothing in it
// is real browser behaviour beyond building a tree of elements and text.

export class FakeNode {}

class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.text = String(text);
  }

  get textContent() {
    return this.text;
  }
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.style = { setProperty: () => {} };
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attrs, name);
  }

  addEventListener() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  get classes() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join('');
  }
}

/** Puts the stand-in where the page expects the real document. Call `restore()` afterwards. */
export function installFakeDom() {
  const before = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
  };
  globalThis.Node = FakeNode;
  return {
    restore() {
      if (before.document === undefined) delete globalThis.document;
      else globalThis.document = before.document;
      if (before.Node === undefined) delete globalThis.Node;
      else globalThis.Node = before.Node;
    },
  };
}

/** Every element under `root` (itself included) that the test accepts, in document order. */
export function findAll(root, accept) {
  const found = [];
  const walk = (node) => {
    if (!(node instanceof FakeElement)) return;
    if (accept(node)) found.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

export const byClass = (root, name) => findAll(root, (el) => el.classes.includes(name));
export const firstByClass = (root, name) => byClass(root, name)[0];
export const byTag = (root, tag) => findAll(root, (el) => el.tag === tag);
