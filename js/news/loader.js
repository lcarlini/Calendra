/**
 * Loads feeds through the companion proxy and keeps a last-known-good cache.
 * Without a proxy URL nothing is fetched and the UI reports the feeds as unavailable.
 */
import { fetchText, fetchJson, createCircuitBreaker } from '../core/http.js';
import { cacheGet, cacheSet } from '../core/cache.js';
import { readJSON, writeJSON } from '../core/store.js';
import { firstImage, parseFeed, parseFeedDate, safeImageUrl, stripHtml } from './rss.js';
import { toArticle } from './normalize.js';
import { GDELT_QUERIES, SOURCES, sourceForGdelt } from './sources.js';

export const NEWS_KEY = 'calendra.news.v1';
export const NEWS_CACHE_KEY = 'news.v1';
export const NEWS_MAX_AGE_MS = 60 * 60 * 1000;

export function defaultNewsPrefs() {
  return { proxyUrl: '', rss2jsonKey: '', tab: 'top', date: '3d', disabledSources: [], topics: [], region: '' };
}

export function loadNewsPrefs(storage) {
  const saved = readJSON(NEWS_KEY, {}, storage);
  const d = defaultNewsPrefs();
  return {
    proxyUrl: typeof saved.proxyUrl === 'string' ? saved.proxyUrl : d.proxyUrl,
    rss2jsonKey: typeof saved.rss2jsonKey === 'string' ? saved.rss2jsonKey.trim() : '',
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

export const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** "20261107T142200Z" -> ISO string, or ''. */
export function parseGdeltDate(text) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(text || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : '';
}

/**
 * Serverless transport #2: one GDELT query covers every outlet (headline, link, time; no excerpt).
 * GDELT asks for at most one request every 5 seconds, so this is called once per refresh.
 * @returns {Promise<Array<{ sourceId: string, item: object }>>}
 */
export async function fetchGdelt({ fetchOpts = {}, now = Date.now(), timespan = '2d' } = {}) {
  const out = [];
  const seen = new Set();
  let failures = 0;
  let lastError;
  for (let q = 0; q < GDELT_QUERIES.length; q += 1) {
    if (q) await new Promise((r) => setTimeout(r, fetchOpts.gdeltGapMs ?? 5500));
    try {
      const params = new URLSearchParams({ query: GDELT_QUERIES[q], mode: 'artlist', maxrecords: '250', format: 'json', timespan, sort: 'datedesc' });
      const data = await fetchJson(`${GDELT}?${params}`, { retries: 1, backoffMs: 5500, timeoutMs: 30_000, breaker: gdeltBreaker, ...fetchOpts });
      if (!Array.isArray(data?.articles)) throw new Error('The news index returned no articles');
      data.articles.forEach((a, position) => {
        const sourceId = sourceForGdelt(a.domain, a.url);
        if (!sourceId || !a.url || !a.title || seen.has(a.url)) return;
        seen.add(a.url);
        out.push({
          sourceId,
          item: { position, title: stripHtml(a.title), link: a.url, guid: a.url, publishedAt: parseFeedDate(parseGdeltDate(a.seendate), now), categories: [], excerptHtml: '', image: safeImageUrl(a.socialimage) },
        });
      });
    } catch (error) {
      failures += 1;
      lastError = error;
    }
  }
  if (failures === GDELT_QUERIES.length) throw lastError;
  return out;
}

export const RSS2JSON = 'https://api.rss2json.com/v1/api.json';
// One host serves every feed here, so a few throttled answers must not pause the rest.
const gdeltBreaker = createCircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
const rss2jsonBreaker = createCircuitBreaker({ threshold: 25, cooldownMs: 30_000 });

/**
 * Serverless transport: rss2json.com is a public feed-to-JSON converter that answers browsers
 * (CORS enabled), so a static page can read the publishers' own RSS feeds with no server of ours.
 * The free tier returns the 10 newest items per feed; a free API key (optional) raises that.
 * Items are mapped to the same shape parseFeed() produces.
 */
export async function fetchViaRss2Json(feedAddress, { apiKey = '', count = 0, fetchOpts = {}, now = Date.now() } = {}) {
  const params = new URLSearchParams({ rss_url: feedAddress });
  if (apiKey) {
    params.set('api_key', apiKey);
    if (count) params.set('count', String(count));
  }
  const data = await fetchJson(`${RSS2JSON}?${params}`, { retries: 1, backoffMs: 2500, timeoutMs: 20_000, breaker: rss2jsonBreaker, ...fetchOpts });
  if (data?.status !== 'ok' || !Array.isArray(data.items)) throw new Error(data?.message || 'The feed converter returned no items');
  return data.items.map((i, position) => ({
    position,
    title: stripHtml(i.title || ''),
    link: i.link || '',
    guid: i.guid || '',
    // rss2json reports "YYYY-MM-DD HH:MM:SS" in UTC.
    publishedAt: parseFeedDate(i.pubDate ? `${String(i.pubDate).replace(' ', 'T')}Z` : '', now),
    categories: Array.isArray(i.categories) ? i.categories.map(String) : [],
    excerptHtml: i.description || '',
    image:
      safeImageUrl(i.thumbnail) ||
      (/^image\//i.test(i.enclosure?.type || '') || /\.(jpe?g|png|webp)(\?|$)/i.test(i.enclosure?.link || '') ? safeImageUrl(i.enclosure?.link) : '') ||
      firstImage(i.description) ||
      firstImage(i.content),
  }));
}

/**
 * Fetch every enabled integrated source. Returns articles plus a status per source, so one
 * failing outlet never hides the others (partial failure) and cached articles are marked stale.
 */
export async function loadNews({ proxyUrl, rss2jsonKey = '', disabled = [], fetchOpts = {}, now = new Date(), storage, onUpdate } = {}) {
  const fetchedAt = now.toISOString();
  const cached = cacheGet(NEWS_CACHE_KEY, { maxAgeMs: NEWS_MAX_AGE_MS, now: now.getTime(), storage });
  const cachedBySource = new Map();
  for (const a of cached?.value?.articles || []) {
    if (!cachedBySource.has(a.sourceId)) cachedBySource.set(a.sourceId, []);
    cachedBySource.get(a.sourceId).push(a);
  }

  const statuses = [];
  const extraStatuses = [];
  const articles = [];
  const order = new Map(SOURCES.map((s, i) => [s.id, i]));

  // Partial updates reach the page before the end of the load, so they get the same repair as the final list.
  const emit = () => onUpdate?.({ articles: repairGarbled([...articles]), statuses: [...statuses, ...extraStatuses].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)), fetchedAt, partial: true });
  // The serverless transport is polite: at most 3 feeds in flight, a short pause between starts.
  const lanes = proxyUrl ? Infinity : fetchOpts.concurrency ?? 3;
  let active = 0;
  const waiting = [];
  const lane = async () => {
    if (active >= lanes) await new Promise((r) => waiting.push(r));
    active += 1;
  };
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  // Headline index for all outlets at once (no server needed). Runs alongside the per-feed requests.
  const gdeltRun = proxyUrl || fetchOpts.gdelt === false
    ? Promise.resolve()
    : fetchGdelt({ fetchOpts, now: now.getTime() })
        .then((rows) => {
          const bySource = new Map();
          for (const { sourceId, item } of rows) {
            const source = SOURCES.find((x) => x.id === sourceId);
            const article = source && toArticle(item, source, fetchedAt);
            if (!article) continue;
            article.viaIndex = true;
            if (!bySource.has(sourceId)) bySource.set(sourceId, []);
            bySource.get(sourceId).push(article);
          }
          const added = [...bySource.values()].flat();
          articles.push(...added);
          extraStatuses.push({ id: 'gdelt', name: 'GDELT news index', homepage: 'https://www.gdeltproject.org/', state: added.length ? 'ok' : 'error', count: added.length, message: added.length ? 'Headlines for every outlet from one open index' : 'No matching headlines', fetchedAt, indexBySource: Object.fromEntries([...bySource].map(([k, v]) => [k, v.length])) });
          emit();
        })
        .catch((error) => {
          extraStatuses.push({ id: 'gdelt', name: 'GDELT news index', homepage: 'https://www.gdeltproject.org/', state: 'error', message: error.message });
          emit();
        });
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
      try {
        let items;
        if (proxyUrl) {
          const xml = await fetchText(feedUrl(proxyUrl, source.id), { retries: 1, timeoutMs: 15_000, ...fetchOpts });
          items = parseFeed(xml, { now: now.getTime() });
        } else {
          await lane();
          try {
            await new Promise((r) => setTimeout(r, fetchOpts.staggerMs ?? 250));
            items = await fetchViaRss2Json(source.feed, { apiKey: rss2jsonKey, count: rss2jsonKey ? 50 : 0, fetchOpts, now: now.getTime() });
          } finally {
            release();
          }
        }
        const list = items.map((i) => toArticle(i, source, fetchedAt)).filter(Boolean);
        if (!list.length) throw new Error('The feed had no readable items');
        articles.push(...list);
        statuses.push({ ...base, state: 'ok', count: list.length, fetchedAt });
        emit();
      } catch (error) {
        const old = cachedBySource.get(source.id);
        if (old?.length) {
          articles.push(...old.map((a) => ({ ...a, stale: true })));
          statuses.push({ ...base, state: 'stale', count: old.length, message: `Could not refresh (${error.message}); showing saved articles`, fetchedAt: cached.fetchedAt });
          emit();
        } else {
          statuses.push({ ...base, state: 'error', message: error.message });
          emit();
        }
      }
    })
  );

  await gdeltRun;
  // A source whose own feed failed but that the index covered is not an error any more.
  const idx = extraStatuses.find((x) => x.id === 'gdelt')?.indexBySource || {};
  for (const st of statuses) {
    if (st.state === 'error' && idx[st.id]) {
      st.state = 'ok';
      st.count = idx[st.id];
      st.message = 'Own feed throttled: headlines from the open news index';
    }
    if (st.state === 'unavailable' && idx[st.id]) {
      st.state = 'ok';
      st.count = idx[st.id];
      st.message = 'No RSS feed: headlines from the open news index';
    }
  }
  statuses.push(...extraStatuses);
  repairGarbled(articles);
  const fresh = articles.filter((a) => !a.stale);
  if (fresh.length) {
    // Keep the newest 250 minimal articles, merged with older cache for sources that failed.
    const keep = [...articles].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, 250);
    cacheSet(NEWS_CACHE_KEY, { articles: keep }, { now: now.getTime(), storage });
  }
  statuses.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  return { articles, statuses, fetchedAt };
}

/**
 * rss2json and the index mangle feeds that are not UTF-8 (UOL's are ISO-8859-1): accents arrive as "?" inside words,
 * one or two "?" per accented letter ("Rússia" → "R?ssia", "subestações" → "subesta??es").
 * Prefer the index's UTF-8 copy of the same URL; otherwise restore the accents from a vocabulary of common words.
 */
export const isGarbled = (text) => /[A-Za-zÀ-ÿ]\?+[A-Za-zÀ-ÿ]|(?:^|\s)\?+[a-zà-ÿ]{2,}/.test(String(text || ''));

// Common news vocabulary (Portuguese first). Only used to restore accents in words the converter damaged.
const ACCENT_WORDS = [
  'Rússia', 'Ucrânia', 'três', 'subestações', 'subestação', 'energia', 'navios', 'navio', 'também', 'políticas',
  'política', 'países', 'país', 'governo', 'eleições', 'eleição', 'milhões', 'milhão', 'bilhões', 'bilhão', 'Índia',
  'ação', 'ações', 'após', 'até', 'já', 'mês', 'meses', 'anos', 'ano', 'são', 'será', 'saúde', 'ministro', 'ministra',
  'presidente', 'decisão', 'crise', 'guerra', 'segurança', 'econômica', 'econômico', 'economia', 'pré', 'médio',
  'público', 'pública', 'história', 'músico', 'útil', 'notícia', 'notícias', 'aéreo', 'aérea', 'ataque', 'ataques',
  'exército', 'forças', 'militar', 'militares', 'própria', 'região', 'regiões', 'cidade', 'cidades', 'polícia',
  'justiça', 'relatório', 'vídeo', 'vítimas', 'vítima', 'dívida', 'inflação', 'juros', 'reforma', 'tarifas', 'tarifa',
  'comércio', 'exportações', 'importações', 'produção', 'produtos', 'mercado', 'mercados', 'dólar', 'câmbio',
  'petróleo', 'usina', 'usinas', 'geração', 'tensão', 'tensões', 'negociações', 'acordo', 'acordos', 'paz', 'último',
  'última', 'últimos', 'próximo', 'próxima', 'primeiro', 'primeira', 'segundo', 'série', 'evento', 'eventos', 'técnico',
  'chuva', 'chuvas', 'previsão', 'cúpula', 'ministério', 'secretário', 'secretária', 'saída', 'hospital', 'hospitais',
  'atingiram', 'atingir', 'transportavam', 'realizados', 'vacina', 'vacinas', 'doença', 'doenças', 'educação', 'eleitoral', 'votação', 'mortos', 'morre', 'famoso', 'famosa',
  'Lula', 'Irã', 'Síria', 'Coreia', 'Japão', 'França', 'Alemanha', 'Itália', 'Espanha', 'Portugal', 'Palestina',
  'México', 'Colômbia', 'Bolívia', 'Moçambique', 'Canadá', 'Turquia', 'Brasília', 'São Paulo', 'Rio de Janeiro',
  'Angola', 'Venezuela', 'Argentina', 'Uruguai', 'Paraguai', 'Gaza', 'Jerusalém', 'Mônaco', 'Indonésia',
];
const accentKey = (word) => word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Restore "?"-damaged words when exactly one known word fits. Unknown or ambiguous words are left as they are. */
export function restoreAccents(text) {
  return String(text ?? '').replace(/[\p{L}?]*\?[\p{L}?]*/gu, (token) => {
    if (!/\p{L}/u.test(token)) return token;
    // A "?" at the start of a word can stand for a dropped character, so it may also match nothing.
    const lead = token.startsWith('?') ? '.{0,2}' : '';
    const body = token
      .replace(/^\?+/, '')
      .split(/\?+/)
      .map((part) => part.replace(/[.*+^${}()|[\]\\]/g, '\\$&'))
      .join('.{1,2}');
    const pattern = lead + body;
    const re = new RegExp(`^${pattern}$`, 'i');
    const hits = new Set(ACCENT_WORDS.filter((word) => re.test(accentKey(word))));
    return hits.size === 1 ? [...hits][0] : token;
  });
}

export function repairGarbled(articles) {
  const clean = new Set(articles.filter((a) => a.viaIndex && !isGarbled(a.title)).map((a) => a.id));
  for (let i = articles.length - 1; i >= 0; i -= 1) {
    const a = articles[i];
    if (!a.viaIndex && isGarbled(a.title) && clean.has(a.id)) {
      articles.splice(i, 1);
      continue;
    }
    if (isGarbled(a.title)) a.title = restoreAccents(a.title);
    if (isGarbled(a.excerpt)) a.excerpt = restoreAccents(a.excerpt);
    if (isGarbled(a.excerpt)) a.excerpt = '';
  }
  return articles;
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
