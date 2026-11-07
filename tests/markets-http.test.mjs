// Run with: node --test tests/markets-http.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HttpError, createCircuitBreaker, fetchJson, parseRetryAfter } from '../js/core/http.js';
import { cacheGet, cacheSet } from '../js/core/cache.js';
import {
  BRAPI_KEYLESS,
  bcbSelicUrl,
  brDateToIso,
  createBrapiProvider,
  fetchPolicyRates,
  parseBcbSelicTarget,
  parseBrapiHistory,
  parseBrapiQuotes,
  parseEcbRate,
  parseNyFedEffr,
  periodReturn,
  splitByAvailability,
} from '../js/markets/providers.js';

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

const noSleep = async () => {};
const freshBreaker = () => createCircuitBreaker({ threshold: 99 });

// Captured from the live APIs (shapes trimmed).
const BCB_ROWS = [
  { data: '05/11/2026', valor: '13.75' },
  { data: '06/11/2026', valor: '13.75' },
  { data: '06/12/2026', valor: '14.00' }, // future-dated row the API can return
];
const ECB_DFR = {
  dataSets: [{ series: { '0:0:0:0:0:0:0': { observations: { 0: [2.25, 0], 1: [2.5, 0] } } } }],
  structure: { dimensions: { observation: [{ values: [{ id: '2026-06-17' }, { id: '2026-09-16' }] }] } },
};
const NYFED = {
  refRates: [{ effectiveDate: '2026-11-05', type: 'EFFR', percentRate: 3.88, targetRateFrom: 3.75, targetRateTo: 4.0 }],
};

// --- http ---------------------------------------------------------------------

test('parseRetryAfter handles seconds, dates and junk', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('', 0), 0);
  assert.equal(parseRetryAfter('garbage'), 0);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
});

test('fetchJson retries 429/5xx with backoff, then succeeds', async () => {
  const sleeps = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => '2' } };
    if (calls === 2) return { ok: false, status: 503, headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => ({ hello: 'world' }) };
  };
  const out = await fetchJson('https://example.test/x', {
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    breaker: freshBreaker(),
  });
  assert.deepEqual(out, { hello: 'world' });
  assert.equal(calls, 3);
  assert.equal(sleeps[0], 2000, 'honours Retry-After');
  assert.equal(sleeps[1], 1000, 'exponential backoff');
});

test('fetchJson does not retry other 4xx errors', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 401, headers: { get: () => null } };
  };
  await assert.rejects(
    fetchJson('https://example.test/x', { fetchImpl, sleep: noSleep, breaker: freshBreaker() }),
    (e) => e instanceof HttpError && e.status === 401
  );
  assert.equal(calls, 1);
});

test('fetchJson times out and can be cancelled', async () => {
  const hang = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
  await assert.rejects(
    fetchJson('https://example.test/x', { fetchImpl: hang, timeoutMs: 20, retries: 0, breaker: freshBreaker() }),
    /Timed out/
  );
  const controller = new AbortController();
  const p = fetchJson('https://example.test/y', { fetchImpl: hang, timeoutMs: 5000, retries: 0, signal: controller.signal, breaker: freshBreaker() });
  controller.abort();
  await assert.rejects(p, /Cancelled/);
});

test('circuit breaker opens after repeated failures and pauses calls', async () => {
  let t = 0;
  const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 500, headers: { get: () => null } };
  };
  const opts = { fetchImpl, sleep: noSleep, retries: 0, breaker };
  await assert.rejects(fetchJson('https://down.test/a', opts));
  await assert.rejects(fetchJson('https://down.test/a', opts));
  await assert.rejects(fetchJson('https://down.test/a', opts), /paused/);
  assert.equal(calls, 2, 'third call is short-circuited');
  t = 2000;
  await assert.rejects(fetchJson('https://down.test/a', opts), /HTTP 500/);
  assert.equal(calls, 3, 'allowed again after cooldown');
});

// --- cache --------------------------------------------------------------------

test('cache marks entries stale after maxAge and keeps the value', () => {
  const s = memoryStorage();
  cacheSet('k', { a: 1 }, { storage: s, now: 1_000_000 });
  const fresh = cacheGet('k', { maxAgeMs: 5000, storage: s, now: 1_003_000 });
  assert.equal(fresh.stale, false);
  const old = cacheGet('k', { maxAgeMs: 5000, storage: s, now: 1_010_000 });
  assert.equal(old.stale, true);
  assert.deepEqual(old.value, { a: 1 });
  assert.equal(cacheGet('missing', { storage: s }), null);
});

// --- parsers ------------------------------------------------------------------

test("bcbSelicUrl asks for an explicit window ending today (ultimos/N is capped at 20)", () => {
  const url = bcbSelicUrl(new Date(2026, 10, 7)); // 7 Nov 2026
  assert.ok(url.includes("dataFinal=07/11/2026"));
  assert.ok(url.includes("dataInicial=23/09/2026"));
  assert.ok(!url.includes("ultimos"));
});

test('brDateToIso', () => {
  assert.equal(brDateToIso('09/12/2026'), '2026-12-09');
  assert.equal(brDateToIso('2026-12-09'), null);
});

test('Selic: ignores future-dated rows and labels the value as a policy target', () => {
  const r = parseBcbSelicTarget(BCB_ROWS, '2026-11-07');
  assert.equal(r.value, 13.75);
  assert.equal(r.effectiveDate, '2026-11-06');
  assert.equal(r.kind, 'policy-target');
  assert.match(r.rateType, /not the overnight effective rate/);
  assert.match(r.unit, /annualized/);
  assert.equal(parseBcbSelicTarget([{ data: '06/12/2026', valor: '14' }], '2026-11-07'), null);
  assert.equal(parseBcbSelicTarget(null), null);
});

test('ECB: takes the latest observation and its change date; deposit is primary', () => {
  const r = parseEcbRate(ECB_DFR, { id: 'ecb-deposit', label: 'Deposit facility rate', primary: true });
  assert.equal(r.value, 2.5);
  assert.equal(r.effectiveDate, '2026-09-16');
  assert.match(r.rateType, /deposit facility/);
  assert.equal(parseEcbRate({}, { id: 'x', label: 'x' }), null);
});

test('NY Fed: policy target range and effective rate are separate, labelled items', () => {
  const { fedTarget, effr } = parseNyFedEffr(NYFED);
  assert.equal(fedTarget.display, '3.75%–4.00%');
  assert.equal(fedTarget.kind, 'policy-target-range');
  assert.equal(effr.value, 3.88);
  assert.equal(effr.kind, 'effective-overnight');
  assert.notEqual(fedTarget.kind, effr.kind);
  assert.deepEqual(parseNyFedEffr({}), { fedTarget: null, effr: null });
});

test('brapi quotes: only complete rows, marked delayed, nothing invented', () => {
  const q = parseBrapiQuotes({
    results: [
      { symbol: 'PETR4', longName: 'Petroleo', currency: 'BRL', regularMarketPrice: 45.3, regularMarketChange: -0.65, regularMarketChangePercent: -1.41, regularMarketTime: '2026-11-07T07:08:28.000Z' },
      { symbol: 'BAD', regularMarketPrice: null },
    ],
  });
  assert.equal(q.length, 1);
  assert.equal(q[0].delayed, true);
  assert.equal(q[0].exchange, 'B3');
  assert.equal(q[0].marketCap, null);
});

test('brapi history + period return use real points and say whether adjusted', () => {
  const pts = parseBrapiHistory({
    results: [{ historicalDataPrice: [
      { date: 1791428400, close: 50, adjustedClose: 48 },
      { date: 1791514800, close: 55, adjustedClose: 54 },
    ] }],
  });
  assert.equal(pts.length, 2);
  const adj = periodReturn(pts);
  assert.equal(adj.adjusted, true);
  assert.ok(Math.abs(adj.percent - 12.5) < 1e-9);
  const raw = periodReturn(pts, { useAdjusted: false });
  assert.ok(Math.abs(raw.percent - 10) < 1e-9);
  assert.equal(periodReturn(pts.slice(0, 1)), null);
  assert.deepEqual(parseBrapiHistory({}), []);
});

test('keyless availability: tickers needing a token are reported, not fetched', () => {
  const s = splitByAvailability(['petr4', 'WEGE3', 'BBDC4', 'VALE3'], '');
  assert.deepEqual(s.available, ['PETR4', 'VALE3']);
  assert.deepEqual(s.needsToken, ['WEGE3', 'BBDC4']);
  assert.deepEqual(splitByAvailability(['WEGE3'], 'tok').needsToken, []);
  assert.ok(BRAPI_KEYLESS.includes('ITUB4'));
});

test('provider getQuotes never requests tickers that need a token', async () => {
  const urls = [];
  const provider = createBrapiProvider({
    fetchOpts: {
      breaker: freshBreaker(),
      fetchImpl: async (url) => {
        urls.push(url);
        return { ok: true, json: async () => ({ results: [{ symbol: 'PETR4', regularMarketPrice: 1 }] }) };
      },
    },
  });
  await provider.getQuotes(['PETR4', 'WEGE3']);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith('/PETR4'));
  assert.deepEqual(await provider.getQuotes(['WEGE3']), []);
  assert.equal(urls.length, 1);
});

// --- fetchPolicyRates ---------------------------------------------------------

function routeFetch(routes) {
  return async (url) => {
    for (const [needle, handler] of Object.entries(routes)) {
      if (url.includes(needle)) return handler();
    }
    return { ok: false, status: 404, headers: { get: () => null } };
  };
}
const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const fail500 = async () => ({ ok: false, status: 500, headers: { get: () => null } });

test('fetchPolicyRates returns all rates with source, effective date and fetch time', async () => {
  const s = memoryStorage();
  globalThis.localStorage = s;
  const res = await fetchPolicyRates({
    now: new Date('2026-11-07T10:00:00Z'),
    useCache: false,
    fetchOpts: {
      retries: 0,
      breaker: freshBreaker(),
      fetchImpl: routeFetch({
        'bcdata.sgs.432': okJson(BCB_ROWS),
        'newyorkfed': okJson(NYFED),
        'KR.DFR': okJson(ECB_DFR),
        'KR.MRR_FR': okJson(ECB_DFR),
        'KR.MLFR': okJson(ECB_DFR),
      }),
    },
  });
  const ids = res.rates.map((r) => r.id).sort();
  assert.deepEqual(ids, ['ecb-deposit', 'ecb-lending', 'ecb-refi', 'effr', 'fed-target', 'selic']);
  for (const r of res.rates) {
    assert.ok(r.source && r.effectiveDate && r.fetchedAt === '2026-11-07T10:00:00.000Z', r.id);
    assert.equal(r.stale, false);
  }
  assert.deepEqual(res.errors, {});
  delete globalThis.localStorage;
});

test('fetchPolicyRates: one source failing does not break the others, and cached values come back stale', async () => {
  const s = memoryStorage();
  globalThis.localStorage = s;
  const healthy = {
    'bcdata.sgs.432': okJson(BCB_ROWS),
    'newyorkfed': okJson(NYFED),
    'KR.DFR': okJson(ECB_DFR),
    'KR.MRR_FR': okJson(ECB_DFR),
    'KR.MLFR': okJson(ECB_DFR),
  };
  const base = { retries: 0, breaker: freshBreaker() };
  await fetchPolicyRates({ now: new Date('2026-11-07T10:00:00Z'), fetchOpts: { ...base, fetchImpl: routeFetch(healthy) } });

  const res = await fetchPolicyRates({
    now: new Date('2026-11-07T12:00:00Z'),
    useCache: true,
    fetchOpts: { ...base, fetchImpl: routeFetch({ ...healthy, newyorkfed: fail500 }) },
  });
  assert.ok(res.errors['fed-target'] && res.errors.effr, 'errors reported per source');
  const fed = res.rates.find((r) => r.id === 'fed-target');
  assert.equal(fed.stale, true, 'last-known-good value is labelled stale');
  assert.equal(res.rates.find((r) => r.id === 'selic').stale, false);

  const empty = memoryStorage();
  globalThis.localStorage = empty;
  const none = await fetchPolicyRates({ now: new Date(), fetchOpts: { ...base, fetchImpl: routeFetch({}) } });
  assert.equal(none.rates.length, 0, 'no data is shown when nothing loaded and nothing cached');
  assert.ok(none.errors.selic);
  delete globalThis.localStorage;
});

// --- Currencies and charts ------------------------------------------------------

import { bcbSeriesUrl, fetchFxRates, parseBcbDaily } from '../js/markets/providers.js';
import { sparklinePoints, sparklineSvg } from '../js/markets/chart.js';

test('parseBcbDaily ignores future rows and reports the day-over-day change', () => {
  const rows = [
    { data: '04/11/2026', valor: '5.4000' },
    { data: '05/11/2026', valor: '5.4621' },
    { data: '06/11/2026', valor: '5.5013' },
    { data: '09/12/2026', valor: '9.9999' },
  ];
  const r = parseBcbDaily(rows, '2026-11-07');
  assert.equal(r.value, 5.5013);
  assert.equal(r.date, '2026-11-06');
  assert.equal(r.previousDate, '2026-11-05');
  assert.ok(Math.abs(r.changePercent - ((5.5013 - 5.4621) / 5.4621) * 100) < 1e-9);
  assert.equal(parseBcbDaily([{ data: '09/12/2026', valor: '1' }], '2026-11-07'), null);
  assert.equal(parseBcbDaily({}, '2026-11-07'), null);
});

test('parseBcbDaily with one observation has no change (never invented)', () => {
  const r = parseBcbDaily([{ data: '06/11/2026', valor: '5.5' }], '2026-11-07');
  assert.equal(r.changePercent, null);
  assert.equal(r.previousValue, null);
});

test('bcbSeriesUrl builds an explicit window', () => {
  const url = bcbSeriesUrl(1, new Date(2026, 10, 7), 12);
  assert.ok(url.includes('bcdata.sgs.1/'));
  assert.ok(url.includes('dataInicial=26/10/2026') && url.includes('dataFinal=07/11/2026'));
});

test('fetchFxRates labels rates end-of-day and reports a failing series without breaking the other', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('sgs.1/')) return { ok: true, json: async () => [{ data: '06/11/2026', valor: '5.5013' }, { data: '05/11/2026', valor: '5.4621' }] };
    return { ok: false, status: 500, headers: { get: () => null } };
  };
  const res = await fetchFxRates({ now: new Date(2026, 10, 7), fetchOpts: { fetchImpl, retries: 0, breaker: freshBreaker(), sleep: noSleep } });
  assert.equal(res.rates.length, 1);
  assert.equal(res.rates[0].id, 'usdbrl');
  assert.equal(res.rates[0].kind, 'end-of-day');
  assert.ok(res.errors.eurbrl);
});

test('sparkline draws only real points', () => {
  assert.equal(sparklinePoints([]), '');
  assert.equal(sparklinePoints([5]), '');
  assert.equal(sparklinePoints([5, NaN, null]), '');
  const pts = sparklinePoints([1, 2, 3], 100, 20, 0).split(' ');
  assert.equal(pts.length, 3);
  assert.equal(pts[0], '0.0,20.0');
  assert.equal(pts[2], '100.0,0.0');
  assert.equal(sparklineSvg([1]), '');
  assert.match(sparklineSvg([1, 2], { label: 'X' }), /aria-label="X: up over the period"/);
  assert.match(sparklineSvg([2, 1]), /down/);
});
