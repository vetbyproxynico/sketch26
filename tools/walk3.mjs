import { createRequire } from 'node:module';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const [out, base, tag] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];
const notes = [];
async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`[${name}] horizontal overflow ${overflow}px`);
}
async function state(page) {
  return page.evaluate(() => ({
    hash: location.hash,
    h1: document.querySelector('h1')?.textContent,
    banner: !document.getElementById('sample-banner').hidden,
    trace: document.getElementById('trace-count').textContent,
    errors: [...document.querySelectorAll('[role="alert"], .error, .notice--error')].map((e) => e.textContent.trim().slice(0, 200)).filter(Boolean),
  }));
}
async function click(page, text, label, wait = 2500) {
  const main = page.locator('main');
  const target = main.getByRole('button', { name: text }).or(main.getByRole('link', { name: text })).first();
  try { await target.click({ timeout: 5000 }); } catch (e) { problems.push(`[${label}] could not click "${text}": ${String(e.message).split('\n')[0]}`); return false; }
  await page.waitForTimeout(wait);
  return true;
}
for (const [name, w, hgt, scheme] of [['d', 1280, 900, 'light'], ['p', 390, 844, 'dark']]) {
  const context = await browser.newContext({ viewport: { width: w, height: hgt }, colorScheme: scheme });
  const page = await context.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${name}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) problems.push(`[${name}] ${r.status()} ${r.url()}`); });
  await page.goto(base);
  await page.waitForSelector('h1');
  // 1. example person through to plan
  await page.locator('button.example').nth(1).click();
  await page.waitForTimeout(2500);
  notes.push([name, 'favourites', await state(page)]);
  await shot(page, `${name}-fav`);
  await click(page, 'Build the map', name, 5000);
  notes.push([name, 'map', await state(page)]);
  await shot(page, `${name}-map`);
  await click(page, 'Plan the week', name, 3000);
  notes.push([name, 'plan', await state(page)]);
  await shot(page, `${name}-plan`);
  // 2. feedback: lit up on first, not today on second, note, update
  const before = await page.evaluate(() => [...document.querySelectorAll('main h3, main h4')].map((e) => e.textContent.trim()).slice(0, 12));
  await page.locator('main').getByRole('button', { name: /lit up/i }).or(page.locator('main').getByRole('radio', { name: /lit up/i })).first().click().catch((e) => problems.push(`[${name}] lit up: ${e.message.split('\n')[0]}`));
  await page.locator('main label.reaction--not_today').nth(1).click({ timeout: 5000 }).catch((e) => problems.push(`[${name}] not today: ${e.message.split('\n')[0]}`));
  await page.locator('main textarea').first().fill('She sang along to the first one. The second one upset her.');
  await shot(page, `${name}-plan-marked`);
  await click(page, 'Update the plan', name, 6000);
  notes.push([name, 'after feedback', await state(page)]);
  const after = await page.evaluate(() => [...document.querySelectorAll('main h3, main h4')].map((e) => e.textContent.trim()).slice(0, 12));
  notes.push([name, 'items before', before, 'items after', after]);
  await shot(page, `${name}-plan-updated`);
  // 3. print view
  await click(page, 'Print this session', name, 1500);
  notes.push([name, 'print', await state(page)]);
  await shot(page, `${name}-print`);
  // 4. room
  await page.goto(base + '#/room'); await page.waitForTimeout(800);
  const adds = page.locator('main').getByRole('button', { name: /^Add (Odette|Peggy|Ray)/ });
  const n = await adds.count();
  for (let i = 0; i < n; i += 1) { await page.locator('main').getByRole('button', { name: /^Add (Odette|Peggy|Ray)/ }).first().click().catch(() => {}); await page.waitForTimeout(300); }
  await shot(page, `${name}-room-ready`);
  await click(page, 'Plan the room', name, 12000);
  notes.push([name, 'room', await state(page)]);
  await shot(page, `${name}-room-done`);
  // 5. intake for a new person
  await page.goto(base + '#/new'); await page.waitForTimeout(800);
  const fields = await page.evaluate(() => [...document.querySelectorAll('main input, main textarea, main select')].map((e) => `${e.tagName}:${e.type}:${e.id || e.name}`));
  notes.push([name, 'intake fields', fields]);
  await page.locator('main textarea').first().fill('My dad Bernard was born in 1938 in Glasgow. He loved Frank Sinatra, The Great Escape and Hancock\'s Half Hour. Nothing about the war please.');
  await click(page, 'Fill in the form from this', name, 3000);
  await shot(page, `${name}-intake-filled`);
  notes.push([name, 'intake', await state(page), await page.evaluate(() => [...document.querySelectorAll('main input')].map((e) => `${e.id || e.name}=${e.type === 'checkbox' ? e.checked : e.value}`))]);
  await click(page, 'Continue to favourites', name, 3500);
  notes.push([name, 'intake continue', await state(page)]);
  await shot(page, `${name}-intake-fav`);
  await context.close();
}
for (const n of notes) console.log(JSON.stringify(n));
console.log('PROBLEMS', JSON.stringify(problems, null, 1));
await browser.close();
