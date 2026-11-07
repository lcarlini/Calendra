// Run with: node --test tests/news-proxy.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker, { LIMITS, allowedHosts, decodeBody, handleRequest, resetState, trimItems } from '../backend/news-proxy/worker.js';
import { SOURCES } from '../js/news/sources.js';

const ENV = { ALLOWED_ORIGINS: 'https://lcarlini.github.io,http://localhost:8080' };
const ORIGIN = 'https://lcarlini.github.io';

const rss = (n = 3, extra = '') =>
  `<?xml version="1.0"?><rss><channel><title>T</title>${Array.from({ length: n }, (_, i) => `<item><title>Item ${i}</title><link>https://x.test/${i}</link></item>`).join('\n')}${extra}</channel></rss>`;

function xmlResponse(body, headers = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8', ...headers } });
}

function req(path, { origin = ORIGIN, method = 'GET', ip } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (ip) headers['CF-Connecting-IP'] = ip;
  return new Request(`https://proxy.test${path}`, { method, headers });
}

beforeEach(() => resetState());

test('only fetches the registered feed for a source id (never an arbitrary URL)', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return xmlResponse(rss());
  };
  const res = await handleRequest(req('/feed?source=bbc-pt&url=https://evil.example/steal'), ENV, { fetchImpl });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['https://feeds.bbci.co.uk/portuguese/rss.xml']);
  const bad = await handleRequest(req('/feed?url=https://evil.example/'), ENV, { fetchImpl });
  assert.equal(bad.status, 404);
  assert.equal(seen.length, 1, 'no upstream call without a known source id');
});

test('unknown and unavailable sources are refused (globo has no feed)', async () => {
  const fetchImpl = async () => assert.fail('must not fetch');
  assert.equal((await handleRequest(req('/feed?source=nope'), ENV, { fetchImpl })).status, 404);
  assert.equal((await handleRequest(req('/feed?source=globo'), ENV, { fetchImpl })).status, 404);
});

test('every integrated source is reachable and the allowlist matches the registry', () => {
  const hosts = allowedHosts();
  for (const s of SOURCES.filter((x) => x.feed)) assert.ok(hosts.has(new URL(s.feed).hostname), s.id);
  assert.ok(hosts.has('admin.cnnbrasil.com.br'));
  assert.ok(!hosts.has('evil.example'));
});

test('deal-community feeds are served by id too (Adrenaline Ofertas), still never by URL', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return xmlResponse(rss());
  };
  const res = await handleRequest(req('/feed?source=adrenaline-ofertas'), ENV, { fetchImpl });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['https://forum.adrenaline.com.br/forums/ofertas.221/index.rss']);
  assert.ok(allowedHosts().has('forum.adrenaline.com.br'));
  const health = await (await handleRequest(req('/health'), ENV)).json();
  assert.ok(health.sources.includes('adrenaline-ofertas'));
  for (const refused of ['hardmob', 'pelando', 'mercadolivre', 'pcpartpicker']) {
    assert.equal((await handleRequest(req('/feed?source=' + refused), ENV, { fetchImpl })).status, 404, refused + ' is not proxied');
  }
});

test('CORS: allowed origin is echoed with Vary; other origins are refused; default is deny', async () => {
  const fetchImpl = async () => xmlResponse(rss());
  const ok = await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(ok.headers.get('Vary'), 'Origin');
  const bad = await handleRequest(req('/feed?source=uol', { origin: 'https://evil.example' }), ENV, { fetchImpl });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const unset = await handleRequest(req('/feed?source=uol'), {}, { fetchImpl });
  assert.equal(unset.status, 403);
  assert.match((await unset.json()).error, /not configured/);
});

test('preflight and method handling', async () => {
  const pre = await handleRequest(req('/feed?source=uol', { method: 'OPTIONS' }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await handleRequest(req('/feed?source=uol', { method: 'POST' }), ENV)).status, 405);
  assert.equal((await handleRequest(req('/elsewhere'), ENV)).status, 404);
});

test('health endpoint lists integrated source ids only', async () => {
  const body = await (await handleRequest(req('/health'), ENV)).json();
  assert.equal(body.ok, true);
  assert.ok(body.sources.includes('g1') && !body.sources.includes('globo'));
});

test('redirects are followed only to allowlisted https hosts', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://www.cnnbrasil.com.br/feed/') {
      return new Response(null, { status: 302, headers: { location: 'https://admin.cnnbrasil.com.br/feed/' } });
    }
    return xmlResponse(rss());
  };
  const ok = await handleRequest(req('/feed?source=cnn-brasil'), ENV, { fetchImpl });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, ['https://www.cnnbrasil.com.br/feed/', 'https://admin.cnnbrasil.com.br/feed/']);

  resetState();
  const evil = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } });
  const refused = await handleRequest(req('/feed?source=cnn-brasil'), ENV, { fetchImpl: evil });
  assert.equal(refused.status, 502);
  assert.match((await refused.json()).error, /not allowed/);

  resetState();
  const http = async () => new Response(null, { status: 302, headers: { location: 'http://admin.cnnbrasil.com.br/feed/' } });
  assert.equal((await handleRequest(req('/feed?source=cnn-brasil'), ENV, { fetchImpl: http })).status, 502, 'https only');

  resetState();
  const loop = async () => new Response(null, { status: 302, headers: { location: 'https://admin.cnnbrasil.com.br/feed/' } });
  assert.equal((await handleRequest(req('/feed?source=cnn-brasil'), ENV, { fetchImpl: loop })).status, 502, 'redirect loop is cut');
});

test('non-XML, oversize and failing upstreams are rejected with clear errors', async () => {
  const html = async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  assert.equal((await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl: html })).status, 502);
  resetState();
  const big = async () => xmlResponse('x', { 'content-length': String(LIMITS.maxBytes + 1) });
  assert.equal((await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl: big })).status, 502);
  resetState();
  const down = async () => new Response('no', { status: 503 });
  const r = await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl: down });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /HTTP 503/);
  resetState();
  const boom = async () => {
    throw new Error('ECONNRESET');
  };
  assert.equal((await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl: boom })).status, 502);
});

test('upstream timeout becomes 504', async () => {
  const slow = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  const original = LIMITS.timeoutMs;
  LIMITS.timeoutMs = 20;
  try {
    const res = await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl: slow });
    assert.equal(res.status, 504);
  } finally {
    LIMITS.timeoutMs = original;
  }
});

test('ISO-8859-1 feeds (UOL) are decoded and served as UTF-8', async () => {
  const latin1 = Uint8Array.from(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Justiça e decisão</title><link>https://x.test/1</link></item></channel></rss>', 'latin1'));
  const fetchImpl = async () => new Response(latin1, { status: 200, headers: { 'content-type': 'text/xml;charset=ISO-8859-1' } });
  const res = await handleRequest(req('/feed?source=uol'), ENV, { fetchImpl });
  assert.match(res.headers.get('content-type'), /utf-8/i);
  assert.match(await res.text(), /Justiça e decisão/);
  // Prolog-only declaration (no charset in the header) is honoured too.
  assert.match(decodeBody(latin1, 'text/xml'), /Justiça e decisão/);
});

test('large feeds are trimmed to the newest items (default 40, caller limit capped at 100)', async () => {
  const fetchImpl = async () => xmlResponse(rss(300));
  const dflt = await (await handleRequest(req('/feed?source=g1'), ENV, { fetchImpl })).text();
  assert.equal((dflt.match(/<item>/g) || []).length, LIMITS.defaultItems);
  assert.ok(dflt.includes('<title>T</title>'), 'channel header kept');
  assert.ok(dflt.includes('Item 0') && !dflt.includes('Item 40<'), 'keeps the first (newest) items');
  const capped = await (await handleRequest(req('/feed?source=g1&limit=9999'), ENV, { fetchImpl })).text();
  assert.equal((capped.match(/<item>/g) || []).length, LIMITS.maxItems);
  assert.equal((trimItems(rss(3), 10).match(/<item>/g) || []).length, 3);
});

test('responses are cached briefly: second call does not hit the publisher', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return xmlResponse(rss());
  };
  const a = await handleRequest(req('/feed?source=bbc-pt'), ENV, { fetchImpl, now: 1_000_000 });
  const b = await handleRequest(req('/feed?source=bbc-pt'), ENV, { fetchImpl, now: 1_000_000 + 60_000 });
  assert.equal(calls, 1);
  assert.equal(a.headers.get('X-Proxy-Cache'), 'MISS');
  assert.equal(b.headers.get('X-Proxy-Cache'), 'HIT');
  await handleRequest(req('/feed?source=bbc-pt'), ENV, { fetchImpl, now: 1_000_000 + LIMITS.cacheMs + 1 });
  assert.equal(calls, 2, 'refetched after the cache window');
});

test('rate limit: a client above the per-minute budget gets 429 with Retry-After; others are unaffected', async () => {
  const fetchImpl = async () => xmlResponse(rss());
  let last;
  for (let i = 0; i < LIMITS.ratePerMinute + 1; i += 1) {
    last = await handleRequest(req('/feed?source=uol', { ip: '1.1.1.1' }), ENV, { fetchImpl, now: 5_000 });
  }
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('Retry-After'), '60');
  const other = await handleRequest(req('/feed?source=uol', { ip: '2.2.2.2' }), ENV, { fetchImpl, now: 5_000 });
  assert.equal(other.status, 200);
  const later = await handleRequest(req('/feed?source=uol', { ip: '1.1.1.1' }), ENV, { fetchImpl, now: 5_000 + 61_000 });
  assert.equal(later.status, 200, 'window resets');
});

test('default export works as a Cloudflare Worker fetch handler', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => xmlResponse(rss());
  try {
    const res = await worker.fetch(req('/feed?source=dutchnews'), ENV);
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('no secrets are involved: responses never contain environment values', async () => {
  const fetchImpl = async () => xmlResponse(rss());
  const res = await handleRequest(req('/feed?source=uol'), { ...ENV, SECRET: 'sk-should-not-appear' }, { fetchImpl });
  const text = JSON.stringify([...res.headers]) + (await res.text());
  assert.ok(!text.includes('sk-should-not-appear'));
});
