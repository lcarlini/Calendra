// Price snapshot for the Deals page. Run by .github/workflows/snapshot-prices.yml (or by hand: node scripts/snapshot-prices.mjs).
// Reads data/prices/watchlist.json, visits only robots.txt-allowed pages (see js/deals/price-parsers.js), and writes:
//   data/prices/latest.json   current offers per product, community deals, and the status of every source
//   data/prices/history.json  one lowest price per product per day (Buscapé/Zoom's own 40-day history + each run)
import fs from 'node:fs';
import path from 'node:path';
import { matchesItem, mergeHistory, parseGatry, parseHardmob, parseMosaico, parsePelando, parsePromobit, brl, decodeEntities } from '../js/deals/price-parsers.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const DIR = path.join(ROOT, 'data', 'prices');
const UA = 'Mozilla/5.0 (compatible; CalendraPriceCheck/1.0; +https://lcarlini.github.io/Calendra/)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map();

async function get(url, { timeoutMs = 30000 } = {}) {
  const host = new URL(url).host;
  const wait = 1500 - (Date.now() - (lastHit.get(host) || 0));
  if (wait > 0) await sleep(wait); // be polite: at most one request per host every 1.5 s
  lastHit.set(host, Date.now());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'pt-BR,pt;q=0.9' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8';
    const text = new TextDecoder(charset.toLowerCase() === 'iso-8859-1' ? 'latin1' : charset).decode(buf);
    if (/<title>Just a moment|cf-chl|account-verification/i.test(text.slice(0, 5000))) throw new Error('bot challenge');
    return text;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timeout' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};

const SOURCES = {
  buscape: { name: 'Buscapé', kind: 'comparison' },
  zoom: { name: 'Zoom', kind: 'comparison' },
  pelando: { name: 'Pelando', kind: 'community' },
  promobit: { name: 'Promobit', kind: 'community' },
  gatry: { name: 'Gatry', kind: 'community' },
  hardmob: { name: 'Hardmob', kind: 'community' },
  adrenaline: { name: 'Adrenaline', kind: 'community' },
};

function adrenalineDeals() {
  const xml = fs.readFileSync(path.join(ROOT, 'data', 'deals-adrenaline-ofertas.xml'), 'utf8');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (t) => decodeEntities((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
    const title = tag('title');
    return { title, price: brl(title), store: '', url: tag('link'), image: '', date: tag('pubDate'), score: 0 };
  });
}

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const { items } = readJson(path.join(DIR, 'watchlist.json'), { items: [] });
  const history = readJson(path.join(DIR, 'history.json'), {});
  const previous = readJson(path.join(DIR, 'latest.json'), { products: [], sources: {} });
  const prevProduct = (id) => previous.products?.find((p) => p.id === id);
  const status = Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { ...s, ok: 0, failed: 0, errors: [] }]));
  const note = (id, ok, error) => {
    if (ok) status[id].ok += 1;
    else {
      status[id].failed += 1;
      if (error && !status[id].errors.includes(error)) status[id].errors.push(error);
    }
  };

  // Shared community lists (read once per run).
  const shared = {};
  for (const [id, url, parse] of [
    ['promobit', 'https://www.promobit.com.br/promocoes/recentes/', parsePromobit],
    ['hardmob', 'https://www.hardmob.com.br/forums/407-Promocoes', parseHardmob],
    ['adrenaline', null, adrenalineDeals],
  ]) {
    try {
      shared[id] = url ? parse(await get(url)) : parse();
      note(id, true);
    } catch (e) {
      shared[id] = [];
      note(id, false, e.message);
    }
  }

  const products = [];
  for (const item of items) {
    const offers = [];
    const community = [];
    const sources = {};
    let image = '';
    let name = '';
    let siteHistory = [];

    const pages = item.pages || [item.page];
    for (const [id, origin] of [['buscape', 'https://www.buscape.com.br'], ['zoom', 'https://www.zoom.com.br']]) {
      let count = 0;
      const errors = [];
      for (const page of pages) {
        const url = origin + page;
        try {
          const r = parseMosaico(await get(url), { origin });
          // Category pages list many products: keep the ones that are this item.
          const kept = r.kind === 'category' ? r.offers.filter((o) => matchesItem(o.title, item)) : r.offers;
          offers.push(...kept.map((o) => ({ source: id, store: o.store, title: o.title, price: o.price, url: o.url || url, image: o.image || '' })));
          siteHistory = siteHistory.concat(r.history.map((h) => ({ ...h, source: id })));
          image ||= kept.find((o) => o.image)?.image || (r.kind === 'product' ? r.image : '');
          name ||= r.name;
          count += kept.length;
        } catch (e) {
          errors.push(e.message);
        }
      }
      const url = origin + pages[0];
      if (count || errors.length < pages.length) {
        sources[id] = { ok: true, count, url };
        note(id, true);
      } else {
        sources[id] = { ok: false, error: errors[0], url };
        note(id, false, errors[0]);
      }
    }

    const slug = item.term.trim().toLowerCase().replace(/\s+/g, '-');
    for (const [id, url, parse] of [
      ['pelando', `https://www.pelando.com.br/busca/${encodeURIComponent(slug)}`, parsePelando],
      ['gatry', `https://gatry.com/promocoes/?q=${encodeURIComponent(item.term)}`, parseGatry],
    ]) {
      try {
        const found = parse(await get(url)).filter((d) => matchesItem(d.title, item));
        community.push(...found.map((d) => ({ ...d, source: id })));
        sources[id] = { ok: true, count: found.length, url };
        note(id, true);
      } catch (e) {
        sources[id] = { ok: false, error: e.message, url };
        note(id, false, e.message);
      }
    }
    for (const id of ['promobit', 'hardmob', 'adrenaline']) {
      const found = (shared[id] || []).filter((d) => matchesItem(d.title, item));
      community.push(...found.map((d) => ({ ...d, source: id })));
      sources[id] = status[id].failed && !shared[id]?.length ? { ok: false, error: status[id].errors[0] } : { ok: true, count: found.length };
    }

    // A source that refused this run keeps its last good results, marked with when they were seen.
    const before = prevProduct(item.id);
    for (const [id, s] of Object.entries(sources)) {
      if (s.ok || !before) continue;
      const seenAt = before.sources?.[id]?.seenAt || previous.updatedAt;
      if (!seenAt || now - new Date(seenAt) > 7 * 864e5) continue; // older than a week: drop rather than mislead
      const keep = (list) => (list || []).filter((x) => x.source === id).map((x) => ({ ...x, seenAt: x.seenAt || seenAt }));
      const old = [...keep(before.offers), ...keep(before.community)];
      if (!old.length) continue;
      if (SOURCES[id].kind === 'comparison') offers.push(...keep(before.offers));
      else community.push(...keep(before.community));
      s.carried = old.length;
      s.seenAt = seenAt;
    }
    for (const s of Object.values(sources)) if (s.ok) s.seenAt = now.toISOString();

    offers.sort((a, b) => a.price - b.price);
    let lowest = offers[0] || null;
    // Buscapé/Zoom's own history includes today's lowest price over all stores, even ones beyond the first page
    // of offers the page embeds. When it is lower than every offer we read, it is the real current lowest.
    const todayLow = siteHistory.filter((h) => h.date === today).sort((a, b) => a.price - b.price)[0];
    if (todayLow && (!lowest || todayLow.price < lowest.price)) {
      lowest = { source: todayLow.source, store: `Lowest listed on ${SOURCES[todayLow.source].name}`, title: name || item.name, price: todayLow.price, url: (todayLow.source === 'zoom' ? 'https://www.zoom.com.br' : 'https://www.buscape.com.br') + pages[0], fromHistory: true };
    }
    const prev = history[item.id] || [];
    const runEntry = lowest ? [{ date: today, price: lowest.price, source: lowest.source }] : [];
    history[item.id] = mergeHistory(prev, [...siteHistory, ...runEntry]);
    const last40 = history[item.id].filter((h) => (now - new Date(h.date)) / 864e5 <= 40);
    const avg40 = last40.length ? Math.round((last40.reduce((s, h) => s + h.price, 0) / last40.length) * 100) / 100 : null;

    products.push({
      id: item.id,
      name: item.name,
      category: item.category,
      listingName: name,
      image,
      buscapeUrl: 'https://www.buscape.com.br' + item.page,
      lowest,
      avg40,
      offers: offers.slice(0, 16),
      community: community.filter((d) => d.title).sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12)).slice(0, 12),
      sources,
    });
    console.log(`${item.id}: ${offers.length} offers, ${community.length} community deals, lowest ${lowest ? lowest.price : '-'}; ` + Object.entries(sources).map(([k, v]) => `${k}=${v.ok ? v.count : 'ERR ' + v.error}`).join(' '));
  }

  for (const [id, s] of Object.entries(status)) {
    s.lastOk = s.ok ? now.toISOString() : previous.sources?.[id]?.lastOk || '';
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify({ updatedAt: now.toISOString(), sources: status, products }, null, 1) + '\n');
  fs.writeFileSync(path.join(DIR, 'history.json'), JSON.stringify(history) + '\n');
  const failed = Object.values(status).filter((s) => !s.ok);
  console.log(failed.length ? `Sources with no success: ${failed.map((s) => s.name).join(', ')}` : 'Every source answered at least once.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
