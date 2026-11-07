/**
 * Calendra news proxy: a small, allowlist-only companion for the static site.
 *
 * Why it exists: the publishers' RSS feeds send no CORS headers, so a browser on GitHub Pages
 * cannot read them. This service fetches the feeds server-side and re-serves them with CORS
 * limited to the origins you configure.
 *
 * It is NOT a general proxy:
 *  - the only upstream addresses are the feed URLs in js/news/sources.js and js/deals/feeds.js, selected by source id;
 *    there is no `url` parameter;
 *  - redirects are followed only to hosts of those feeds;
 *  - browser requests must come from an origin listed in ALLOWED_ORIGINS (default: none);
 *  - responses must be XML, are size-limited, time-limited, rate-limited per client and cached briefly.
 *
 * Runs unchanged as a Cloudflare Worker (default export) and under Node (see server.mjs).
 * Publisher terms of use are the deployer's responsibility; only RSS feeds are fetched.
 */
import { SOURCES } from '../../js/news/sources.js';
import { DEAL_FEEDS } from '../../js/deals/feeds.js';

const FEEDS = new Map([...SOURCES, ...DEAL_FEEDS].filter((s) => s.feed).map((s) => [s.id, s.feed]));
// Hosts a feed may legitimately redirect to (CNN Brasil's feed redirects to its admin host).
const REDIRECT_HOSTS = new Set(['admin.cnnbrasil.com.br']);

export const LIMITS = {
  timeoutMs: 10_000,
  maxBytes: 3_000_000,
  defaultItems: 40,
  maxItems: 100,
  cacheMs: 5 * 60 * 1000,
  ratePerMinute: 60,
  maxRedirects: 3,
};

export function allowedHosts() {
  const hosts = new Set(REDIRECT_HOSTS);
  for (const url of FEEDS.values()) hosts.add(new URL(url).hostname);
  return hosts;
}

const cache = new Map(); // key -> { at, body }
const hits = new Map(); // client -> { windowStart, count }

export function resetState() {
  cache.clear();
  hits.clear();
}

function parseOrigins(env) {
  return new Set(
    String(env?.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

function rateLimited(client, now) {
  const slot = hits.get(client) || { windowStart: now, count: 0 };
  if (now - slot.windowStart >= 60_000) {
    slot.windowStart = now;
    slot.count = 0;
  }
  slot.count += 1;
  hits.set(client, slot);
  return slot.count > LIMITS.ratePerMinute;
}

/** Decode with the charset the feed declares (header first, then the XML prolog); UTF-8 otherwise. */
export function decodeBody(bytes, contentType = '') {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 200));
  const label =
    /charset=([^;\s]+)/i.exec(contentType)?.[1] || /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head)?.[1] || 'utf-8';
  try {
    return new TextDecoder(label.trim().replace(/^"|"$/g, '')).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Keep the channel header and only the newest `limit` items. */
export function trimItems(xml, limit) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  if (items.length <= limit) return xml;
  const first = xml.indexOf(items[0]);
  const last = xml.lastIndexOf(items.at(-1)) + items.at(-1).length;
  return xml.slice(0, first) + items.slice(0, limit).join('\n') + xml.slice(last);
}

async function fetchFeed(url, fetchImpl) {
  const hosts = allowedHosts();
  let current = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'CalendraNewsProxy/1.0 (RSS reader)' },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('Upstream timed out'), { status: 504 });
      throw Object.assign(new Error('Upstream unreachable'), { status: 502 });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      let next;
      try {
        next = new URL(location, current);
      } catch {
        throw Object.assign(new Error('Bad redirect'), { status: 502 });
      }
      if (next.protocol !== 'https:' || !hosts.has(next.hostname)) {
        throw Object.assign(new Error('Redirect to a host that is not allowed'), { status: 502 });
      }
      current = next.href;
      continue;
    }
    return res;
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}

/**
 * Handle one request. `fetchImpl` and `now` are injectable for tests.
 * @param {Request} request
 * @param {{ ALLOWED_ORIGINS?: string }} env
 */
export async function handleRequest(request, env = {}, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = parseOrigins(env);
  const originOk = !origin || allowed.has(origin);

  if (origin && !originOk) {
    return json(403, { error: allowed.size ? 'Origin not allowed' : 'ALLOWED_ORIGINS is not configured' });
  }
  const cors = origin ? corsHeaders(origin) : {};

  if (request.method === 'OPTIONS') {
    // Private Network Access: browsers ask a local-network server for explicit consent before a public
    // page may call it. Consent is only given here, i.e. to an origin already on the allowlist.
    const pna = origin && request.headers.get('Access-Control-Request-Private-Network') === 'true';
    return new Response(null, { status: 204, headers: pna ? { ...cors, 'Access-Control-Allow-Private-Network': 'true' } : cors });
  }
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' }, cors);

  if (url.pathname === '/health') {
    return json(200, { ok: true, sources: [...FEEDS.keys()] }, cors);
  }
  if (url.pathname !== '/feed') return json(404, { error: 'Not found' }, cors);

  const client = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || origin || 'local';
  if (rateLimited(client, now)) return json(429, { error: 'Too many requests' }, { ...cors, 'Retry-After': '60' });

  const id = url.searchParams.get('source');
  const feedUrl = id ? FEEDS.get(id) : null;
  if (!feedUrl) return json(404, { error: 'Unknown source' }, cors);

  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '', 10) || LIMITS.defaultItems, 1), LIMITS.maxItems);
  const key = `${id}|${limit}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < LIMITS.cacheMs) {
    return new Response(hit.body, { status: 200, headers: feedHeaders(cors, true) });
  }

  try {
    const res = await fetchFeed(feedUrl, fetchImpl);
    if (!res.ok) throw Object.assign(new Error(`Upstream HTTP ${res.status}`), { status: 502 });
    const type = res.headers.get('content-type') || '';
    if (!/xml|rss/i.test(type)) throw Object.assign(new Error('Upstream did not return XML'), { status: 502 });
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > LIMITS.maxBytes) throw Object.assign(new Error('Upstream response too large'), { status: 502 });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > LIMITS.maxBytes) throw Object.assign(new Error('Upstream response too large'), { status: 502 });
    const body = trimItems(decodeBody(bytes, type), limit);
    cache.set(key, { at: now, body });
    return new Response(body, { status: 200, headers: feedHeaders(cors, false) });
  } catch (error) {
    return json(error.status || 502, { error: error.message || 'Upstream error' }, cors);
  }
}

function feedHeaders(cors, cached) {
  return {
    ...cors,
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'X-Proxy-Cache': cached ? 'HIT' : 'MISS',
  };
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};
