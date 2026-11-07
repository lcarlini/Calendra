// Deals end-to-end. Usage: node tests/browser/deals.mjs <baseUrl> <proxyUrl> [screenshotDir]
// Needs the news proxy running (it serves the Adrenaline Ofertas feed) and network access.
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'http://localhost:8770';
const proxy = process.argv[3] || 'http://127.0.0.1:8791';
const shotDir = process.argv[4];
const t = checker();
const c = t.check;
const b = await launch();

const text = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const count = (sel) => b.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const setVal = (sel, v) => b.ev(`{ const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }`);
const submit = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);
const IGNORE = ['ERR_CONNECTION_REFUSED'];

// 1. No proxy: honest statuses.
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 600 });
await b.ev(`localStorage.clear(); sessionStorage.clear()`);
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 1500 });
const status = await text('#provider-status');
c((status.match(/Unavailable/g) || []).length === 13 && /Feed/.test(status), 'source list: 1 integrated feed and 13 sources marked unavailable');
c(/bot challenge, which this app does not bypass/.test(status) && /Associates account/.test(status) && /HTTP 403/.test(status), 'each unavailable source states its real reason (no workaround suggested)');
c((await count('#provider-status a[href^="https://"]')) === 14, 'every source keeps a direct link');
c(/needs the news proxy/i.test(await text('#feed-status')) && (await count('.thread')) === 0, 'no proxy: no threads and a clear explanation');

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
c(/histórico de preço|Price history/.test(results) && /Coupon/.test(results), 'helper searches for price history and coupons are offered');
await click('#save-search');
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 1200 });
c(/★ ssd 1tb/.test(await text('#recent-searches')), 'saved search persists across reload');

// 3. Real community feed through the proxy.
await b.ev(`localStorage.setItem('calendra.news.v1', JSON.stringify({ proxyUrl: ${JSON.stringify(proxy)} }))`);
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 5000 });
const threadCount = await count('#thread-list .thread');
c(threadCount >= 10, `real Adrenaline threads are listed (${threadCount})`);
c(/Updated .* source: Adrenaline Ofertas RSS feed/.test(await text('#feed-status')), 'feed status names its source and freshness');
c(await b.ev(`[...document.querySelectorAll('#thread-list .thread')].every(t => /Community-reported/.test(t.innerText))`), 'every thread is labelled community-reported');
c(await b.ev(`[...document.querySelectorAll('#thread-list .thread h4 a')].every(a => a.href.startsWith('https://forum.adrenaline.com.br/') && a.rel.includes('noopener'))`), 'every thread links to the original forum thread');
c((await count('#thread-list img')) === 0, 'no images from the forum are shown');
c(await b.ev(`[...document.querySelectorAll('#thread-list .excerpt')].every(e => e.innerText.length <= 201)`), 'excerpts are short (the post body is not republished)');
const priced = await count('#thread-list .price-line');
console.log(`  info: ${priced} threads state a price`);
c(!priced || /not verified/.test(await text('#thread-list .price-line')), 'stated prices are marked as not verified');

// Filters
const total = await count('#thread-list .thread');
const firstWord = (await b.ev(`document.querySelector('#thread-list .thread h4')?.innerText || ''`)).split(/\s+/).find((w) => /^[\p{L}]{5,}$/u.test(w)) || 'oferta';
await setVal('#f-q', firstWord);
await sleep(200);
const filtered = await count('#thread-list .thread');
c(filtered >= 1 && filtered <= total, `keyword filter "${firstWord}" narrows the list (${filtered} of ${total})`);
await setVal('#f-exclude', firstWord);
await sleep(200);
c((await count('#thread-list .thread')) === 0, 'excluded words remove matches');
await setVal('#f-exclude', '');
await setVal('#f-q', '');
await sleep(200);
await click('#thread-list .thread [data-action="thread-hide"]');
await sleep(200);
c((await count('#thread-list .thread')) === total - 1, 'hiding a thread removes it');
await click('#f-hidden');
await sleep(200);
c((await count('#thread-list .thread')) === total && (await count('#thread-list .thread.is-hidden')) === 1, 'show hidden brings it back, dimmed');
await click('#f-hidden');
await click('#thread-list .thread [data-action="thread-save"]');
await sleep(200);
await click('#f-saved');
await sleep(200);
c((await count('#thread-list .thread')) === 1, 'saved-only shows the saved thread');
await click('#f-saved');

// AI off: nothing is sent
await click('#thread-list .thread [data-action="thread-summary"]');
await sleep(300);
c(/AI summaries are off/.test(await text('.summary-box:not([hidden])')), 'thread summary with AI off explains how to enable it');

// 4. Tracked product, history, alerts.
await setVal('#i-title', 'SSD Teste 1TB');
await setVal('#i-store', 'Loja X');
await setVal('#i-price', '400,00');
await submit('#item-form');
await sleep(300);
c(/No price history|1 price/.test(await text('#item-list')) && /locally observed|entered by you/.test(await text('#item-list')), 'a single price has no trend and the history is labelled locally observed');
await setVal('#i-title', 'SSD Alertas 2TB');
await setVal('#i-price', '');
await submit('#item-form');
await sleep(300);
await b.ev(`document.querySelector('[data-form="alert"] input[name="target"]').value = '350'; document.querySelector('[data-form="alert"] input[name="drop"]').value = '10'; document.querySelector('[data-form="alert"]').requestSubmit()`);
await sleep(300);
const rec = async (price, date) => {
  await b.ev(`{ const f = document.querySelector('[data-form="record"]'); f.elements.price.value = ${JSON.stringify(price)}; f.elements.date.value = ${JSON.stringify(date)}; f.requestSubmit(); }`);
  await sleep(300);
};
const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
await rec('400,00', d(3));
await rec('365', d(2)); // 8.75% below the highest: under the 10% rule
c((await count('#alert-log li.unread')) === 0, 'no alert while the price is above the rules');
await rec('340,00', d(0)); // 15% below the highest and under the 350 target
const logText = await text('#alert-log');
c(/reached your target/.test(logText) && /below the highest price you recorded/.test(logText), 'recording a price below the rules raises both alerts');
const itemText = await text('#item-list');
c(/Lowest/i.test(itemText) && /Highest/i.test(itemText) && /Average/i.test(itemText) && /Latest/i.test(itemText) && /Trend/i.test(itemText) && /down/.test(itemText) && /3 prices/.test(itemText), 'history shows latest, lowest, highest, average, trend and count');
c((await count('#item-list svg.sparkline')) === 1, 'a chart is drawn only from the recorded prices');
const unreadBefore = await count('#alert-log li.unread');
await click('#alert-log [data-action="alert-read"]');
await sleep(200);
c(unreadBefore >= 2 && (await count('#alert-log li.unread')) === unreadBefore - 1, `alerts can be marked read (${unreadBefore} -> ${unreadBefore - 1})`);

// 5. US comparison.
await b.ev(`document.querySelector('[data-form="us"]').closest('details').open = true`);
await b.ev(`{ const f = document.querySelector('[data-form="us"]'); f.elements.priceUsd.value = '100'; f.elements.shippingUsd.value = '20'; f.elements.dutyPercent.value = '60'; f.elements.taxPercent.value = '17'; f.elements.otherBrl.value = '10'; f.elements.rate.value = '5'; f.requestSubmit(); }`);
await sleep(300);
const us = await text('[data-us-result]');
c(/1\.133,20/.test(us) && /Import duty \(60%, your input\)/.test(us) && /only from the values you entered/.test(us), 'US estimate is exact and built only from the entered inputs (R$ 1.133,20)');
c(/Brazilian price .*340,00.* is .*below/.test(us), 'comparison against the Brazilian price is stated');
await b.ev(`{ const f = document.querySelector('[data-form="us"]'); f.elements.dutyPercent.value = ''; f.elements.taxPercent.value = ''; f.requestSubmit(); }`);
await sleep(300);
c(/not the final cost of importing/.test(await text('[data-us-result]')) && /import duty, tax/.test(await text('[data-us-result]')), 'missing duty and tax are named and the result is not presented as a final cost');
await b.ev(`document.querySelector('[data-form="us"]').closest('details').open = true; document.querySelector('[data-action="use-fx"]').click()`);
await sleep(4000);
const rate = await b.ev(`document.querySelector('[data-form="us"] input[name="rate"]').value`);
c(Number(rate) > 3 && Number(rate) < 12, `"Use today's BCB rate" fills a plausible BRL/USD rate (${rate})`);
c(/BCB end-of-day USD sell rate for \d{4}-\d{2}-\d{2}/.test(await text('[data-us-result]')), 'the exchange rate source and date are shown');

// 6. Coupons.
const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
for (const [code, exp] of [['PROMO10', future], ['OLD5', past]]) {
  await setVal('#c-store', 'Loja X');
  await setVal('#c-code', code);
  await setVal('#c-exp', exp);
  await setVal('#c-min', 'R$ 1.200,50');
  await submit('#coupon-form');
  await sleep(250);
}
const coupons = await text('#coupon-list');
c(/Valid until .* days left, as entered/.test(coupons) && /Expired on/.test(coupons), 'coupons show valid and expired states');
c((coupons.match(/Unverified/g) || []).length === 2 && /cannot check whether this code works/.test(coupons), 'coupons stay unverified and say Calendra cannot check them');
c(/1\.200,50/.test(coupons) && (await count('#coupon-list [data-copy]')) === 2, 'minimum purchase is formatted and codes can be copied');

// 7. Persistence and layout.
await b.visit(`${base}/deals.html`, { width: 1366, height: 900, wait: 5000 });
c((await count('#item-list .deal-item')) === 2 && (await count('#coupon-list .deal-item')) === 2 && (await count('#thread-list .thread')) >= 1, 'products, coupons and saved threads survive a reload');
c(/3 prices/.test(await text('#item-list')) && (await count('#alert-log li')) >= 2, 'price history and alerts survive a reload');
if (shotDir) await b.shot(path.join(shotDir, 'deals-1366.png'));
for (const [w, h] of [[390, 844], [1920, 1080]]) {
  await b.visit(`${base}/deals.html`, { width: w, height: h, wait: 5000 });
  c((await b.ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0, `deals @${w}: no sideways overflow`);
  if (shotDir) await b.shot(path.join(shotDir, `deals-${w}.png`));
}
const errs = b.problems({ ignore: IGNORE });
c(errs.length === 0, `no uncaught errors${errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''}`);

b.close();
console.log(t.failed ? `\n${t.failed} check(s) FAILED` : '\nAll deals checks passed');
process.exit(t.failed ? 1 : 0);
