import * as api from './api.js';
import { announce } from './dom.js';
import { allPeople, isPersistent, onChange as onStoreChange, savePerson } from './store.js';
import { createTracePanel } from './components/trace-panel.js';
import { currentPath, navigate, startRouter } from './router.js';
import { favouritesView } from './views/favourites.js';
import { homeView } from './views/home.js';
import { intakeView } from './views/intake.js';
import { mapView } from './views/map.js';
import { notFoundView } from './views/not-found.js';
import { peopleView } from './views/people.js';
import { planView } from './views/plan.js';
import { printView } from './views/print.js';
import { roomView } from './views/room.js';

const routes = [
  { re: /^\/$/, view: homeView },
  { re: /^\/new$/, view: () => intakeView(null) },
  { re: /^\/edit\/([^/]+)$/, view: (id) => intakeView(id) },
  { re: /^\/person\/([^/]+)\/favourites$/, view: favouritesView },
  { re: /^\/person\/([^/]+)\/map$/, view: mapView },
  { re: /^\/person\/([^/]+)\/plan$/, view: planView },
  { re: /^\/person\/([^/]+)\/print\/([^/]+)$/, view: printView },
  { re: /^\/people$/, view: peopleView },
  { re: /^\/room$/, view: roomView },
  { re: /^\/__missing__$/, view: notFoundView },
];

const main = document.getElementById('main');
const banner = document.getElementById('sample-banner');
const traceButton = document.getElementById('trace-button');
const traceCount = document.getElementById('trace-count');
const skip = document.getElementById('skip-link');

function updateBanner() {
  const show = api.isSample();
  const wasHidden = banner.hidden;
  banner.hidden = !show;
  if (show && wasHidden) announce('Sample data is on. Every name, year and score you see is invented.');
}

const storageNote = document.getElementById('storage-note');

function updateStorageNote() {
  const show = !isPersistent();
  const wasHidden = storageNote.hidden;
  storageNote.hidden = !show;
  if (show && wasHidden) announce('This browser is not saving your work. People you add will be forgotten when you close or refresh this page.');
}

function updateTraceButton() {
  // Decisions are the agent's reasoning, not questions asked of Qloo.
  const n = api.getTrace().filter((entry) => entry.kind !== 'decision').length;
  traceCount.textContent = String(n);
  traceButton.setAttribute('aria-label', `Trace, ${n} ${n === 1 ? 'question' : 'questions'} so far`);
}

function markNav(path) {
  const current = path === '/' ? 'home' : path === '/people' ? 'people' : path === '/room' ? 'room' : '';
  for (const link of document.querySelectorAll('[data-route]')) {
    if (link.dataset.route === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

const tracePanel = createTracePanel();
document.body.appendChild(tracePanel.dialog);
traceButton.addEventListener('click', () => tracePanel.open());
api.onTrace(updateTraceButton);
api.onModeChange(updateBanner);
onStoreChange(updateStorageNote);

skip.addEventListener('click', (event) => {
  event.preventDefault();
  main.setAttribute('tabindex', '-1');
  main.focus();
});

api.init().then(() => {
  updateBanner();
  // A person built while the page was on sample data holds invented
  // suggestions. Once the live service answers, start them again from their
  // favourites so nothing invented is shown as real.
  if (api.isSample()) return;
  let reset = false;
  for (const person of allPeople()) {
    if (person.sample !== true) continue;
    person.resolved = null;
    person.profile = null;
    person.map = null;
    person.plan = null;
    person.changes = null;
    person.mapWork = null;
    person.draft = {};
    person.sample = false;
    savePerson(person);
    reset = true;
  }
  if (reset) {
    announce('The live taste service is connected. People made on sample data start again from their favourites.');
    navigate(currentPath() === '/' || currentPath() === '/people' || currentPath() === '/room' ? currentPath() : '/');
  }
});
updateBanner();
updateTraceButton();
startRouter(routes, main, (path, view) => {
  markNav(path, view);
  updateStorageNote();
});
