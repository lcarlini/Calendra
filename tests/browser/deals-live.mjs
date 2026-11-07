// Live check: the Deals feed with NO proxy, against the real public services (rss2json, then public relays).
// Usage: node tests/browser/deals-live.mjs <baseUrl> [screenshotDir]
// Depends on the internet, so it is not part of the regular suite.
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const shotDir = process.argv[3];
const t = checker();
const b = await launch();
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 500 });
await b.ev(`localStorage.clear(); sessionStorage.clear()`);
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 500 });
for (let i = 0; i < 20; i += 1) {
  await sleep(1500);
  if ((await b.ev(`document.querySelectorAll('#thread-list .thread').length`)) > 0) break;
}
const status = await b.ev(`document.getElementById('feed-status').innerText`);
const n = await b.ev(`document.querySelectorAll('#thread-list .thread').length`);
const coupons = await b.ev(`document.querySelectorAll('#coupon-results .coupon-find').length`);
console.log(`  info: ${n} threads, ${coupons} coupon threads; status: ${status}`);
t.check(n > 0, `live: community threads load with no proxy (${n})`);
t.check(!/HTTP 429$/.test(status.trim()), 'live: status is an explained message, not a bare HTTP 429');
if (shotDir) await b.shot(path.join(shotDir, 'deals-live.png'));
b.close();
console.log(t.failed ? `${t.failed} check(s) FAILED` : 'Live deals check passed');
process.exit(t.failed ? 1 : 0);
