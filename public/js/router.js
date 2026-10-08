/*
 * A hash router: one page, routes after the "#". A route is a pattern and a
 * loader. The router keeps a token for the render in progress, so a view that
 * finishes loading after the adult has already moved on is thrown away and
 * cannot touch the page.
 */

export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const [clean] = path.split('?');
  const trimmed = clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
  return trimmed === '' ? '/' : trimmed;
}

/** `compile('/reader/:id/shelf')` -> a matcher returning `{ id }` or null. */
export function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        names.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const regex = new RegExp(`^${source}$`);
  return (path) => {
    const found = regex.exec(path);
    if (!found) return null;
    return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1] ?? '')]));
  };
}

/**
 * @param {Array<{ pattern: string, load: (params: object) => Promise<object> }>} routes
 *   Earlier routes win, so list `/reader/new` before `/reader/:id`.
 * @param {{ mount: (view: object, path: string) => void, notFound: (path: string) => void }} handlers
 */
export function createRouter(routes, handlers) {
  const table = routes.map((route) => ({ ...route, match: compile(route.pattern) }));
  let token = 0;
  let current = null;

  async function resolve() {
    const path = parseHash(globalThis.location.hash);
    token += 1;
    const mine = token;
    if (current?.dispose) {
      try {
        current.dispose();
      } catch {
        // A view that fails to clean up must not stop the next one.
      }
    }
    current = null;
    for (const route of table) {
      const params = route.match(path);
      if (params === null) continue;
      try {
        const view = await route.load(params);
        if (mine !== token) {
          view?.dispose?.();
          return;
        }
        current = view;
        handlers.mount(view, path);
      } catch (error) {
        if (mine === token) handlers.failed(error, path);
      }
      return;
    }
    handlers.notFound(path);
  }

  return {
    start() {
      globalThis.addEventListener('hashchange', resolve);
      return resolve();
    },
    refresh: resolve,
    /** Goes to a screen. With `replace` the screen being left drops out of the back button's history. */
    go(path, { replace = false } = {}) {
      const target = `#${path}`;
      if (globalThis.location.hash === target) return resolve();
      if (replace) {
        const { pathname, search } = globalThis.location;
        globalThis.location.replace(`${pathname}${search}${target}`);
      } else {
        globalThis.location.hash = target;
      }
      return undefined;
    },
    get view() {
      return current;
    },
  };
}
