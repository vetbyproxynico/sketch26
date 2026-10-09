import { announce, focusEl, h } from './dom.js';
import { createRouter } from './router.js';
import { button, linkButton } from './components/ui.js';
import { checkStore, session, setNotice, storageNotice } from './session.js';
import { SAMPLE_BANNER } from './words.js';

/*
 * Boot and shell. Finds out whether the server has a Qloo key (if not, or if
 * the address has ?sample=1, the whole journey runs on invented sample data
 * under a banner on every screen), then starts the router. Each view is loaded
 * when its route is first visited.
 */

const load = (path, name) => async (params) => (await import(path))[name](params);

const ROUTES = [
  { pattern: '/', load: load('./views/home.js', 'homeView') },
  { pattern: '/about', load: load('./views/about.js', 'aboutView') },
  { pattern: '/saved', load: load('./views/saved.js', 'savedView') },
  { pattern: '/reader/new', load: load('./views/loves.js', 'newReaderView') },
  { pattern: '/reader/confirm', load: load('./views/confirm.js', 'confirmView') },
  { pattern: '/reader/try/:example', load: load('./views/try.js', 'tryReaderView') },
  { pattern: '/reader/edit/:id', load: load('./views/loves.js', 'editReaderView') },
  { pattern: '/reader/:id/shelf', load: load('./views/shelf.js', 'shelfView') },
  { pattern: '/reader/:id/slip', load: load('./views/print.js', 'slipView') },
  { pattern: '/reader/:id', load: load('./views/ladder.js', 'ladderView') },
  { pattern: '/group/new', load: load('./views/group.js', 'newGroupView') },
  { pattern: '/group/confirm', load: load('./views/group-confirm.js', 'groupConfirmView') },
  { pattern: '/group/try', load: load('./views/try.js', 'tryGroupView') },
  { pattern: '/group/:id/sheet', load: load('./views/print.js', 'sheetView') },
  { pattern: '/group/:id/edit', load: load('./views/group.js', 'editGroupView') },
  { pattern: '/group/:id/reader/:row', load: load('./views/try.js', 'groupReaderView') },
  { pattern: '/group/:id', load: load('./views/board.js', 'boardView') },
];

let firstRender = true;

/* -------------------------------------------------------------- the shell */

function renderBanner() {
  const banner = document.getElementById('sample-banner');
  if (!banner) return;
  banner.replaceChildren();
  banner.hidden = session.mode !== 'sample';
  if (session.mode !== 'sample') {
    delete document.documentElement.dataset.mode;
    return;
  }
  banner.append(h('p', { class: 'sample-banner__text' }, h('strong', null, 'Sample data:'), ` ${SAMPLE_BANNER.replace(/^Sample data: /, '')}`));
  if (session.forcedSample && session.health?.qlooConfigured) {
    banner.append(h('a', { class: 'sample-banner__link', href: `${location.pathname}${location.hash}` }, 'Leave sample mode'));
  }
  document.documentElement.dataset.mode = 'sample';
}

function renderNav() {
  const saved = document.getElementById('nav-saved');
  if (saved) saved.hidden = session.store.isEmpty();
  const path = location.hash.replace(/^#/, '') || '/';
  for (const link of document.querySelectorAll('#site-nav a')) {
    const target = link.getAttribute('href').replace(/^#/, '');
    const current = target === '/' ? path === '/' : path === target || path.startsWith(`${target}/`) || (target === '/reader/new' && path.startsWith('/reader/')) || (target === '/group/new' && path.startsWith('/group/'));
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function useSample() {
  session.mode = 'sample';
  setNotice('server', null);
  renderBanner();
  announce('Sample mode is on. Every book here is invented.');
  session.router.refresh();
}

function serverNotice() {
  if (!session.serverDown) {
    setNotice('server', null);
    return;
  }
  setNotice(
    'server',
    h(
      'div',
      { class: 'note note--warn' },
      h('p', { class: 'note__title' }, 'Rung could not reach its server'),
      h('p', null, 'You can look around, but building a ladder needs the server. Try again, or use sample data.'),
      h('div', { class: 'actions' },
        button({
          label: 'Try again',
          variant: 'secondary',
          onClick: async () => {
            try {
              session.health = await session.liveApi.health();
              session.serverDown = false;
              session.mode = session.health.qlooConfigured ? 'live' : 'sample';
              renderBanner();
              serverNotice();
              announce('Connected.');
              session.router.refresh();
            } catch {
              announce('Still no answer from the server.');
            }
          },
        }),
        button({ label: 'Use sample data', variant: 'primary', onClick: useSample }),
      ),
    ),
  );
}

/** Lets any view switch to sample data, as the error panel's button does. */
session.useSample = useSample;

function failedView(error) {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That screen would not load');
  console.error('view failed', error?.name ?? 'error');
  return {
    title: 'Something went wrong',
    el: h('div', { class: 'page prose' }, title, h('p', null, 'Rung could not show this screen. Nothing was changed. Go back to the start and try again.'), linkButton({ label: 'Back to the start', href: '#/', variant: 'primary' })),
    heading: title,
  };
}

function notFoundView(path) {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That page is not here');
  return {
    title: 'Not found',
    el: h('div', { class: 'page prose' }, title, h('p', null, 'Rung has no screen at this address. Go back to the start.'), linkButton({ label: 'Back to the start', href: '#/', variant: 'primary' })),
    heading: title,
    path,
  };
}

function mount(view) {
  const main = document.getElementById('main');
  main.replaceChildren(view.el);
  document.title = `${view.title} | Rung`;
  renderNav();
  main.removeAttribute('aria-busy');
  if (!firstRender) {
    window.scrollTo(0, 0);
    focusEl(view.heading ?? main, { scroll: false });
  }
  firstRender = false;
  view.afterMount?.();
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  const wantsSample = new URLSearchParams(location.search).get('sample') === '1';
  session.forcedSample = wantsSample;
  try {
    session.health = await session.liveApi.health();
    session.serverDown = false;
  } catch {
    session.health = null;
    session.serverDown = !wantsSample;
  }
  session.mode = wantsSample || (session.health !== null && !session.health.qlooConfigured) ? 'sample' : 'live';

  checkStore({ ok: true });
  if (session.store.problem) storageNotice(session.store.problem);
  renderBanner();
  serverNotice();
  session.store.subscribe(renderNav);

  // The page address after the "#" is the screen, so the skip link cannot be a plain "#main": it would ask for a screen called "main".
  document.querySelector('.skip')?.addEventListener('click', (event) => {
    event.preventDefault();
    focusEl(document.getElementById('main'), { scroll: true });
  });

  session.router = createRouter(ROUTES, {
    mount,
    failed: (error) => mount(failedView(error)),
    notFound: (path) => mount(notFoundView(path)),
  });
  window.addEventListener('hashchange', renderNav);
  await session.router.start();
}

boot().catch((error) => {
  console.error('boot failed', error?.name ?? 'error');
  const main = document.getElementById('main');
  if (main) main.replaceChildren(h('div', { class: 'page prose' }, h('h1', { class: 'page-title' }, 'Rung did not start'), h('p', null, 'Something went wrong while starting. Reload the page to try again.')));
});
