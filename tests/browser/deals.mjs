// Deals end-to-end (finding only: no product, coupon or alert registration).
// Usage: node tests/browser/deals.mjs <baseUrl> [screenshotDir]
// It starts its own tiny feed server, so it needs no network and no companion proxy.
import http from 'node:http';
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'http://localhost:8770';
const shotDir = process.argv[3];
const t = checker();
const c = t.check;

const when = (h) => new Date(Date.now() - h * 3600000).toUTCString();
const item = (n, title, hours, extra = '') => `<item><title>${title}</title><link>https://forum.adrenaline.com.br/threads/t${n}/</link><description>${extra}</description><pubDate>${when(hours)}</pubDate></item>`;
const RSS = `<rss><channel>${[
  item(1, 'Teclado Mecânico R$ 199,90 na Kabum', 2),
  item(2, 'Cupom: KABUM15 para placas de vídeo', 3),
  item(3, 'Monitor 27 polegadas R$ 899', 4),
  item(4, 'Amazon código AMZ50 em livros', 5),
  item(5, 'SSD 1TB NVMe R$ 349,90 cupom SSD20', 6),
  item(6, 'Fone bluetooth esgotado R$ 59', 7),
].join('')}</channel></rss>`;
const feedServer = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-private-network', 'true');
  res.setHeader('access-control-allow-headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' }).end(RSS);
});
await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
const proxy = `http://127.0.0.1:${feedServer.address().port}`;

const b = await launch();
const text = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const count = (sel) => b.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setVal = (sel, v) => b.ev(`{ const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }`);
const submit = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);
const IGNORE = ['ERR_CONNECTION_REFUSED', 'api.rss2json.com', 'allorigins', 'codetabs', 'ERR_FAILED', 'ERR_UNSAFE_PORT', 'status of 4', 'status of 5'];

// 1. Honest source list; nothing to register.
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 600 });
await b.ev(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('calendra.news.v1', JSON.stringify({ proxyUrl: ${JSON.stringify(proxy)} }))`);
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 2000 });
const status = await text('#provider-status');
c((status.match(/Unavailable/g) || []).length === 13 && /Feed/.test(status), 'source list: 1 integrated feed and 13 sources marked unavailable');
c(/bot challenge, which this app does not bypass/.test(status) && /Associates account/.test(status) && /HTTP 403/.test(status), 'each unavailable source states its real reason (no workaround suggested)');
c((await count('#provider-status a[href^="https://"]')) === 14, 'every source keeps a direct link');
c((await count('#item-form, #coupon-form, #alert-log, #notify-enable, [data-form]')) === 0, 'no registration forms: products, coupons and alerts cannot be entered');
c(!/Add coupon|Add product|Products I.m tracking|Record price/i.test(await text('main')), 'page copy never asks the user to register anything');

// 2. Search fallback.
await setVal('#deal-q', 'ssd 1tb');
await submit('#deal-search');
await sleep(400);
const results = await text('#deal-results');
c(/not live results/.test(results) && /Automated integration unavailable/.test(results), 'search says fallbacks are links, not live results');
const links = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#deal-results .provider-card a[href*="google.com/search"]')].map(a => a.href))`));
c(links.length === 13, `13 provider fallbacks have a Google search link (${links.length})`);
c(links.some((l) => l.includes('site%3Amercadolivre.com.br%20ssd%201tb')) && links.some((l) => l.includes('site%3Ahardmob.com.br')), 'queries are prefilled per site (site: operator, encoded)');
c(await b.ev(`[...document.querySelectorAll('#deal-results a[href*="google.com/search"]')].every(a => a.rel.includes('noopener') && a.target === '_blank')`), 'external links open in a new tab with noopener');
c((await count('#deal-results [data-copy]')) >= 13, '"Copy search query" is offered for every fallback');
c(/Price history/.test(results) && /Coupon/.test(results), 'helper searches for price history and coupons are offered');
c(/Community feed matches/.test(results) && /SSD 1TB NVMe/.test(results), 'the search also finds the matching community thread');
await click('#save-search');
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 1500 });
c(/★ ssd 1tb/.test(await text('#recent-searches')), 'saved search persists across reload');

// 3. Community feed (served by the local fixture feed).
const threadCount = await count('#thread-list .thread');
c(threadCount === 6, `the feed lists the fixture threads (${threadCount})`);
c(/Updated .* source: Adrenaline Ofertas RSS feed/.test(await text('#feed-status')) && /via your news proxy/.test(await text('#feed-status')), 'feed status names its source, freshness and route');
c(await b.ev(`[...document.querySelectorAll('#thread-list .thread')].every(t => /Community-reported/.test(t.innerText))`), 'every thread is labelled community-reported');
c(await b.ev(`[...document.querySelectorAll('#thread-list .thread h4 a')].every(a => a.href.startsWith('https://forum.adrenaline.com.br/') && a.rel.includes('noopener'))`), 'every thread links to the original forum thread');
c((await count('#thread-list img')) === 0, 'no images from the forum are shown');
c(/R\$\s?199,90/.test(await text('#thread-list')) && /not verified/.test(await text('#thread-list .price-line')), 'stated prices are shown and marked as not verified');
await setVal('#f-q', 'kabum');
await sleep(200);
c((await count('#thread-list .thread')) === 2, 'keyword filter narrows the list (2 Kabum threads)');
await setVal('#f-exclude', 'kabum');
await sleep(200);
c((await count('#thread-list .thread')) === 0, 'excluded words remove matches');
await setVal('#f-exclude', '');
await setVal('#f-q', '');
await setVal('#f-max', '300');
await sleep(200);
c((await count('#thread-list .thread')) === 2, 'max price filter keeps only threads that state a price up to R$ 300 (2)');
await setVal('#f-max', '');
await sleep(200);
await click('#thread-list .thread [data-action="thread-hide"]');
await sleep(200);
c((await count('#thread-list .thread')) === 5, 'hiding a thread removes it');
await click('#f-hidden');
await sleep(200);
c((await count('#thread-list .thread')) === 6 && (await count('#thread-list .thread.is-hidden')) === 1, 'show hidden brings it back, dimmed');
await click('#f-hidden');
await click('#thread-list .thread [data-action="thread-save"]');
await sleep(200);
await click('#f-saved');
await sleep(200);
c((await count('#thread-list .thread')) === 1, 'saved-only shows the saved thread');
await click('#f-saved');
await b.ev(`localStorage.setItem('calendra.ai.v1', JSON.stringify({ provider: 'off' }))`);
await click('#thread-list .thread [data-action="thread-summary"]');
await sleep(300);
c(/AI summaries are off/.test(await text('.summary-box:not([hidden])')), 'thread summary with AI off explains how to enable it');

// 4. Coupon finder.
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 1500 });
const chips = await count('#coupon-chips [data-coupon-store]');
c(chips === 8, `popular store chips are offered (${chips})`);
let coupons = await text('#coupon-results');
c(/KABUM15/.test(coupons) && /AMZ50/.test(coupons) && /SSD20/.test(coupons), 'codes posted in the community threads are found');
c((await count('#coupon-results .coupon-pill [data-copy]')) === 3 && /unverified/i.test(coupons), 'every found code can be copied and is marked unverified');
await click('#coupon-chips [data-coupon-store="Kabum"]');
await sleep(200);
coupons = await text('#coupon-results');
c(/KABUM15/.test(coupons) && !/AMZ50/.test(coupons), 'choosing a store narrows the found coupons');
await setVal('#coupon-q', 'loja inexistente');
c(/No coupon thread/.test(await text('#coupon-results')), 'no match gives an honest empty message');
await setVal('#coupon-q', 'amazon');
const csearch = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('#coupon-results a[href*="google.com/search"]')].map(a => decodeURIComponent(a.href)))`));
c(csearch.length === 6 && csearch.some((l) => l.includes('site:cuponomia.com.br cupom de desconto amazon')) && csearch.some((l) => l.includes('site:promobit.com.br')), `coupon sites are offered as encoded searches (${csearch.length})`);
c(/not live results/.test(await text('#coupon-results')), 'coupon site links are described as searches, not results');

// 4b. The optional rss2json key (the lasting fix when the free converter throttles).
await b.ev(`document.getElementById('feed-key-details').open = true`);
await setVal('#feed-key', 'TESTKEY123');
await submit('#feed-key-form');
await sleep(500);
c(JSON.parse(await b.ev(`localStorage.getItem('calendra.news.v1')`)).rss2jsonKey === 'TESTKEY123', 'the optional rss2json key is saved (shared with the News page)');
await b.ev(`localStorage.setItem('calendra.news.v1', JSON.stringify({ proxyUrl: ${JSON.stringify(proxy)} }))`);

// 5. Black theme everywhere on this page.
await b.ev(`localStorage.setItem('calendra.theme.v1', 'black')`);
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 1500 });
const bg = JSON.parse(await b.ev(`JSON.stringify({ theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode, bg: getComputedStyle(document.body).backgroundColor, bgImage: getComputedStyle(document.body).backgroundImage.slice(0, 40) })`));
c(bg.theme === 'black' && bg.mode === 'dark', `Black theme applies (${bg.theme}/${bg.mode})`);
if (shotDir) await b.shot(path.join(shotDir, 'deals-black.png'));
await b.ev(`localStorage.removeItem('calendra.theme.v1')`);

// 6. Persistence and layout.
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 1500 });
c((await count('#thread-list .thread')) === 5, 'the feed reloads (one thread is still hidden by choice)');
if (shotDir) await b.shot(path.join(shotDir, 'deals-1366.png'));
for (const [w, h] of [[360, 740], [768, 1024], [1920, 1080]]) {
  await b.visit(`${base}/deals.html`, { width: w, height: h, wait: 1800 });
  c((await b.ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0, `deals @${w}: no sideways overflow`);
  if (shotDir) await b.shot(path.join(shotDir, `deals-${w}.png`));
}

// 7. The throttled case: the feed fails, a saved copy is shown with an explained message (no bare "HTTP 429").
await b.ev(`localStorage.setItem('calendra.news.v1', JSON.stringify({ proxyUrl: 'http://127.0.0.1:9' }))`);
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 6000 });
const throttled = await text('#feed-status');
c(/throttled or unreachable/.test(throttled) && /saved copy/i.test(throttled), `when every route fails, the saved copy stays visible and the message is explained: "${throttled.slice(0, 90)}"`);
c((await count('#thread-list .thread')) === 5, 'the saved copy of the feed is still listed');

const errs = b.problems({ ignore: IGNORE });
c(errs.length === 0, `no uncaught errors${errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''}`);

b.close();
feedServer.close();
console.log(t.failed ? `${t.failed} check(s) FAILED` : 'All deals checks passed');
process.exit(t.failed ? 1 : 0);
