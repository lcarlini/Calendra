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

export async function loadForumThreads({ proxyUrl, sourceId = 'adrenaline-ofertas', limit = 40, fetchOpts = {}, now = Date.now() } = {}) {
  let xml;
  if (proxyUrl) {
    xml = await fetchText(`${proxyUrl}/feed?source=${encodeURIComponent(sourceId)}&limit=${limit}`, { retries: 1, timeoutMs: 15000, ...fetchOpts });
  } else {
    // No server: the public feed converter rss2json.com answers browsers (10 newest threads on its free tier).
    const feed = DEAL_FEEDS.find((d) => d.id === sourceId);
    if (!feed) throw new Error('Unknown deal feed');
    const data = await fetchJson(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.feed)}`, { retries: 1, timeoutMs: 20000, ...fetchOpts });
    if (data?.status !== 'ok') throw new Error(data?.message || 'The feed converter returned no items');
    xml = rss2jsonToXml(data);
  }
  const threads = dedupeThreads(parseThreads(xml, { sourceId, now }));
  if (!threads.length) throw new Error('The feed had no readable threads');
  return threads;
}
