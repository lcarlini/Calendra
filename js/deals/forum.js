/**
 * Forum threads from official RSS feeds (Adrenaline Ofertas). Only metadata and a short excerpt are kept:
 * the post body is never republished. A price is only reported when the text literally contains "R$".
 */
import { getAllTags, getTag, parseFeedDate, stripHtml } from '../news/rss.js';
import { hashId, normalizeTitle } from '../news/normalize.js';
import { fetchText, fetchJson } from '../core/http.js';
import { DEAL_FEEDS } from './feeds.js';

const EXCERPT_MAX = 200;

/** First explicit Brazilian-real amounts in a text, as numbers. "R$ 1.299,90" -> 1299.9 */
export function parseBrlPrices(text) {
  const out = [];
  const re = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) {
    const value = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

const EXPIRED = /\b(expirad[oa]|esgotad[oa]|encerrad[oa]|acabou|fora do ar|indispon[ií]vel)\b/i;

export function parseThreads(xml, { sourceId = 'adrenaline-ofertas', now = Date.now() } = {}) {
  const blocks = String(xml ?? '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const threads = [];
  blocks.forEach((block, position) => {
    const title = stripHtml(getTag(block, 'title'));
    const url = stripHtml(getTag(block, 'link'));
    if (!title || !/^https?:\/\//i.test(url)) return;
    let excerpt = stripHtml(getTag(block, 'content:encoded') || getTag(block, 'description'));
    if (excerpt.length > EXCERPT_MAX) excerpt = `${excerpt.slice(0, EXCERPT_MAX - 1).trimEnd()}…`;
    const titlePrices = parseBrlPrices(title);
    const excerptPrices = titlePrices.length ? [] : parseBrlPrices(excerpt);
    const price = titlePrices[0] ?? excerptPrices[0];
    threads.push({
      id: hashId(url),
      sourceId,
      title,
      url,
      author: stripHtml(getTag(block, 'dc:creator')) || undefined,
      createdAt: parseFeedDate(getTag(block, 'pubDate'), now) || undefined,
      category: getAllTags(block, 'category').map(stripHtml)[0] || undefined,
      excerpt: excerpt || undefined,
      price: price ?? undefined,
      priceSource: price == null ? undefined : titlePrices.length ? 'title' : 'excerpt',
      currency: price == null ? undefined : 'BRL',
      possiblyExpired: EXPIRED.test(title),
      position,
    });
  });
  return threads;
}

/** Remove repeated threads (same normalized title). Keeps the newest. */
export function dedupeThreads(threads) {
  const seen = new Map();
  for (const t of threads) {
    const key = normalizeTitle(t.title);
    const existing = seen.get(key);
    if (!existing || (t.createdAt || '') > (existing.createdAt || '')) seen.set(key, t);
  }
  return [...seen.values()];
}

/** "3 hours old"-style age label; never guesses when the date is missing. */
export function ageLabel(createdAt, now = Date.now()) {
  if (!createdAt) return 'age unknown';
  const hours = (now - Date.parse(createdAt)) / 3600000;
  if (!Number.isFinite(hours)) return 'age unknown';
  if (hours < 1) return 'under 1 hour old';
  if (hours < 48) return `${Math.floor(hours)} hours old`;
  return `${Math.floor(hours / 24)} days old`;
}

function norm(text) {
  return normalizeTitle(text);
}

/**
 * Filters that the feed data can actually back: keywords, excluded words, price range, age,
 * hidden and saved threads. (No discount %, shipping or seller filters: the feed has no such data.)
 */
export function filterThreads(threads, { q = '', exclude = [], minPrice = null, maxPrice = null, sinceHours = 0, hiddenIds = [], savedIds = [], savedOnly = false, showHidden = false, now = Date.now() } = {}) {
  const words = norm(q).split(' ').filter((w) => w.length >= 2);
  const blocked = exclude.map(norm).filter(Boolean);
  return threads.filter((t) => {
    if (!showHidden && hiddenIds.includes(t.id)) return false;
    if (savedOnly && !savedIds.includes(t.id)) return false;
    const hay = norm(`${t.title} ${t.excerpt || ''}`);
    if (words.length && !words.every((w) => hay.includes(w))) return false;
    if (blocked.some((b) => hay.includes(b))) return false;
    if (minPrice != null && (t.price == null || t.price < minPrice)) return false;
    if (maxPrice != null && (t.price == null || t.price > maxPrice)) return false;
    if (sinceHours && t.createdAt && now - Date.parse(t.createdAt) > sinceHours * 3600000) return false;
    return true;
  });
}

const cdata = (t) => '<![CDATA[' + String(t ?? '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';

/** rss2json items rebuilt as minimal RSS so the same parser (and the same rules) apply. */
export function rss2jsonToXml(data) {
  const items = (data?.items || [])
    .map((i) => {
      const when = i.pubDate ? new Date(String(i.pubDate).replace(' ', 'T') + 'Z') : null;
      return '<item><title>' + cdata(i.title) + '</title><link>' + cdata(i.link) + '</link><description>' + cdata(i.description || i.content) +
        '</description>' + (when && !Number.isNaN(+when) ? '<pubDate>' + when.toUTCString() + '</pubDate>' : '') +
        (i.author ? '<dc:creator>' + cdata(i.author) + '</dc:creator>' : '') +
        (i.categories || []).map((c) => '<category>' + cdata(c) + '</category>').join('') + '</item>';
    })
    .join('');
  return '<rss><channel>' + items + '</channel></rss>';
}

/**
 * Load the threads and say which route answered. Without a proxy the feed goes through rss2json.com (free, CORS
 * enabled). The forum sits behind a bot challenge, so generic CORS relays cannot read it (verified: they get the
 * challenge page or time out), and rss2json is the only serverless route. It throttles bursts from one address
 * ("converting new feeds in a very short period", HTTP 429), so a 429 is retried patiently, and an optional free
 * rss2json key removes the limit. The page keeps the last good copy for 24 hours.
 * First choice, when `snapshotBase` is given: the copy a scheduled GitHub Action saves into the site (data/), read
 * from the same origin.
 * @returns {Promise<{ threads: object[], via: string }>}
 */
export async function loadForumThreadsDetailed({ proxyUrl, sourceId = 'adrenaline-ofertas', limit = 40, rss2jsonKey = '', snapshotBase = '', fetchOpts = {}, now = Date.now() } = {}) {
  const parse = (xml) => {
    const threads = dedupeThreads(parseThreads(xml, { sourceId, now }));
    if (!threads.length) throw new Error('The feed had no readable threads');
    return threads;
  };
  if (proxyUrl) {
    const xml = await fetchText(`${proxyUrl}/feed?source=${encodeURIComponent(sourceId)}&limit=${limit}`, { retries: 1, timeoutMs: 15000, ...fetchOpts });
    return { threads: parse(xml), via: 'your news proxy' };
  }
  const feed = DEAL_FEEDS.find((d) => d.id === sourceId);
  if (!feed) throw new Error('Unknown deal feed');

  // 1. The copy the site saves itself (GitHub Action, every 30 minutes): same origin, so no CORS and no rate limit.
  let snapshot = null;
  if (snapshotBase) {
    try {
      const xml = await fetchText(`${snapshotBase}deals-${sourceId}.xml`, { retries: 0, timeoutMs: 10000, ...fetchOpts });
      let savedAt = '';
      try {
        savedAt = (await fetchText(`${snapshotBase}deals-${sourceId}.updated`, { retries: 0, timeoutMs: 5000, ...fetchOpts })).trim();
      } catch {
        /* the time stamp is optional */
      }
      const saved = Date.parse(savedAt);
      snapshot = { threads: parse(xml), via: 'Calendra feed snapshot', fetchedAt: Number.isFinite(saved) ? new Date(saved).toISOString() : '' };
      if (Number.isFinite(saved) && now - saved < SNAPSHOT_FRESH_MS) return snapshot;
    } catch {
      /* no snapshot yet (or unreadable): fall through to the live route */
    }
  }

  // 2. rss2json.com (free, CORS enabled, throttles bursts). Patient only when there is nothing else to show.
  try {
    const key = rss2jsonKey ? `&api_key=${encodeURIComponent(rss2jsonKey)}&count=${limit}` : '';
    const data = await fetchJson(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.feed)}${key}`, {
      retries: snapshot ? 0 : rss2jsonKey ? 1 : 3,
      backoffMs: 5000,
      timeoutMs: 20000,
      ...fetchOpts,
    });
    if (data?.status !== 'ok') throw new Error(data?.message || 'The feed converter returned no items');
    return { threads: parse(rss2jsonToXml(data)), via: rss2jsonKey ? 'rss2json.com (your key)' : 'rss2json.com', fetchedAt: new Date(now).toISOString() };
  } catch (error) {
    if (snapshot) return snapshot; // older snapshot beats nothing
    throw error;
  }
}

/** A snapshot younger than this is used as is; an older one is used only when the live route fails. */
export const SNAPSHOT_FRESH_MS = 3 * 60 * 60 * 1000;

export async function loadForumThreads(options = {}) {
  return (await loadForumThreadsDetailed(options)).threads;
}

// ---------------------------------------------------------------------------
// Coupon finder: codes people post in the community threads (never verified)
// ---------------------------------------------------------------------------

const COUPON_TOPIC = /\b(cupom|cupons|cup[aã]o|c[oó]digo|codigo)\b/i;
const NOT_CODES = new Set(['CUPOM', 'CUPONS', 'CODIGO', 'CODE', 'DESCONTO', 'FRETE', 'GRATIS', 'LOJA', 'APP', 'PIX', 'AMAZON', 'SHOPEE']);

/** Coupon-looking codes after the words "cupom"/"código"/"code". Only ALL-CAPS tokens of 4-20 characters count. */
export function extractCouponCodes(text) {
  const out = [];
  const re = /\b(?:cupom|cupons|cup[aã]o|c[oó]digo|codigo|code)(?:\s+(?:de\s+desconto|promocional|do\s+app))?\s*[:\-–]?\s*[\"“'`]?([A-Za-z0-9][A-Za-z0-9_-]{3,19})\b/gi;
  let m;
  while ((m = re.exec(String(text ?? '')))) {
    const code = m[1];
    if (code !== code.toUpperCase() || !/[A-Z]/.test(code) || NOT_CODES.has(code) || out.includes(code)) continue;
    out.push(code);
  }
  return out;
}

/** Threads that talk about a coupon, with the codes found in their title/excerpt; optionally narrowed by a store or product. */
export function couponThreads(threads, query = '', { hiddenIds = [] } = {}) {
  const words = norm(query).split(' ').filter((w) => w.length >= 2);
  return threads
    .filter((t) => !hiddenIds.includes(t.id))
    .map((thread) => ({ thread, codes: extractCouponCodes(`${thread.title} ${thread.excerpt || ''}`) }))
    .filter(({ thread, codes }) => {
      if (!codes.length && !COUPON_TOPIC.test(thread.title)) return false;
      const hay = norm(`${thread.title} ${thread.excerpt || ''}`);
      return words.every((w) => hay.includes(w));
    });
}
