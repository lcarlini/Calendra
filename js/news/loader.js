/**
 * Loads feeds through the companion proxy and keeps a last-known-good cache.
 * Without a proxy URL nothing is fetched and the UI reports the feeds as unavailable.
 */
import { fetchText } from '../core/http.js';
import { cacheGet, cacheSet } from '../core/cache.js';
import { readJSON, writeJSON } from '../core/store.js';
import { parseFeed } from './rss.js';
import { toArticle } from './normalize.js';
import { SOURCES } from './sources.js';

export const NEWS_KEY = 'calendra.news.v1';
export const NEWS_CACHE_KEY = 'news.v1';
export const NEWS_MAX_AGE_MS = 60 * 60 * 1000;

export function defaultNewsPrefs() {
  return { proxyUrl: '', tab: 'top', date: '3d', disabledSources: [], topics: [], region: '' };
}

export function loadNewsPrefs(storage) {
  const saved = readJSON(NEWS_KEY, {}, storage);
  const d = defaultNewsPrefs();
  return {
    proxyUrl: typeof saved.proxyUrl === 'string' ? saved.proxyUrl : d.proxyUrl,
    tab: typeof saved.tab === 'string' ? saved.tab : d.tab,
    date: ['24h', '3d', '7d', 'any'].includes(saved.date) ? saved.date : d.date,
    disabledSources: Array.isArray(saved.disabledSources) ? saved.disabledSources.filter((s) => typeof s === 'string') : [],
    topics: Array.isArray(saved.topics) ? saved.topics : [],
    region: typeof saved.region === 'string' ? saved.region : '',
  };
}

export const saveNewsPrefs = (prefs, storage) => writeJSON(NEWS_KEY, prefs, storage);

/** Accepts only http(s) URLs; returns a clean base (no trailing slash) or ''. */
export function normalizeProxyUrl(text) {
  try {
    const u = new URL(String(text || '').trim());
    if (!/^https?:$/.test(u.protocol)) return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function feedUrl(proxyUrl, sourceId, limit = 40) {
  return `${proxyUrl}/feed?source=${encodeURIComponent(sourceId)}&limit=${limit}`;
}

/**
 * Fetch every enabled integrated source. Returns articles plus a status per source, so one
 * failing outlet never hides the others (partial failure) and cached articles are marked stale.
 */
export async function loadNews({ proxyUrl, disabled = [], fetchOpts = {}, now = new Date(), storage } = {}) {
  const fetchedAt = now.toISOString();
  const cached = cacheGet(NEWS_CACHE_KEY, { maxAgeMs: NEWS_MAX_AGE_MS, now: now.getTime(), storage });
  const cachedBySource = new Map();
  for (const a of cached?.value?.articles || []) {
    if (!cachedBySource.has(a.sourceId)) cachedBySource.set(a.sourceId, []);
    cachedBySource.get(a.sourceId).push(a);
  }

  const statuses = [];
  const articles = [];

  await Promise.all(
    SOURCES.map(async (source) => {
      const base = { id: source.id, name: source.name, homepage: source.homepage };
      if (!source.feed) {
        statuses.push({ ...base, state: 'unavailable', message: source.unavailableReason });
        return;
      }
      if (disabled.includes(source.id)) {
        statuses.push({ ...base, state: 'disabled', message: 'Turned off by you' });
        return;
      }
      if (!proxyUrl) {
        const old = cachedBySource.get(source.id);
        if (old?.length) {
          articles.push(...old.map((a) => ({ ...a, stale: true })));
          statuses.push({ ...base, state: 'stale', count: old.length, message: 'No proxy configured: showing saved articles', fetchedAt: cached.fetchedAt });
        } else {
          statuses.push({ ...base, state: 'needs-proxy', message: 'Needs the news proxy (see setup below)' });
        }
        return;
      }
      try {
        const xml = await fetchText(feedUrl(proxyUrl, source.id), { retries: 1, timeoutMs: 15_000, ...fetchOpts });
        const items = parseFeed(xml, { now: now.getTime() });
        const list = items.map((i) => toArticle(i, source, fetchedAt)).filter(Boolean);
        if (!list.length) throw new Error('The feed had no readable items');
        articles.push(...list);
        statuses.push({ ...base, state: 'ok', count: list.length, fetchedAt });
      } catch (error) {
        const old = cachedBySource.get(source.id);
        if (old?.length) {
          articles.push(...old.map((a) => ({ ...a, stale: true })));
          statuses.push({ ...base, state: 'stale', count: old.length, message: `Could not refresh (${error.message}); showing saved articles`, fetchedAt: cached.fetchedAt });
        } else {
          statuses.push({ ...base, state: 'error', message: error.message });
        }
      }
    })
  );

  const fresh = articles.filter((a) => !a.stale);
  if (fresh.length) {
    // Keep the newest 250 minimal articles, merged with older cache for sources that failed.
    const keep = [...articles].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, 250);
    cacheSet(NEWS_CACHE_KEY, { articles: keep }, { now: now.getTime(), storage });
  }
  const order = new Map(SOURCES.map((s, i) => [s.id, i]));
  statuses.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { articles, statuses, fetchedAt };
}

/** Date filter helper: cutoff ISO or '' for any. */
export function dateCutoff(filter, now = Date.now()) {
  const hours = { '24h': 24, '3d': 72, '7d': 168 }[filter];
  return hours ? new Date(now - hours * 3600000).toISOString() : '';
}

/** Search the loaded articles only (scope is stated in the UI). All words must appear in title or excerpt. */
export function searchArticles(articles, query) {
  const words = String(query || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (!words.length) return articles;
  return articles.filter((a) => {
    const hay = `${a.title} ${a.excerpt || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
