// Travel & Holiday Intelligence checks. Usage: node tests/browser/travel.mjs <baseUrl> [screenshotDir]
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const shotDir = process.argv[3];
const t = checker();
const c = t.check;
const b = await launch();
const IGNORE = ['cotacoes.uol.com', 'ERR_FAILED', 'status of 429'];

await b.visit(`${base}/calendario.html`, { width: 1366, height: 900, wait: 3000 });
await b.ev(`localStorage.clear()`);
await b.visit(`${base}/calendario.html`, { width: 1366, height: 900, wait: 2500 });

c((await b.ev(`document.querySelectorAll('#travel-years [data-year]').length`)) === 5, 'five year buttons (2026-2030)');
c((await b.ev(`document.querySelectorAll('#travel-heatmap .hm-month').length`)) === 12, 'year map shows 12 months');

// 2027
await b.ev(`document.querySelector('#travel-years [data-year="2027"]').click()`);
await sleep(300);
const text2027 = await b.ev(`document.getElementById('travel-list').innerText`);
c(/Independência do Brasil/.test(text2027) && /4 days off/.test(text2027), '2027 list includes Independence with a 4-day break');
c(/Saturday, 4 September 2027/.test(text2027) && /Tuesday, 7 September 2027/.test(text2027), '2027 Independence break dates are correct (4-7 Sep)');
c((await b.ev(`document.getElementById('travel-provenance').innerText`)).includes('rule-generated for 2027'), 'provenance names the data and year');

// Country toggles drive the same data: Brazil only => Independence needs the Monday bridge.
await b.ev(`document.getElementById('holiday-us').click()`);
await sleep(400);
const brOnly = await b.ev(`document.getElementById('travel-list').innerText`);
c(/Request leave: Monday, 6 September 2027/.test(brOnly), 'Brazil-only: Independence requires Monday 6 Sep as leave');
await b.ev(`document.getElementById('holiday-br').click()`);
await sleep(400);
c(/Turn on United States or Brazil/.test(await b.ev(`document.getElementById('travel-next').innerText`)), 'no countries: friendly empty state');
await b.ev(`document.getElementById('holiday-us').click(); document.getElementById('holiday-br').click()`);
await sleep(400);

// Filters + sort
await b.ev(`document.querySelector('#travel-filters [data-type="bridge"]').click()`);
await sleep(300);
c(await b.ev(`[...document.querySelectorAll('#travel-list .opp-card')].every(c => /Bridge/.test(c.innerText))`), 'Bridge filter shows only bridge cards');
await b.ev(`document.querySelector('#travel-filters [data-type="all"]').click()`);
await b.ev(`const s = document.getElementById('travel-sort'); s.value = 'date'; s.dispatchEvent(new Event('change'))`);
await sleep(300);
const starts = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#travel-list .opp-card')].map(c => c.dataset.id.split('_')[0]))`));
c(starts.length > 3 && starts.every((s, i) => i === 0 || starts[i - 1] <= s), `sort by date is ascending (${starts.length} cards)`);

// ICS export: capture the blob content.
await b.ev(`window.__ics = null; const orig = URL.createObjectURL; URL.createObjectURL = (blob) => { blob.text().then(t => window.__ics = t); return orig.call(URL, blob); };`);
await b.ev(`document.getElementById('travel-export-year').click()`);
await sleep(500);
const ics = await b.ev(`window.__ics`);
c(ics && ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'), 'year export is a valid VCALENDAR');
c(ics && ics.split('BEGIN:VEVENT').length - 1 === ics.split('END:VEVENT').length - 1 && ics.includes('DTSTART;VALUE=DATE:20270904'), 'year export has balanced events incl. 4 Sep 2027');
await b.ev(`window.__ics = null; document.querySelector('#travel-list [data-action="ics"]').click()`);
await sleep(500);
c((await b.ev(`window.__ics`) || '').split('BEGIN:VEVENT').length === 2, 'single-break export contains exactly one event');

// Reminder goes through the existing alert system (same store the calendar reads).
const before = JSON.parse(await b.ev(`localStorage.getItem('calendra.reminders.v1') || '[]'`)).length;
await b.ev(`document.querySelector('#travel-list [data-action="remind"]').click()`);
await sleep(400);
const after = JSON.parse(await b.ev(`localStorage.getItem('calendra.reminders.v1') || '[]'`));
c(after.length === before + 1 && /Request leave|Plan ahead/.test(after.at(-1).title), 'Add reminder stores a reminder in the shared alert store');

// Persistence across reload.
await b.visit(`${base}/calendario.html`, { width: 1366, height: 900, wait: 2500 });
const kept = JSON.parse(await b.ev(`JSON.stringify({ year: document.querySelector('#travel-years .active')?.dataset.year, sort: document.getElementById('travel-sort').value })`));
c(kept.year === '2027' && kept.sort === 'date', `year and sort persist after reload (${JSON.stringify(kept)})`);

// 2030 works; optional observances are marked on the map but never counted.
await b.ev(`document.querySelector('#travel-years [data-year="2030"]').click()`);
await sleep(300);
c((await b.ev(`document.querySelectorAll('#travel-list .opp-card').length`)) > 3, '2030 generates opportunities');
await b.ev(`const o = document.getElementById('travel-optional'); o.checked = true; o.dispatchEvent(new Event('change'))`);
await sleep(300);
c((await b.ev(`document.querySelectorAll('#travel-heatmap .hm-optional').length`)) >= 2, 'optional observances (Carnaval, Corpus Christi) are marked on the map');
c(!/Carnaval|Corpus Christi/.test(await b.ev(`document.getElementById('travel-list').innerText`)), 'optional observances are not counted in any break');

// Phone: no overflow, section usable.
await b.visit(`${base}/calendario.html`, { width: 390, height: 844, wait: 2500 });
c((await b.ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0, 'phone: no sideways overflow with the travel section');
if (shotDir) {
  await b.ev(`document.getElementById('travel').scrollIntoView()`);
  await sleep(300);
  await b.shot(path.join(shotDir, 'travel-390.png'));
}
await b.visit(`${base}/calendario.html`, { width: 1920, height: 1080, wait: 2500 });
if (shotDir) {
  await b.ev(`document.getElementById('travel').scrollIntoView()`);
  await sleep(300);
  await b.shot(path.join(shotDir, 'travel-1920.png'));
}
const errs = b.problems({ ignore: IGNORE });
c(errs.length === 0, `no console errors${errs.length ? ': ' + errs[0] : ''}`);

b.close();
console.log(t.failed ? `\n${t.failed} check(s) FAILED` : '\nAll travel checks passed');
process.exit(t.failed ? 1 : 0);
