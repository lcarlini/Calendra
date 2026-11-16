// Community deal pool for the Deals page. Run by .github/workflows/snapshot-feeds.yml every 30 minutes
// (or by hand: node scripts/snapshot-deals.mjs). Writes data/deals/community.json: the recent deals of several
// Brazilian deal communities, so the page can search them from the same origin (no CORS relay, no rate limit).
//
// Only routes the sites allow are read (robots.txt checked 2026-11-16), one request per host every 1.5 s:
//   Gatry          public JSON API /v1/promotions (robots.txt "Allow: /v1/")
//   Promobit       /promocoes/recentes/ and category pages (/buscar is disallowed and never used)
//   Oferta Esperta /feed (RSS)
//   Pelando        /recentes (allowed; it often refuses cloud servers, then its last good deals are kept)
// Each run is merged with the previous pool, so the pool covers about a week, not only the newest page.
import fs from 'node:fs';
import path from 'node:path';
import { gatryApiUrl, parseGatryApi, parseOfertaEsperta, parsePelando, parsePromobit } from '../js/deals/price-parsers.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT = path.join(ROOT, 'data', 'deals', 'community.json');
const UA = 'Mozilla/5.0 (compatible; CalendraDealSnapshot/1.0; +https://lcarlini.github.io/Calendra/)';
const KEEP_DAYS = 7;
const MAX_DEALS = 1200;
const GATRY_PAGES = 15;
const PROMOBIT_PAGES = [
  'recentes', 'em-alta', 'menor-preco', 'informatica', 'games', 'smartphones-tablets-e-telefones', 'eletronicos-audio-e-video',
  'eletrodomesticos', 'eletroportateis', 'casa-e-construcao', 'utensilios-domesticos', 'supermercado-e-delivery', 'perfumes-e-beleza',
  'esporte-e-lazer', 'brinquedos-e-hobbies', 'livros-ebooks-e-ereaders',
];

export const SOURCES = {
  gatry: { name: 'Gatry', homepage: 'https://gatry.com/' },
  promobit: { name: 'Promobit', homepage: 'https://www.promobit.com.br/' },
  ofertaesperta: { name: 'Oferta Esperta', homepage: 'https://www.ofertaesperta.com/' },
  pelando: { name: 'Pelando', homepage: 'https://www.pelando.com.br/' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map();

async function get(url, { timeoutMs = 30000, accept = 'text/html,application/xhtml+xml' } = {}) {
  const host = new URL(url).host;
  const wait = 1500 - (Date.now() - (lastHit.get(host) || 0));
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/<title>Just a moment|cf-chl/i.test(text.slice(0, 5000))) throw new Error('bot challenge');
    return text;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timeout' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const iso = (d) => {
  const t = Date.parse(String(d || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
};

/** One deal in the pool. `id` is the deal's own address, so the same deal seen again is updated, not repeated. */
export function poolDeal(d, source, seenAt) {
  return {
    id: d.url,
    source,
    title: d.title,
    price: d.price ?? null,
    oldPrice: d.oldPrice ?? null,
    store: d.store || '',
    url: d.url,
    image: d.image || '',
    date: iso(d.date) || seenAt,
    coupon: d.coupon || '',
    category: d.category || '',
    seenAt,
  };
}

/** New deals replace older copies of themselves; deals older than KEEP_DAYS go; newest first, capped. */
export function mergePool(previous = [], fresh = [], { now = Date.now(), keepDays = KEEP_DAYS, max = MAX_DEALS } = {}) {
  const byId = new Map(previous.map((d) => [d.id, d]));
  for (const d of fresh) {
    const old = byId.get(d.id);
    byId.set(d.id, { ...old, ...d, seenAt: old?.seenAt || d.seenAt });
  }
  const cutoff = now - keepDays * 864e5;
  return [...byId.values()]
    .filter((d) => d.title && d.url && Date.parse(d.date || d.seenAt) >= cutoff)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, max);
}

async function main() {
  const now = new Date();
  const seenAt = now.toISOString();
  let previous = { deals: [], sources: {} };
  try {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const status = Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { ...s, ok: 0, failed: 0, count: 0, errors: [] }]));
  const fresh = [];
  const read = async (id, url, parse, opts) => {
    try {
      const list = parse(await get(url, opts));
      fresh.push(...list.map((d) => poolDeal(d, id, seenAt)));
      status[id].ok += 1;
      status[id].count += list.length;
    } catch (e) {
      status[id].failed += 1;
      if (!status[id].errors.includes(e.message)) status[id].errors.push(e.message);
    }
  };

  for (let page = 0; page < GATRY_PAGES; page += 1) await read('gatry', gatryApiUrl({ offset: page * 10 }), parseGatryApi, { accept: 'application/json' });
  for (const page of PROMOBIT_PAGES) await read('promobit', `https://www.promobit.com.br/promocoes/${page}/`, parsePromobit);
  await read('ofertaesperta', 'https://www.ofertaesperta.com/feed/', parseOfertaEsperta, { accept: 'application/rss+xml, application/xml' });
  await read('pelando', 'https://www.pelando.com.br/recentes', parsePelando);

  for (const [id, s] of Object.entries(status)) s.lastOk = s.ok ? seenAt : previous.sources?.[id]?.lastOk || '';
  const deals = mergePool(previous.deals, fresh, { now: now.getTime() });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // One deal per line keeps the file's git history small (a run changes a few lines, not the whole file).
  const body = `{"updatedAt":${JSON.stringify(seenAt)},\n"sources":${JSON.stringify(status)},\n"deals":[\n${deals.map((d) => JSON.stringify(d)).join(',\n')}\n]}\n`;
  fs.writeFileSync(OUT, body);
  console.log(`${fresh.length} deals read this run, ${deals.length} in the pool. ` + Object.entries(status).map(([k, v]) => `${k}=${v.ok ? v.count : 'ERR ' + v.errors.join('/')}`).join(' '));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
