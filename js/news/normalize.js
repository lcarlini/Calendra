/**
 * Turns raw feed items into the normalized NewsArticle model.
 * Only headline, a short excerpt and links are kept: `contentAvailability` is therefore
 * never 'full-permitted', and no image is ever stored.
 */
import { stripHtml } from './rss.js';

const TRACKING = /^(utm_|at_|fbclid$|gclid$|ref$|cmpid$|src$|source$|ocid$|mc_|igshid$)/i;
const EXCERPT_MAX = 220;

/** Canonical form used to recognise the same article behind different URLs. */
export function canonicalUrl(url) {
  try {
    const u = new URL(String(url).trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    let out = `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    if (u.pathname.length > 1) out = out.replace(/\/(?=(\?|$))/, '');
    return out;
  } catch {
    return String(url || '').trim();
  }
}

/** Lowercase, accent-free, punctuation-free title for equality checks. */
export function normalizeTitle(title) {
  return String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Deterministic short id (FNV-1a) for a string. */
export function hashId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function makeExcerpt(html, title) {
  let text = stripHtml(html);
  if (!text) return '';
  const nt = normalizeTitle(title);
  const ne = normalizeTitle(text);
  if (ne === nt || (nt && ne.startsWith(nt) && ne.length - nt.length < 20)) return '';
  if (text.length > EXCERPT_MAX) text = `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…`;
  return text;
}

const ECONOMY = /econom|financ|mercado|money|neg[oó]cios|bolsa|d[oó]lar|juros|infla[cç][aã]o|inflation|business/i;

/** Tabs an article belongs to: its source's tags, plus 'economy' when its own category says so. */
export function articleTags(article, source) {
  const tags = new Set(source?.tags || []);
  if (ECONOMY.test(article.category || '')) tags.add('economy');
  return [...tags];
}

/**
 * @returns {import('./types').NewsArticle | null} null when the item has no usable title or link
 */
export function toArticle(item, source, fetchedAt) {
  const title = (item.title || '').trim();
  const originalUrl = (item.link || item.guid || '').trim();
  if (!title || !/^https?:\/\//i.test(originalUrl)) return null;
  const canonical = canonicalUrl(originalUrl);
  const excerpt = makeExcerpt(item.excerptHtml, title);
  const article = {
    id: hashId(canonical),
    sourceId: source.id,
    sourceName: source.name,
    publisherGroup: source.group,
    title,
    canonicalUrl: canonical,
    originalUrl,
    publishedAt: item.publishedAt || undefined,
    fetchedAt,
    language: source.language,
    category: item.categories?.[0] || undefined,
    excerpt: excerpt || undefined,
    contentAvailability: excerpt ? 'excerpt-only' : 'headline-only',
    position: item.position ?? 0,
  };
  article.tags = articleTags(article, source);
  return article;
}
