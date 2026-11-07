// Run with: node --test tests/deals.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCircuitBreaker } from '../js/core/http.js';
import { DEAL_FEEDS } from '../js/deals/feeds.js';
import {
  PROVIDERS,
  fallbackQuery,
  googleSearchUrl,
  helperQueries,
  integratedProviders,
  unavailableProviders,
} from '../js/deals/providers.js';
import { ageLabel, dedupeThreads, filterThreads, loadForumThreads, parseBrlPrices, parseThreads } from '../js/deals/forum.js';
import {
  addAlertLog,
  addToList,
  compareUs,
  couponStatus,
  emptyState,
  evaluateAlerts,
  loadDeals,
  newCoupon,
  newItem,
  parseMoneyInput,
  priceStats,
  recordPrice,
  saveDeals,
} from '../js/deals/model.js';
import { formatMoney, formatPercent, timeAgo } from '../js/core/format.js';

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const NOW = Date.parse('2026-11-07T15:00:00Z');

// --- sources are honest ------------------------------------------------------------

test('all requested sources are listed; only the official feed is marked integrated', () => {
  const names = PROVIDERS.map((p) => p.name);
  for (const wanted of ['Gatry', 'Pelando', 'Méliuz', 'Buscapé', 'Zoom', 'PCPartPicker', 'Amazon Brasil', 'Shopee', 'AliExpress', 'Google Shopping', 'Mercado Livre', 'Hardmob Classificados', 'Hardmob Promoções', 'Adrenaline Ofertas']) {
    assert.ok(names.includes(wanted), wanted);
  }
  assert.deepEqual(integratedProviders().map((p) => p.id), ['adrenaline-ofertas']);
  assert.equal(DEAL_FEEDS[0].id, 'adrenaline-ofertas');
  for (const p of unavailableProviders()) {
    assert.ok(p.reason && p.reason.length > 20, `${p.id} explains why automated access is unavailable`);
    assert.ok(p.homepage.startsWith('https://'), `${p.id} keeps a direct link`);
    assert.ok(!/scrap|bypass this|user.?agent/i.test(p.reason) || /not (scraped|bypass)|does not bypass|not accessed/i.test(p.reason), `${p.id} reason does not suggest a workaround`);
  }
});

test('search fallbacks are ready-made Google queries, clearly just links', () => {
  const ml = PROVIDERS.find((p) => p.id === 'mercadolivre');
  assert.equal(fallbackQuery(ml, 'monitor 27'), 'site:mercadolivre.com.br monitor 27');
  assert.equal(fallbackQuery(PROVIDERS.find((p) => p.id === 'google-shopping'), 'monitor'), 'monitor');
  assert.equal(googleSearchUrl('site:amazon.com.br monitor 27"'), 'https://www.google.com/search?q=site%3Aamazon.com.br%20monitor%2027%22');
  assert.equal(helperQueries('').length, 0);
  assert.ok(helperQueries('ssd 1tb').some((q) => /histórico de preço/.test(q.query)));
  for (const p of PROVIDERS) assert.ok(!fallbackQuery(p, 'x y').includes('undefined'));
});

// --- forum feed ----------------------------------------------------------------------

const FEED = `<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>[Amazon] SSD Kingston 1TB por R$ 349,90</title><pubDate>Sat, 07 Nov 2026 14:00:00 +0000</pubDate><link>https://forum.adrenaline.com.br/threads/ssd-kingston.1/</link><dc:creator>joao</dc:creator><category><![CDATA[OFERTAS]]></category>
<content:encoded><![CDATA[<div class="bbWrapper">Menor preço do ano.<br/> Frete grátis Prime. ${'texto longo '.repeat(60)}</div>]]></content:encoded></item>
<item><title>Kaspersky - Cupom</title><pubDate>Fri, 06 Nov 2026 20:39:30 +0000</pubDate><link>https://forum.adrenaline.com.br/threads/kaspersky.2/</link><dc:creator>allbass</dc:creator>
<content:encoded><![CDATA[Standard: 1 dispositivo R$ 12,95 / 3 dispositivos R$ 17,95]]></content:encoded></item>
<item><title>Monitor LG 27 [EXPIRADO]</title><pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate><link>https://forum.adrenaline.com.br/threads/monitor-lg.3/</link></item>
<item><title>[amazon] ssd kingston 1tb por R$ 349,90</title><pubDate>Sat, 07 Nov 2026 14:30:00 +0000</pubDate><link>https://forum.adrenaline.com.br/threads/ssd-kingston-2/</link></item>
<item><title></title><link>https://forum.adrenaline.com.br/threads/empty/</link></item>
</channel></rss>`;

test('parseBrlPrices reads only explicit R$ amounts', () => {
  assert.deepEqual(parseBrlPrices('de R$ 1.299,90 por R$ 999'), [1299.9, 999]);
  assert.deepEqual(parseBrlPrices('R$12,95 e R$ 17'), [12.95, 17]);
  assert.deepEqual(parseBrlPrices('custa 349,90 reais'), [], 'no R$ sign, no price');
  assert.deepEqual(parseBrlPrices(''), []);
});

test('parseThreads keeps metadata and a short excerpt, never the full post', () => {
  const threads = parseThreads(FEED, { now: NOW });
  assert.equal(threads.length, 4, 'the empty-title item is dropped');
  const t = threads[0];
  assert.equal(t.author, 'joao');
  assert.equal(t.category, 'OFERTAS');
  assert.equal(t.price, 349.9);
  assert.equal(t.priceSource, 'title');
  assert.equal(t.currency, 'BRL');
  assert.ok(t.excerpt.length <= 200);
  assert.ok(!('body' in t) && !('content' in t));
  assert.equal(threads[1].price, 12.95);
  assert.equal(threads[1].priceSource, 'excerpt');
  assert.equal(threads[2].price, undefined, 'no price is invented');
  assert.equal(threads[2].possiblyExpired, true);
  assert.equal(threads[0].possiblyExpired, false);
});

test('dedupeThreads merges repeated titles and keeps the newest', () => {
  const out = dedupeThreads(parseThreads(FEED, { now: NOW }));
  assert.equal(out.length, 3);
  const ssd = out.find((t) => /ssd/i.test(t.title));
  assert.equal(ssd.url, 'https://forum.adrenaline.com.br/threads/ssd-kingston-2/');
});

test('ageLabel is honest about missing dates', () => {
  assert.equal(ageLabel(undefined, NOW), 'age unknown');
  assert.equal(ageLabel('2026-11-07T14:30:00Z', NOW), 'under 1 hour old');
  assert.equal(ageLabel('2026-11-07T10:00:00Z', NOW), '5 hours old');
  assert.equal(ageLabel('2026-11-02T10:00:00Z', NOW), '5 days old');
});

test('filterThreads: keywords, exclusions, price range, age, hidden and saved', () => {
  const list = dedupeThreads(parseThreads(FEED, { now: NOW }));
  const ids = (l) => l.map((t) => t.title);
  assert.equal(filterThreads(list, { q: 'ssd', now: NOW }).length, 1);
  assert.equal(filterThreads(list, { q: 'ssd kingston terabyte', now: NOW }).length, 0, 'all words must match');
  assert.equal(filterThreads(list, { exclude: ['kaspersky'], now: NOW }).length, 2);
  assert.equal(filterThreads(list, { maxPrice: 100, now: NOW }).length, 1, 'only threads with a stated price are priced');
  assert.equal(filterThreads(list, { minPrice: 300, now: NOW }).length, 1);
  assert.equal(filterThreads(list, { sinceHours: 24, now: NOW }).length, 2);
  const hidden = list[0].id;
  assert.ok(!filterThreads(list, { hiddenIds: [hidden], now: NOW }).some((t) => t.id === hidden));
  assert.ok(filterThreads(list, { hiddenIds: [hidden], showHidden: true, now: NOW }).some((t) => t.id === hidden));
  assert.equal(filterThreads(list, { savedOnly: true, savedIds: [list[1].id], now: NOW }).length, 1);
  assert.equal(ids(filterThreads(list, {})).length, 3);
});

test('loadForumThreads (proxy or rss2json), surfaces failures and parses a good feed', async () => {
  const base = { retries: 0, sleep: async () => {}, breaker: createCircuitBreaker({ threshold: 99 }) };
  const viaJson = await loadForumThreads({ proxyUrl: '', now: NOW, fetchOpts: { ...base, fetchImpl: async (url) => { assert.ok(url.startsWith('https://api.rss2json.com/')); return { ok: true, json: async () => ({ status: 'ok', items: [{ title: 'Fone R$ 99,90 na loja', link: 'https://f.test/t/1', pubDate: '2026-11-07 12:00:00', description: 'x' }] }) }; } } });
  assert.equal(viaJson.length, 1);
  assert.equal(viaJson[0].price, 99.9);
  await assert.rejects(loadForumThreads({ proxyUrl: '', fetchOpts: { ...base, fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'error', message: 'throttled' }) }) } }), /throttled/);
  const ok = await loadForumThreads({ proxyUrl: 'http://p.test', now: NOW, fetchOpts: { ...base, fetchImpl: async (url) => { assert.ok(url.includes('source=adrenaline-ofertas')); return { ok: true, text: async () => FEED }; } } });
  assert.equal(ok.length, 3);
  await assert.rejects(loadForumThreads({ proxyUrl: 'http://p.test', fetchOpts: { ...base, fetchImpl: async () => ({ ok: false, status: 502, headers: { get: () => null } }) } }), /HTTP 502/);
  await assert.rejects(loadForumThreads({ proxyUrl: 'http://p.test', fetchOpts: { ...base, fetchImpl: async () => ({ ok: true, text: async () => '<rss></rss>' }) } }), /no readable threads/);
});

// --- money input -----------------------------------------------------------------------

test('parseMoneyInput handles Brazilian and US formats and rejects junk', () => {
  assert.equal(parseMoneyInput('1.299,90'), 1299.9);
  assert.equal(parseMoneyInput('R$ 1.299,90'), 1299.9);
  assert.equal(parseMoneyInput('1299,90'), 1299.9);
  assert.equal(parseMoneyInput('1299.90'), 1299.9);
  assert.equal(parseMoneyInput('1,299.90'), 1299.9);
  assert.equal(parseMoneyInput('1.299'), 1299);
  assert.equal(parseMoneyInput('349,9'), 349.9);
  assert.equal(parseMoneyInput('12'), 12);
  assert.equal(parseMoneyInput('0'), 0);
  assert.equal(parseMoneyInput(''), null);
  assert.equal(parseMoneyInput('abc'), null);
  assert.equal(parseMoneyInput('-5'), null);
});

test('formatting: money keeps the currency explicit and never shows 0 for missing values', () => {
  assert.match(formatMoney(1299.9, 'BRL'), /R\$\s?1\.299,90/);
  assert.match(formatMoney(12.5, 'USD', 'en-US'), /\$12\.50/);
  assert.equal(formatMoney(null), '—');
  assert.equal(formatMoney(undefined), '—');
  assert.equal(formatMoney('abc'), '—');
  assert.equal(formatPercent(1.5), '+1.50%');
  assert.equal(formatPercent(-0.4), '-0.40%');
  assert.equal(formatPercent(null), '—');
  assert.equal(timeAgo('2026-11-07T14:42:00Z', NOW), '18 minutes ago');
  assert.equal(timeAgo(undefined, NOW), '—');
});

// --- saved products, price history, alerts -----------------------------------------------

test('items validate input and never keep unsafe links', () => {
  assert.equal(newItem({ title: '   ' }), null);
  const item = newItem({ title: 'Monitor LG 27', url: 'javascript:alert(1)', country: 'xx', condition: 'weird' });
  assert.equal(item.url, '');
  assert.equal(item.country, 'BR');
  assert.equal(item.condition, 'new');
  assert.deepEqual(item.observations, []);
  assert.equal(newItem({ title: 'x', url: 'https://shop.test/a' }).url, 'https://shop.test/a');
});

test('price history only contains prices you entered; same-day entries replace', () => {
  let item = newItem({ title: 'SSD' });
  assert.equal(priceStats(item.observations), null, 'no history is invented');
  item = recordPrice(item, 400, '2026-11-01');
  const one = priceStats(item.observations);
  assert.equal(one.trend, null, 'one point has no trend');
  assert.equal(one.lastDrop, null);
  item = recordPrice(item, 380, '2026-11-03');
  item = recordPrice(item, 420, '2026-11-05');
  item = recordPrice(item, 360, '2026-11-07');
  item = recordPrice(item, 355, '2026-11-07');
  assert.equal(item.observations.length, 4);
  const s = priceStats(item.observations);
  assert.equal(s.current, 355);
  assert.equal(s.lowest, 355);
  assert.equal(s.highest, 420);
  assert.equal(s.average, (400 + 380 + 420 + 355) / 4);
  assert.equal(s.trend, 'down');
  assert.equal(s.lastDrop.from, 420);
  assert.equal(s.lastDrop.date, '2026-11-07');
  assert.ok(Math.abs(s.lastDrop.percent - ((420 - 355) / 420) * 100) < 1e-9);
  assert.match(s.origin, /entered by you/);
  assert.equal(recordPrice(item, 'abc').observations.length, 4);
  assert.equal(recordPrice(item, -3).observations.length, 4);
});

test('alerts: target price and percentage drop fire only when their condition is met', () => {
  let item = newItem({ title: 'SSD 1TB' });
  item = { ...item, alert: { targetPrice: 350, dropPercent: 10 } };
  item = recordPrice(item, 400, '2026-11-01');
  assert.deepEqual(evaluateAlerts(item, 400, []), [], 'no alert at the first price');
  const before = item.observations;
  item = recordPrice(item, 365, '2026-11-03');
  assert.deepEqual(evaluateAlerts(item, 365, before), [], '8.75% below the highest is under the 10% threshold');
  const prev2 = item.observations;
  item = recordPrice(item, 345, '2026-11-05');
  const fired = evaluateAlerts(item, 345, prev2);
  assert.deepEqual(fired.map((m) => m.kind).sort(), ['drop', 'target']);
  assert.match(fired.find((m) => m.kind === 'target').text, /reached your target/);
  assert.equal(evaluateAlerts({ ...item, alert: { targetPrice: null, dropPercent: null } }, 1, prev2).length, 0);
});

test('alert log is capped and starts unread', () => {
  let state = emptyState();
  state = addAlertLog(state, [{ kind: 'target', text: 'A' }], new Date(NOW));
  assert.equal(state.alerts[0].read, false);
  for (let i = 0; i < 150; i += 1) state = addAlertLog(state, [{ kind: 'target', text: 'x' + i }], new Date(NOW + i));
  assert.equal(state.alerts.length, 100);
});

// --- coupons --------------------------------------------------------------------------------

test('coupons: required fields, expiry states, and never a claim that a code works', () => {
  assert.equal(newCoupon({ store: '', code: 'X' }), null);
  assert.equal(newCoupon({ store: 'Loja', code: '' }), null);
  const c = newCoupon({ store: 'Loja', code: 'PROMO10', minPurchase: 'R$ 1.200,50', expiresOn: '2026-11-10', url: 'ftp://x' }, new Date(NOW));
  assert.equal(c.minPurchase, 1200.5);
  assert.equal(c.url, '');
  assert.equal(c.verification, 'unverified');
  assert.equal(c.source, 'manual entry');
  assert.equal(couponStatus(c, '2026-11-07').state, 'valid');
  assert.match(couponStatus(c, '2026-11-07').label, /3 days left, as entered/);
  assert.equal(couponStatus(c, '2026-11-10').state, 'expires-today');
  assert.equal(couponStatus(c, '2026-11-11').state, 'expired');
  assert.equal(couponStatus({ expiresOn: '' }).state, 'no-expiry');
  assert.equal(newCoupon({ store: 'L', code: 'C', expiresOn: 'soon' }).expiresOn, '');
});

// --- US comparison -----------------------------------------------------------------------------

test('US comparison: arithmetic is exact and only includes what you entered', () => {
  const full = compareUs({ priceUsd: 100, shippingUsd: 20, dutyPercent: 60, taxPercent: 17, otherBrl: 10, rate: 5, brPrice: 1500 });
  // product 500, shipping 100 => base 600; duty 360; tax (600+360)*17% = 163.2; other 10
  assert.equal(full.components.find((c) => c.label === 'Product').brl, 500);
  assert.equal(full.components.find((c) => /Shipping/.test(c.label)).brl, 100);
  assert.ok(Math.abs(full.total - (600 + 360 + 163.2 + 10)) < 1e-9);
  assert.equal(full.complete, true);
  assert.ok(Math.abs(full.versus.differenceBrl - (1500 - 1133.2)) < 1e-9);
  assert.ok(full.versus.percent > 0);
  assert.match(full.note, /only from the values you entered/);
});

test('US comparison: missing inputs are named and the result says it is not a final cost', () => {
  const partial = compareUs({ priceUsd: 100, rate: 5 });
  assert.equal(partial.total, 500);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, ['shipping', 'import duty', 'tax']);
  assert.match(partial.note, /not the final cost of importing/);
  assert.equal(partial.versus, undefined, 'no BR price, no comparison');
  const none = compareUs({ priceUsd: '', rate: 0 });
  assert.equal(none.total, null);
  assert.deepEqual(none.missing, ['US price', 'exchange rate']);
  assert.equal(compareUs({ priceUsd: 10, rate: 5, dutyPercent: 0, taxPercent: 0, shippingUsd: 0 }).complete, true, 'zero is an entered value');
});

test('US alert: Brazilian price at or below the US estimate fires', () => {
  let item = newItem({ title: 'Headset' });
  item = { ...item, us: { priceUsd: 100, shippingUsd: 0, dutyPercent: 0, taxPercent: 0, rate: 5 } };
  assert.equal(evaluateAlerts(item, 600, []).length, 0);
  assert.equal(evaluateAlerts(item, 480, []).filter((m) => m.kind === 'below-us').length, 1);
});

// --- storage -------------------------------------------------------------------------------------

test('state persists, tolerates junk and caps lists', () => {
  const s = memoryStorage();
  assert.deepEqual(loadDeals(s), emptyState());
  const state = { ...emptyState(), items: [newItem({ title: 'A' })], recentSearches: ['x'] };
  saveDeals(state, s);
  assert.equal(loadDeals(s).items.length, 1);
  s.setItem('calendra.deals.v1', JSON.stringify({ items: 'not an array', coupons: null }));
  assert.deepEqual(loadDeals(s).items, []);
  let list = [];
  for (let i = 0; i < 20; i += 1) list = addToList(list, `q${i}`);
  assert.equal(list.length, 12);
  assert.equal(list[0], 'q19');
  assert.deepEqual(addToList(['a', 'b'], 'b'), ['b', 'a'], 'repeated search moves to the front');
  assert.deepEqual(addToList(['a'], '  '), ['a']);
});
