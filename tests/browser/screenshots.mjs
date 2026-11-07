// Regenerate docs/screenshots (JPEG). Usage: node tests/browser/screenshots.mjs <baseUrl> <proxyUrl> [outDir]
// Small phone (360x640), Full HD (1920x1080) and TV/4K (3840x2160, TV mode on).
import path from 'node:path';
import { launch, sleep } from './cdp.mjs';

const base = process.argv[2] || 'http://localhost:8770';
const proxy = process.argv[3] || 'http://127.0.0.1:8791';
const out = process.argv[4] || 'docs/screenshots';
const b = await launch();
const shot = async (name) => {
  await b.shot(path.join(out, name));
  console.log('saved', name);
};

await b.visit(`${base}/index.html`, { width: 1200, height: 700, wait: 500 });
await b.ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('calendra.news.v1', JSON.stringify({ proxyUrl: ${JSON.stringify(proxy)} }));`);

const sizes = { phone: [360, 640], fullhd: [1920, 1080] };
for (const [label, [w, h]] of Object.entries(sizes)) {
  await b.visit(`${base}/index.html`, { width: w, height: h, wait: 800 });
  await shot(`home-${label}.jpg`);
  await b.visit(`${base}/dashboard.html`, { width: w, height: h, wait: 9000 });
  await shot(`calendar-dashboard-${label}.jpg`);
  await b.visit(`${base}/calendario.html?date=2026-09-07`, { width: w, height: h, wait: 2500 });
  await shot(`calendario-${label}.jpg`);
  await b.ev(`document.getElementById('travel').scrollIntoView()`);
  await sleep(300);
  await shot(`calendario-travel-${label}.jpg`);
  await b.visit(`${base}/news.html`, { width: w, height: h, wait: 12000 });
  await shot(`news-${label}.jpg`);
  await b.visit(`${base}/markets.html`, { width: w, height: h, wait: 9000 });
  await shot(`markets-${label}.jpg`);
  await b.visit(`${base}/deals.html`, { width: w, height: h, wait: 6000 });
  await shot(`deals-${label}.jpg`);
  await b.visit(`${base}/settings.html`, { width: w, height: h, wait: 1200 });
  await shot(`settings-${label}.jpg`);
}

// TV / 4K with TV mode on.
await b.ev(`localStorage.setItem('calendra.display.v1', JSON.stringify({ tv: true }))`);
await b.visit(`${base}/index.html`, { width: 3840, height: 2160, wait: 800 });
await shot('home-tv-4k.jpg');
await b.visit(`${base}/dashboard.html`, { width: 3840, height: 2160, wait: 9000 });
await shot('calendar-dashboard-tv-4k.jpg');
await b.visit(`${base}/news.html`, { width: 3840, height: 2160, wait: 12000 });
await shot('news-tv-4k.jpg');
await b.ev(`localStorage.removeItem('calendra.display.v1')`);

b.close();
