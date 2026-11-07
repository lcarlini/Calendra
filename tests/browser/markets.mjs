// Markets page and dashboard rates strip. Usage: node tests/browser/markets.mjs <baseUrl> [screenshotDir]
// Talks to the real public APIs, so it needs network access.
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const shotDir = process.argv[3];
const t = checker();
const c = t.check;
const b = await launch();
const IGNORE = ['cotacoes.uol.com', 'ERR_FAILED', 'status of 429'];

await b.visit(`${base}/markets.html`, { width: 1366, height: 900, wait: 1000 });
await b.ev(`localStorage.clear(); sessionStorage.clear()`);
await b.visit(`${base}/markets.html`, { width: 1366, height: 900, wait: 9000 });

await b.ev(`document.querySelectorAll('#rates-grid details').forEach(d => { d.open = true; })`);
await sleep(200);
const rateIds = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#rates-grid .rate-card')].map(e => e.dataset.rate))`));
c(rateIds.includes('selic') && rateIds.includes('fed-target') && rateIds.includes('ecb-deposit'), `policy rate cards present (${rateIds})`);
const cards = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#rates-grid .rate-card')].map(e => e.innerText))`));
c(cards.length > 0 && cards.every((x) => /Effective/.test(x) && /Source/.test(x) && /Fetched/.test(x) && /annualized/.test(x)), 'every rate card shows effective date, source, fetch time and "annualized"');
const fed = cards.find((x) => /Fed funds target range/.test(x)) || '';
c(/3\.\d\d%–\d\.\d\d%/.test(fed) && /not the effective rate/.test(fed), 'Fed card shows the target RANGE and says it is not the effective rate');
const ecb = cards.find((x) => /Deposit facility/.test(x)) || '';
c(/deposit facility/i.test(ecb) && /date the rate last changed/.test(ecb), 'ECB card identifies the deposit facility rate and the change date');
const selic = cards.find((x) => /Selic target/.test(x)) || '';
c(/Target set by Copom/.test(selic) && !/NaN|undefined/.test(selic), 'Selic card is labelled as a policy target');
c(cards.some((x) => /Effective federal funds rate/.test(x) && /Effective overnight rate/.test(x)), 'effective overnight rate is a separate card');
c(!cards.some((x) => /NaN|undefined|null/.test(x)), 'no NaN/undefined/null on rate cards');

const fx = await b.ev(`document.getElementById('fx-grid').innerText`);
c(/USD\/BRL/.test(fx) && /End of day/.test(fx) && /As of/.test(fx), 'currency cards are labelled end-of-day with an as-of date');

const rows = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#br-table tbody tr')].map(r => ({ s: r.dataset.symbol, t: r.innerText })))`));
c(rows.length === 5, `B3 default watchlist has 5 rows (${rows.map((r) => r.s)})`);
const petr = rows.find((r) => r.s === 'PETR4');
c(petr && /R\$/.test(petr.t) && /Delayed/.test(petr.t), 'PETR4 shows a BRL price and a Delayed badge');
const weg = rows.find((r) => r.s === 'WEGE3');
c(weg && /Needs token/.test(weg.t) && !/R\$/.test(weg.t), 'WEGE3 says it needs a token and shows no invented price');
c((await b.ev(`document.querySelectorAll('#br-table svg.sparkline').length`)) >= 2, 'sparklines are drawn from real history');
c(/Return \(1mo, adjusted\)/i.test(await b.ev(`document.getElementById('br-return-head').innerText`)), 'return column states the range and that it is adjusted');

// US section is honest.
const us = await b.ev(`document.getElementById('us-h').closest('section').innerText`);
c(/Automated quotes unavailable/.test(us) && /AAPL/.test(us) && !/\$\s?\d/.test(us), 'US section says quotes are unavailable and shows no prices');

// Edit watchlist, persistence, validation.
await b.ev(`(() => { const i = document.getElementById('br-symbol'); i.value = 'bbas3'; document.getElementById('br-add').requestSubmit() })()`);
await sleep(2500);
c((await b.ev(`document.querySelectorAll('#br-table tbody tr').length`)) === 6, 'adding BBAS3 adds a row');
await b.ev(`document.querySelector('[data-remove="BBAS3"]').click()`);
await sleep(1500);
c((await b.ev(`document.querySelectorAll('#br-table tbody tr').length`)) === 5, 'removing a ticker removes the row');
await b.ev(`(() => { const i = document.getElementById('br-symbol'); i.removeAttribute('pattern'); i.value = 'not a ticker'; document.getElementById('br-add').requestSubmit() })()`);
await sleep(500);
c(/does not look like a B3 ticker/.test(await b.ev(`document.getElementById('br-status').innerText`)), 'invalid ticker is rejected with a clear message');

// Range switch changes the return label (real data for that range, not reused).
await b.ev(`const s = document.getElementById('br-range'); s.value = '6mo'; s.dispatchEvent(new Event('change'))`);
await sleep(4500);
c(/Return \(6mo, adjusted\)/i.test(await b.ev(`document.getElementById('br-return-head').innerText`)), 'range switch updates the return column');

// Token is session-only: never in localStorage.
await b.ev(`document.getElementById('br-token').value = 'secret-token-123'; document.getElementById('br-token-form').requestSubmit()`);
await sleep(1500);
c(!(await b.ev(`JSON.stringify(localStorage)`)).includes('secret-token-123'), 'brapi token is not written to localStorage');
c((await b.ev(`sessionStorage.getItem('calendra.brapi.token')`)) === 'secret-token-123', 'brapi token is kept for the session only');
await b.ev(`document.getElementById('br-token-clear').click()`);
await sleep(800);
c((await b.ev(`sessionStorage.getItem('calendra.brapi.token')`)) === null, 'clearing removes the token');

// Overflow and phone.
for (const [w, h] of [[390, 844], [1920, 1080]]) {
  await b.visit(`${base}/markets.html`, { width: w, height: h, wait: 6000 });
  c((await b.ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0, `markets @${w}: no page-level sideways scroll (table scrolls inside its own region)`);
  if (shotDir) await b.shot(path.join(shotDir, `markets-${w}.png`));
}

// Dashboard strip shares the same data layer.
await b.visit(`${base}/dashboard.html`, { width: 1920, height: 1080, wait: 8000 });
const strip = await b.ev(`document.getElementById('rates-grid').innerText`);
c(/Selic target/.test(strip) && /Fed funds target range/.test(strip) && /Deposit facility/.test(strip), 'dashboard rates strip shows Selic, Fed range and ECB deposit rate');
const errs = b.problems({ ignore: IGNORE });
c(errs.length === 0, `no console errors${errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''}`);

b.close();
console.log(t.failed ? `\n${t.failed} check(s) FAILED` : '\nAll markets checks passed');
process.exit(t.failed ? 1 : 0);
