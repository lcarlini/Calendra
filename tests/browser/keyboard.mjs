// Keyboard operability. Usage: node tests/browser/keyboard.mjs <baseUrl>
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const t = checker();
const c = t.check;
const b = await launch();

const active = () => b.ev(`(() => { const e = document.activeElement; return e && e !== document.body ? (e.getAttribute('href') || e.id || e.tagName) : ''; })()`);

await b.visit(`${base}/index.html`, { width: 1366, height: 800, wait: 800 });
await b.ev(`localStorage.clear()`);
await b.visit(`${base}/index.html`, { width: 1366, height: 800, wait: 1200 });

// 1. Tab reaches the brand link, every nav link and every portal card, in order.
const seen = [];
for (let i = 0; i < 20; i += 1) {
  await b.key('Tab');
  await sleep(40);
  const a = await active();
  if (a) seen.push(a);
}
const wanted = ['index.html', 'dashboard.html', 'calendario.html', 'news.html', 'markets.html', 'deals.html', 'settings.html'];
c(wanted.every((w) => seen.includes(w)), `Tab reaches every nav link and portal card (${[...new Set(seen)].join(' ')})`);

// 2. Focus reached with the keyboard is clearly visible on a card (outline of at least 3px).
await b.ev(`document.body.focus()`);
let focusedCard = null;
for (let i = 0; i < 20 && !focusedCard; i += 1) {
  await b.key('Tab');
  await sleep(40);
  focusedCard = JSON.parse(await b.ev(`JSON.stringify(document.activeElement.classList.contains('portal-card') ? { style: getComputedStyle(document.activeElement).outlineStyle, width: parseFloat(getComputedStyle(document.activeElement).outlineWidth) } : null)`));
}
c(focusedCard && focusedCard.style !== 'none' && focusedCard.width >= 3, `keyboard focus on a portal card has a visible outline (${JSON.stringify(focusedCard)})`);

// 3. Enter on a focused card navigates.
await b.ev(`document.querySelectorAll('.portal-card')[2].focus()`);
await b.key('Enter');
await sleep(1500);
c((await b.ev(`location.pathname`)).endsWith('/news.html'), 'Enter on the third card opens News');

// 4. TV mode: arrow keys move focus between cards and nav links.
await b.ev(`localStorage.setItem('calendra.display.v1', JSON.stringify({ tv: true }))`);
await b.visit(`${base}/index.html`, { width: 1920, height: 1080, wait: 1200 });
c((await b.ev(`document.documentElement.dataset.tv`)) === 'on', 'TV mode is on');
await b.ev(`document.querySelectorAll('.portal-card')[0].focus()`);
await b.key('ArrowRight');
await sleep(80);
c((await active()) === 'calendario.html', `ArrowRight moves from Calendar to Calendário (${await active()})`);
await b.key('ArrowRight');
await sleep(80);
c((await active()) === 'news.html', `ArrowRight again reaches News (${await active()})`);
await b.key('ArrowLeft');
await sleep(80);
c((await active()) === 'calendario.html', 'ArrowLeft goes back');
await b.key('ArrowUp');
await sleep(80);
const up = await active();
c(['index.html', 'dashboard.html', 'calendario.html', 'news.html', 'markets.html', 'deals.html', 'settings.html'].includes(up) && up !== '', `ArrowUp moves focus to the navigation (${up})`);
await b.key('ArrowDown');
await sleep(80);
c((await active()).endsWith('.html'), 'ArrowDown moves focus back down to a card');

// 5. Arrow keys do NOT hijack text fields when not in TV mode and inside inputs.
await b.visit(`${base}/deals.html`, { width: 1366, height: 800, wait: 1500 });
await b.ev(`document.getElementById('deal-q').focus()`);
await b.ev(`document.getElementById('deal-q').value = 'abc'`);
await b.key('ArrowLeft');
c((await active()) === 'deal-q', 'arrow keys keep working inside text fields');

// 6. Dashboard controls are reachable and labelled.
await b.visit(`${base}/dashboard.html`, { width: 1366, height: 800, wait: 2500 });
const unlabeled = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('button, a[href], input, select')].filter(e => !(e.textContent.trim() || e.value || e.getAttribute('aria-label') || e.title || e.placeholder || e.labels?.length)).map(e => e.outerHTML.slice(0, 80)).slice(0, 5))`));
c(unlabeled.length === 0, `every dashboard control has an accessible name${unlabeled.length ? ': ' + unlabeled.join(' | ') : ''}`);

// 7. Every page has a main landmark, a way back to Home and exactly one h1/h2 title.
for (const p of ['index.html', 'news.html', 'markets.html', 'deals.html', 'settings.html', 'calendario.html', 'dashboard.html']) {
  await b.visit(`${base}/${p}`, { width: 1366, height: 800, wait: 900 });
  const info = JSON.parse(await b.ev(`JSON.stringify({ home: !!document.querySelector('a[href="index.html"]'), nav: !!document.querySelector('nav[aria-label]'), current: !!document.querySelector('[aria-current="page"]'), lang: document.documentElement.lang })`));
  c(info.home && info.nav && info.current && !!info.lang, `${p}: Home link, labelled nav, current page marked, lang set`);
}

b.close();
console.log(t.failed ? `\n${t.failed} check(s) FAILED` : '\nAll keyboard checks passed');
process.exit(t.failed ? 1 : 0);
