// Layout checks across the viewport matrix.
// Usage: node tests/browser/layout.mjs <baseUrl> [screenshotDir]
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const shotDir = process.argv[3];
const t = checker();
const c = t.check;
const b = await launch();

const sizes = [[320, 568], [360, 640], [390, 844], [768, 1024], [1024, 768], [1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]];
const pages = ['index.html', 'dashboard.html', 'calendario.html', 'news.html', 'markets.html', 'deals.html', 'settings.html'];
// Known and handled: the UOL quotes endpoint is blocked by CORS on some origins and the app falls back.
const IGNORE = ['cotacoes.uol.com', 'ERR_FAILED', 'status of 429', 'api.gdeltproject.org', 'api.rss2json.com'];

for (const [w, h] of process.env.QUICK ? [] : sizes) {
  for (const p of pages) {
    await b.visit(`${base}/${p}`, { width: w, height: h, wait: 1800 });
    const over = await b.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    const errs = b.problems({ ignore: IGNORE });
    c(over <= 0 && errs.length === 0, `${p} @${w}x${h}: overflow=${over}px errors=${errs.length}${errs.length ? ' ' + errs[0] : ''}`);
  }
}

// Full HD: three complete clock cards in ONE row, time dominant, nothing clipped.
await b.visit(`${base}/dashboard.html`, { width: 1920, height: 1080, wait: 4000 });
const clocks = JSON.parse(
  await b.ev(`JSON.stringify([...document.querySelectorAll('#clock-grid .clock-card')].slice(0,3).map(e => {
    const r = e.getBoundingClientRect(); const t = e.querySelector('.clock-time');
    return { top: Math.round(r.top), right: Math.round(r.right), tw: t ? t.scrollWidth : 0, tcw: t ? t.clientWidth : 0, font: t ? parseFloat(getComputedStyle(t).fontSize) : 0 };
  }))`)
);
c(clocks.length === 3, 'Full HD: three clock cards present');
c(new Set(clocks.map((x) => x.top)).size === 1, `Full HD: three clocks in one row (tops ${clocks.map((x) => x.top)})`);
c(clocks.every((x) => x.right <= 1920), 'Full HD: clocks inside the viewport');
c(clocks.every((x) => x.tw <= x.tcw + 1), 'Full HD: clock digits not clipped');
c(clocks.every((x) => x.font >= 48), `Full HD: time is dominant (font ${clocks.map((x) => Math.round(x.font))}px)`);
const calTop = await b.ev(`Math.round(document.querySelector('[data-gadget="calendar"]').getBoundingClientRect().top)`);
const marketsTop = await b.ev(`Math.round(document.querySelector('[data-gadget="markets"]').getBoundingClientRect().top)`);
c(calTop < 700, `Full HD: compact calendar starts high on the page (top ${calTop}px)`);
const clocksBottom = await b.ev(`Math.round(document.querySelector('[data-gadget="clocks"]').getBoundingClientRect().bottom)`);
c(marketsTop >= clocksBottom, `Full HD: market cards sit beneath the clocks (top ${marketsTop}px, clocks end ${clocksBottom}px)`);
if (shotDir) await b.shot(path.join(shotDir, 'dashboard-1920.png'));

// Phone: clocks stack.
await b.visit(`${base}/dashboard.html`, { width: 390, height: 844, wait: 3000 });
const phone = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#clock-grid .clock-card')].slice(0,3).map(e => Math.round(e.getBoundingClientRect().top)))`));
c(new Set(phone).size === 3, `Phone: clocks stacked (tops ${phone})`);
if (shotDir) await b.shot(path.join(shotDir, 'dashboard-390.png'));

// Calendário weekday columns equal at every size (month view, then the year view modelled on UI/Calendar.html).
await b.ev("localStorage.setItem('calendra.calView.v1','month')");
for (const [w, h] of [[390, 844], [768, 1024], [1366, 768], [1920, 1080]]) {
  await b.visit(`${base}/calendario.html?date=2026-09-07`, { width: w, height: h, wait: 2500 });
  const widths = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('.full-cal-days > .full-day')].slice(0,7).map(c => Math.round(c.getBoundingClientRect().width)))`));
  c(widths.length === 7 && Math.max(...widths) - Math.min(...widths) <= 1, `Calendário @${w}: seven equal columns ${widths}`);
}
await b.ev("localStorage.setItem('calendra.calView.v1','year')");
for (const [w, h] of [[390, 844], [768, 1024], [1366, 768], [1920, 1080]]) {
  await b.visit(`${base}/calendario.html`, { width: w, height: h, wait: 2500 });
  const r = JSON.parse(await b.ev(`JSON.stringify({ months: document.querySelectorAll('.ref-month').length, widths: [...document.querySelector('.ref-grid').children].slice(0,7).map(c => Math.round(c.getBoundingClientRect().width)), over: document.documentElement.scrollWidth - document.documentElement.clientWidth })`));
  c(r.months === 12 && Math.max(...r.widths) - Math.min(...r.widths) <= 1 && r.widths[0] >= 30 && r.over <= 0, `Calendário year view @${w}: 12 months, seven equal columns ${r.widths}, overflow ${r.over}`);
}

// TV mode.
await b.visit(`${base}/dashboard.html`, { width: 1920, height: 1080, wait: 2500 });
await b.ev(`document.querySelector('[data-tv-toggle]').click()`);
await sleep(400);
const tvo = JSON.parse(
  await b.ev(`JSON.stringify({ tv: document.documentElement.dataset.tv, fs: getComputedStyle(document.documentElement).fontSize, pressed: document.querySelector('[data-tv-toggle]').getAttribute('aria-pressed'), over: document.documentElement.scrollWidth - document.documentElement.clientWidth })`)
);
c(tvo.tv === 'on' && parseFloat(tvo.fs) > 16 && tvo.pressed === 'true', `TV mode on: root font ${tvo.fs}`);
c(tvo.over <= 0, 'TV mode: no sideways overflow at 1920');
const tvClocks = JSON.parse(
  await b.ev(`JSON.stringify([...document.querySelectorAll('#clock-grid .clock-card')].slice(0,3).map(e => { const t = e.querySelector('.clock-time'); return { top: Math.round(e.getBoundingClientRect().top), clip: t.scrollWidth > t.clientWidth + 1 }; }))`)
);
c(new Set(tvClocks.map((x) => x.top)).size === 1 && tvClocks.every((x) => !x.clip), 'TV mode: three clocks still in one row, not truncated');
if (shotDir) await b.shot(path.join(shotDir, 'dashboard-tv-1920.png'));

await b.visit(`${base}/dashboard.html`, { width: 3840, height: 2160, wait: 2500 });
const k = JSON.parse(
  await b.ev(`JSON.stringify({ tv: document.documentElement.dataset.tv, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, clip: [...document.querySelectorAll('#clock-grid .clock-time')].slice(0,3).some(t => t.scrollWidth > t.clientWidth + 1) })`)
);
c(k.tv === 'on' && k.over <= 0 && !k.clip, `TV mode persists across reload; 3840x2160 has no overflow or clipped digits ${JSON.stringify(k)}`);
if (shotDir) await b.shot(path.join(shotDir, 'dashboard-tv-3840.png'));
await b.ev(`localStorage.removeItem('calendra.display.v1')`);

b.close();
console.log(t.failed ? `\n${t.failed} check(s) FAILED` : '\nAll layout checks passed');
process.exit(t.failed ? 1 : 0);
