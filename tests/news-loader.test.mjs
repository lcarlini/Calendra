// Run with: node --test tests/news-loader.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCircuitBreaker } from '../js/core/http.js';
import { dateCutoff, defaultNewsPrefs, feedUrl, loadNews, loadNewsPrefs, normalizeProxyUrl, saveNewsPrefs, searchArticles, fetchGdelt, parseGdeltDate, repairGarbled } from '../js/news/loader.js';
import { buildStories } from '../js/news/cluster.js';

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

const NOW = new Date('2026-11-07T15:00:00Z');
const PROXY = 'http://127.0.0.1:8791';

const feed = (prefix, n = 3, minutes = 30) =>
  `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>${prefix} headline número ${i} sobre economia</title><link>https://${prefix}.test/a/${i}</link><description>Resumo ${i}</description><pubDate>${new Date(NOW - (minutes + i) * 60000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

const okXml = (body) => ({ ok: true, status: 200, text: async () => body });
const fail = { ok: false, status: 502, headers: { get: () => null } };

function opts(handler) {
  return { fetchOpts: { fetchImpl: handler, retries: 0, sleep: async () => {}, breaker: createCircuitBreaker({ threshold: 99 }) } };
}

test('proxy url is validated: only http(s), no trailing slash, no junk', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:8791/'), 'http://127.0.0.1:8791');
  assert.equal(normalizeProxyUrl('https://news.example.workers.dev/api/'), 'https://news.example.workers.dev/api');
  assert.equal(normalizeProxyUrl('javascript:alert(1)'), '');
  assert.equal(normalizeProxyUrl('ftp://x'), '');
  assert.equal(normalizeProxyUrl('not a url'), '');
  assert.equal(normalizeProxyUrl(''), '');
  assert.equal(feedUrl(PROXY, 'uol-economia'), `${PROXY}/feed?source=uol-economia&limit=40`);
});

test('prefs persist, validate and default sensibly', () => {
  const s = memoryStorage();
  assert.deepEqual(loadNewsPrefs(s), defaultNewsPrefs());
  saveNewsPrefs({ ...defaultNewsPrefs(), proxyUrl: PROXY, tab: 'economy', date: 'bogus', disabledSources: ['uol'] }, s);
  const p = loadNewsPrefs(s);
  assert.equal(p.proxyUrl, PROXY);
  assert.equal(p.tab, 'economy');
  assert.equal(p.date, '3d', 'invalid date filter falls back');
  assert.deepEqual(p.disabledSources, ['uol']);
});

test('every source reports a status: ok, unavailable (with reason), disabled', async () => {
  const storage = memoryStorage();
  const res = await loadNews({ proxyUrl: PROXY, disabled: ['dutchnews'], now: NOW, storage, ...opts(async (url) => okXml(feed(new URL(url).searchParams.get('source')))) });
  const byId = Object.fromEntries(res.statuses.map((s) => [s.id, s]));
  assert.equal(res.statuses.length, 11);
  assert.equal(byId.g1.state, 'ok');
  assert.equal(byId.g1.count, 3);
  assert.equal(byId.globo.state, 'unavailable');
  assert.match(byId.globo.message, /does not publish an RSS feed/);
  assert.equal(byId.dutchnews.state, 'disabled');
  assert.ok(!res.articles.some((a) => a.sourceId === 'dutchnews'));
  assert.ok(res.articles.every((a) => a.contentAvailability === 'excerpt-only' && a.imageUrl === undefined));
  assert.ok(res.statuses.every((s) => s.homepage.startsWith('https://')), 'direct publisher link kept for every source');
});

test('partial failure: the failing source is reported, the others still load', async () => {
  const storage = memoryStorage();
  const handler = async (url) => {
    const id = new URL(url).searchParams.get('source');
    return id === 'uol' ? fail : okXml(feed(id));
  };
  const res = await loadNews({ proxyUrl: PROXY, now: NOW, storage, ...opts(handler) });
  const byId = Object.fromEntries(res.statuses.map((s) => [s.id, s]));
  assert.equal(byId.uol.state, 'error');
  assert.match(byId.uol.message, /HTTP 502/);
  assert.equal(byId.g1.state, 'ok');
  assert.ok(res.articles.some((a) => a.sourceId === 'g1'));
  assert.ok(!res.articles.some((a) => a.sourceId === 'uol'));
});

test('a failed refresh falls back to saved articles and marks them stale', async () => {
  const storage = memoryStorage();
  await loadNews({ proxyUrl: PROXY, now: NOW, storage, ...opts(async (url) => okXml(feed(new URL(url).searchParams.get('source')))) });
  const later = new Date(NOW.getTime() + 3600000);
  const res = await loadNews({ proxyUrl: PROXY, now: later, storage, ...opts(async () => fail) });
  const g1 = res.statuses.find((s) => s.id === 'g1');
  assert.equal(g1.state, 'stale');
  assert.match(g1.message, /showing saved articles/);
  assert.ok(res.articles.length > 0 && res.articles.every((a) => a.stale === true));
});

test('without a proxy the serverless transport (rss2json) is used and mapped to articles', async () => {
  const urls = [];
  const fakeJson = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ status: 'ok', items: [{ title: 'Headline ' + urls.length, link: 'https://x.test/a' + urls.length, pubDate: '2026-11-07 12:00:00', description: 'Excerpt text here that is long enough', categories: ['Mundo'] }] }), text: async () => '' };
  };
  const res = await loadNews({ proxyUrl: '', now: NOW, storage: memoryStorage(), fetchOpts: { ...opts(fakeJson).fetchOpts, staggerMs: 0, gdelt: false } });
  assert.ok(urls.every((u) => u.startsWith('https://api.rss2json.com/v1/api.json?rss_url=')));
  assert.ok(res.articles.length >= 8);
  assert.ok(res.statuses.filter((s) => s.state === 'ok').length >= 8);
  assert.equal(res.statuses.filter((s) => s.state === 'needs-proxy').length, 0);
});

test('an empty or unreadable feed is an error, not an empty success', async () => {
  const res = await loadNews({ proxyUrl: PROXY, now: NOW, storage: memoryStorage(), ...opts(async () => okXml('<html>nope</html>')) });
  assert.ok(res.statuses.filter((s) => s.state === 'error').length >= 6);
  assert.equal(res.articles.length, 0);
});

test('the same article reaching us through two UOL feeds counts as one outlet in the stories', async () => {
  const same = (path) => `<rss><channel><item><title>Justiça suspende decisão sobre três casas de apostas online</title><link>https://${path}</link><pubDate>${NOW.toUTCString()}</pubDate></item></channel></rss>`;
  const handler = async (url) => {
    const id = new URL(url).searchParams.get('source');
    if (id === 'uol') return okXml(same('noticias.uol.com.br/x/1.htm'));
    if (id === 'uol-economia') return okXml(same('economia.uol.com.br/y/1.htm'));
    return { ok: false, status: 502, headers: { get: () => null } };
  };
  const res = await loadNews({ proxyUrl: PROXY, now: NOW, storage: memoryStorage(), ...opts(handler) });
  const stories = buildStories(res.articles, { now: NOW.getTime() });
  assert.equal(stories.length, 1);
  assert.equal(stories[0].coverage, 1);
  assert.equal(stories[0].outlets.length, 1);
});

test('search covers loaded articles only; accents and case are ignored; all words must match', () => {
  const list = [
    { title: 'Inflação desacelera em outubro', excerpt: 'IPCA sobe menos que o esperado' },
    { title: 'Seleção convoca jogadores', excerpt: '' },
  ];
  assert.equal(searchArticles(list, 'inflacao').length, 1);
  assert.equal(searchArticles(list, 'IPCA esperado').length, 1);
  assert.equal(searchArticles(list, 'inflacao seleção').length, 0);
  assert.equal(searchArticles(list, '').length, 2);
  assert.equal(searchArticles(list, 'zzz').length, 0);
});

test('date filter cutoffs', () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  assert.equal(dateCutoff('24h', now), '2026-11-06T15:00:00.000Z');
  assert.equal(dateCutoff('7d', now), '2026-10-31T15:00:00.000Z');
  assert.equal(dateCutoff('any', now), '');
});

test('GDELT index: dates parse, domains map to our sources, foreign domains are dropped', async () => {
  assert.equal(parseGdeltDate('20261107T142200Z'), '2026-11-07T14:22:00Z');
  assert.equal(parseGdeltDate('nope'), '');
  const rows = await fetchGdelt({
    now: NOW.getTime(),
    fetchOpts: {
      retries: 0,
      gdeltGapMs: 0,
      breaker: createCircuitBreaker({ threshold: 99 }),
      fetchImpl: async (url) => {
        assert.ok(url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc?'));
        assert.ok(decodeURIComponent(url).includes('domain:'));
        return { ok: true, json: async () => ({ articles: [
          { url: 'https://g1.globo.com/a', title: 'Manchete g1', seendate: '20261107T120000Z', domain: 'g1.globo.com' },
          { url: 'https://economia.uol.com.br/b', title: 'Manchete UOL Economia', seendate: '20261107T110000Z', domain: 'economia.uol.com.br' },
          { url: 'https://www.bbc.com/portuguese/articles/x', title: 'BBC pt', seendate: '20261107T100000Z', domain: 'bbc.com' },
          { url: 'https://www.bbc.com/news/world-1', title: 'BBC English', seendate: '20261107T100000Z', domain: 'bbc.com' },
          { url: 'https://other.example/z', title: 'Other', seendate: '20261107T100000Z', domain: 'other.example' },
        ] }) };
      },
    },
  });
  assert.deepEqual(rows.map((r) => r.sourceId), ['g1', 'uol-economia', 'bbc-pt']);
  assert.equal(rows[0].item.publishedAt, '2026-11-07T12:00:00.000Z');
});

test('garbled (non UTF-8) feed copies are replaced by the index copy, or lose their excerpt', () => {
  const list = [
    { id: 'a', title: 'Morre m?sico famoso', excerpt: 'x' },
    { id: 'a', title: 'Morre músico famoso', excerpt: '', viaIndex: true },
    { id: 'b', title: 'Sem alternativa ap?s tudo', excerpt: 'resumo ?til aqui' },
    { id: 'c', title: 'Normal title? Yes', excerpt: 'ok' },
  ];
  repairGarbled(list);
  assert.deepEqual(list.map((x) => x.title), ['Morre músico famoso', 'Sem alternativa ap?s tudo', 'Normal title? Yes']);
  assert.equal(list[1].excerpt, '');
  assert.equal(list[2].excerpt, 'ok');
});
