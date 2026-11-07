/**
 * Parsers for the pages the price snapshot reads (scripts/snapshot-prices.mjs). Pure functions: HTML text in,
 * plain objects out, so they run in Node (the GitHub Action, the optional local proxy) and in tests.
 *
 * Only pages that the site's robots.txt allows are read (checked 2026-11-07):
 *  - Buscapé / Zoom: product and category pages (search pages "?q=" are disallowed, so they are never used).
 *  - Pelando: /busca/<term> (allowed; server-rendered).
 *  - Promobit: /promocoes/recentes/ (search "/buscar" is disallowed).
 *  - Gatry: /promocoes/?q= (no robots rules).
 *  - Hardmob: the Promoções forum list (search.php is disallowed).
 * Store sites that refuse automated requests (Amazon, Mercado Livre, Magalu, Shopee, AliExpress, Casas Bahia,
 * Kabum's API) are represented through the merchant offers Buscapé and Zoom list for each product.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (t) => decodeEntities(String(t ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** "R$ 1.299,90" -> 1299.9 */
export function brl(text) {
  const m = String(text ?? '').match(/R\$\s*([\d.]+(?:,\d{1,2})?)/);
  if (!m) return null;
  return num(Number(m[1].replace(/\./g, '').replace(',', '.')));
}

export function nextData(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Buscapé and Zoom (same platform). Product page: store offers + the site's daily price history. Category page: product list. */
export function parseMosaico(html, { origin = 'https://www.buscape.com.br' } = {}) {
  // Unknown paths are served as a search (canonical "...?q="). Search pages are disallowed by robots.txt: refuse them.
  const canonical = String(html).match(/<link rel="canonical" href="([^"]+)"/)?.[1] || '';
  if (/[?&]q=/.test(canonical)) throw new Error('not a product or category page (it resolves to a search, which robots.txt disallows)');
  const data = nextData(html);
  const state = data?.props?.initialReduxState;
  if (!state) throw new Error('No product data on the page (blocked or layout changed)');
  const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : origin + (u.startsWith('/') ? u : '/' + u));
  const offerList = state.offers?.offerList || state.offers?.displayOffers || [];
  if (offerList.length) {
    const product = state.products?.product?.product || {};
    const offers = offerList
      .map((o) => ({ store: clean(o.sellerName), title: clean(o.name), price: num(o.price ?? o.totalPrice), image: o.imageUrl || '' }))
      .filter((o) => o.price && o.store);
    const histories = Object.values(state.priceHistory?.priceHistory || {});
    const history = (histories[0]?.days || [])
      .map((d) => ({ date: String(d.date).slice(0, 10), price: num(d.price) }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.price);
    return { kind: 'product', name: clean(product.name), image: offers.find((o) => o.image)?.image || '', offers, history };
  }
  const hits = state.hits?.hits || [];
  if (!hits.length) throw new Error('The page listed no offers');
  const offers = hits
    .map((h) => ({ store: clean(h.bestOffer?.merchantName) || `${h.storeCount || '?'} stores`, title: clean(h.name), price: num(h.price), url: abs(h.url), image: h.image || '' }))
    .filter((o) => o.price);
  return { kind: 'category', name: '', image: offers.find((o) => o.image)?.image || '', offers, history: [] };
}

/** Astro island props use [type, value] pairs; type 1 is an array. */
function astroDecode(v) {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    return v[0] === 1 ? v[1].map(astroDecode) : astroDecode(v[1]);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, astroDecode(x)]));
  return v;
}

function findDealList(o, depth = 0) {
  if (depth > 8 || !o || typeof o !== 'object') return null;
  if (Array.isArray(o)) {
    if (o.length && o[0] && typeof o[0] === 'object' && 'title' in o[0] && 'slug' in o[0]) return o;
    for (const v of o) {
      const r = findDealList(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const v of Object.values(o)) {
    const r = findDealList(v, depth + 1);
    if (r) return r;
  }
  return null;
}

/** Pelando search or listing page. */
export function parsePelando(html) {
  const islands = [...String(html).matchAll(/<astro-island[^>]*\sprops="([^"]*)"/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);
  for (const raw of islands) {
    let props;
    try {
      props = astroDecode(JSON.parse(decodeEntities(raw)));
    } catch {
      continue;
    }
    const list = findDealList(props);
    if (!list) continue;
    return list
      .filter((d) => d.status !== 'expired')
      .map((d) => ({
        title: clean(d.title),
        price: num(d.price),
        store: clean(d.store?.name),
        url: `https://www.pelando.com.br/d/${d.slug}`,
        image: String(d.imageUrl || '').replace(/\/0x100\//, '/400x400/'),
        date: d.createdAt || d.firstApprovedAt || '',
        score: Number(d.temperature) || 0,
      }));
  }
  throw new Error('No deal list on the page');
}

/** Promobit recent offers (server-rendered Next.js data). */
export function parsePromobit(html) {
  const props = nextData(html)?.props?.pageProps;
  const offers = [...(props?.serverOffers?.offers || []), ...(props?.serverFeaturedOffers || [])];
  if (!offers.length) throw new Error('No offers on the page');
  const seen = new Set();
  return offers
    .filter((o) => !seen.has(o.offerId) && seen.add(o.offerId))
    .map((o) => ({
      title: clean(o.offerTitle),
      price: num(o.offerPrice),
      store: clean(o.storeName),
      url: `https://www.promobit.com.br/oferta/${o.offerSlug}/`,
      image: o.offerPhoto ? (String(o.offerPhoto).startsWith('http') ? o.offerPhoto : `https://i.promobit.com.br/268${o.offerPhoto}`) : '',
      date: o.offerPublished || '',
      score: Number(o.offerLikes) || 0,
      coupon: o.offerCoupon ? clean(o.offerCoupon) : '',
    }));
}

/** Gatry list or search page. */
export function parseGatry(html) {
  const out = [];
  const blocks = String(html).split(/<article\b/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<h3>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const local = b.match(/href="(\/promocoes\/\d+\/[^"?#]+)/);
    const img = b.match(/<img[^>]+src="(https:\/\/[^"]+)"[^>]*itemprop="image"/);
    out.push({
      title: clean(a[2]),
      price: brl(clean((b.match(/<p class="price">([\s\S]*?)<\/p>/) || [])[1])),
      store: clean((b.match(/class="option-store[^"]*"[^>]*>([\s\S]*?)<\/a>/) || [])[1]).replace(/^Ir para\s+/i, ''),
      url: local ? `https://gatry.com${local[1]}` : a[1],
      image: img && !img[1].includes('gravatar') ? img[1] : '',
      date: '',
      score: 0,
    });
  }
  if (!out.length) throw new Error('No deals on the page');
  return out;
}

/** Hardmob "Promoções" forum list: thread titles with their stated price. */
export function parseHardmob(html) {
  const out = [];
  const re = /<a class="title" href="(threads\/(\d+)[^"?]*)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const pinned = new Set([...String(html).matchAll(/id="thread_prefix_(\d+)"[^>]*>\s*Fixo/g)].map((m) => m[1]));
  let m;
  while ((m = re.exec(String(html)))) {
    const title = clean(m[3]);
    if (!title || pinned.has(m[2])) continue;
    const priced = title.match(/R\$\s*[\d.]+(?:,\d{2})?/) || title.match(/\bpor\s+([\d.]+,\d{2})\b/i);
    const price = priced ? brl(priced[0].startsWith('R$') ? priced[0] : `R$ ${priced[1]}`) : null;
    out.push({ title, price, store: (title.match(/^\[([^\]]{2,30})\]/) || [])[1] || '', url: `https://www.hardmob.com.br/${m[1]}`, image: '', date: '', score: 0 });
  }
  if (!out.length) throw new Error('No threads on the page');
  return out;
}

const fold = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A watchlist item matches when every "all" term and at least one "any" term appear, and no "not" term does. */
export function matchesItem(title, item) {
  const t = ` ${fold(title).replace(/[^a-z0-9]+/g, ' ')} `;
  const has = (w) => t.includes(` ${fold(w).replace(/[^a-z0-9]+/g, ' ').trim()} `) || (w.length > 3 && t.includes(fold(w)));
  const all = item.match?.all || [];
  const any = item.match?.any || [];
  const not = item.match?.not || [];
  return all.every(has) && (!any.length || any.some(has)) && !not.some(has);
}

/** Merge new daily lows into a history list (one entry per date, the lowest wins), sorted, capped. */
export function mergeHistory(history = [], entries = [], { maxDays = 1200 } = {}) {
  const byDate = new Map(history.map((h) => [h.date, { ...h }]));
  for (const e of entries) {
    if (!e?.date || !e.price) continue;
    const prev = byDate.get(e.date);
    if (!prev || e.price < prev.price) byDate.set(e.date, { date: e.date, price: e.price, source: e.source || prev?.source || '' });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-maxDays);
}
