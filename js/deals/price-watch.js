/**
 * Price watch for the Deals page: the products in data/prices/watchlist.json, read from the snapshot the
 * "Snapshot prices" GitHub Action commits (Buscapé, Zoom, Pelando, Promobit, Gatry, Hardmob, Adrenaline).
 * Shows current offers, community deals, the real price history, and a price calendar with a 2026-based
 * simulation for 2027 and 2028. The page only reads files from its own site: no store is contacted from here.
 */
import { esc, formatMoney, timeAgo } from '../core/format.js';
import { SIM_YEARS, BASE_YEAR, CATEGORY_TREND, priceBucket, retailEvents, simulateYear } from './price-sim.js';
import { matchesItem } from './price-parsers.js';

const $ = (id) => document.getElementById(id);
const brl = (n) => (n == null ? '—' : formatMoney(n, 'BRL'));
const SOURCE_NAMES = { buscape: 'Buscapé', zoom: 'Zoom', pelando: 'Pelando', promobit: 'Promobit', gatry: 'Gatry', hardmob: 'Hardmob', adrenaline: 'Adrenaline' };
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const CAT_LABEL = { console: 'Console', gpu: 'Placa de vídeo', storage: 'Armazenamento', tv: 'TV', phone: 'Celular', other: 'Outros' };

let latest = null;
let history = {};
let watchlist = [];
let loadError = '';
let cal = { productId: '', year: BASE_YEAR, selected: '' };

async function getJson(path) {
  const res = await fetch(new URL(path, location.href), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadPriceWatch() {
  try {
    const [l, h, w] = await Promise.all([getJson('data/prices/latest.json'), getJson('data/prices/history.json'), getJson('data/prices/watchlist.json')]);
    latest = l;
    history = h || {};
    watchlist = w?.items || [];
    loadError = '';
    cal.productId ||= latest.products[0]?.id || '';
  } catch (e) {
    loadError = e.message;
  }
  renderPriceWatch();
  renderCalendar();
}

/** The loaded snapshot (sources and products), or null while loading. */
export const snapshotInfo = () => latest;

const productById = (id) => latest?.products.find((p) => p.id === id);
const itemById = (id) => watchlist.find((w) => w.id === id) || {};

// ---------------------------------------------------------------------------
// Charts (inline SVG, theme colours through CSS variables)
// ---------------------------------------------------------------------------

function sparkline(points, { w = 120, h = 34 } = {}) {
  const pts = points.filter((p) => p.price > 0);
  if (pts.length < 2) return '';
  const ys = pts.map((p) => p.price);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * w, h - 3 - ((p.price - min) / span) * (h - 6)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="spark-area" d="${line}L${w},${h}L0,${h}Z"/><path class="spark-line" d="${line}"/></svg>`;
}

/** Line chart with axes. series: [{ points:[{date,price,low?,high?}], cls, band? }] */
function lineChart(series, { w = 760, h = 240, label = 'Price chart' } = {}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return '<p class="status-line">Not enough data for a chart yet.</p>';
  const t = (d) => Date.parse(d + 'T00:00:00Z');
  const xs = all.map((p) => t(p.date));
  const ys = all.flatMap((p) => [p.price, p.low ?? p.price, p.high ?? p.price]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys) * 0.97;
  const y1 = Math.max(...ys) * 1.02;
  const L = 64;
  const R = 12;
  const T = 12;
  const B = 28;
  const X = (d) => L + ((t(d) - x0) / (x1 - x0 || 1)) * (w - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (h - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = y0 + f * (y1 - y0);
    return `<line class="ch-grid" x1="${L}" x2="${w - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ch-tick" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${esc(Math.round(v).toLocaleString('pt-BR'))}</text>`;
  });
  const span = x1 - x0;
  const ticks = [];
  for (let i = 0; i <= 4; i += 1) {
    const d = new Date(x0 + (span * i) / 4).toISOString().slice(0, 10);
    ticks.push(`<text class="ch-tick" x="${X(d).toFixed(1)}" y="${h - 8}" text-anchor="middle">${esc(d.slice(8, 10) + '/' + d.slice(5, 7) + (span > 300 * 864e5 ? '' : ''))}</text>`);
  }
  const paths = series.map((s) => {
    const pts = s.points;
    if (!pts.length) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.price).toFixed(1)}`).join('');
    const band = s.band
      ? `<path class="ch-band" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.high).toFixed(1)}`).join('')}${[...pts].reverse().map((p) => `L${X(p.date).toFixed(1)},${Y(p.low).toFixed(1)}`).join('')}Z"/>`
      : '';
    const area = s.area ? `<path class="ch-area" d="${d}L${X(pts[pts.length - 1].date).toFixed(1)},${h - B}L${X(pts[0].date).toFixed(1)},${h - B}Z"/>` : '';
    return band + area + `<path class="ch-line ${s.cls || ''}" d="${d}"/>`;
  });
  const minP = all.reduce((a, b) => (b.price < a.price ? b : a));
  const marker = `<circle class="ch-min" cx="${X(minP.date).toFixed(1)}" cy="${Y(minP.price).toFixed(1)}" r="4.5"/><text class="ch-min-label" x="${Math.min(w - R - 4, Math.max(L + 4, X(minP.date))).toFixed(1)}" y="${(Y(minP.price) + 18).toFixed(1)}" text-anchor="middle">${esc(brl(minP.price))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${grid.join('')}${ticks.join('')}${paths.join('')}${marker}</svg>`;
}

// ---------------------------------------------------------------------------
// Price watch cards
// ---------------------------------------------------------------------------

function deltaBadge(p) {
  if (!p.lowest || !p.avg40) return '';
  const diff = (p.lowest.price / p.avg40 - 1) * 100;
  if (Math.abs(diff) < 1) return '<span class="pw-delta flat">≈ 40-day average</span>';
  return diff < 0
    ? `<span class="pw-delta down">▼ ${Math.abs(diff).toFixed(0)}% below the 40-day average</span>`
    : `<span class="pw-delta up">▲ ${diff.toFixed(0)}% above the 40-day average</span>`;
}

function sourceDots(p) {
  return Object.entries(p.sources || {})
    .map(([id, s]) => `<span class="src-dot ${s.ok ? (s.count ? 'ok' : 'empty') : s.carried ? 'carried' : 'err'}" title="${esc(SOURCE_NAMES[id] || id)}: ${esc(s.ok ? `${s.count} result(s)` : s.carried ? `refused this run; showing ${s.carried} result(s) seen ${timeAgo(s.seenAt)}` : s.error || 'failed')}">${esc((SOURCE_NAMES[id] || id).slice(0, 2))}</span>`)
    .join('');
}

function productCard(p) {
  const h = history[p.id] || [];
  return `<article class="pw-card" data-product="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}: details, offers and price history">
    <div class="pw-media">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="pw-noimg">${esc(p.name.slice(0, 2))}</span>`}
      <span class="pw-cat">${esc(CAT_LABEL[p.category] || p.category)}</span></div>
    <div class="pw-body">
      <h4>${esc(p.name)}</h4>
      <p class="pw-price">${brl(p.lowest?.price)}</p>
      <p class="pw-store muted">${p.lowest ? `${esc(p.lowest.store)} · via ${esc(SOURCE_NAMES[p.lowest.source] || p.lowest.source)}` : 'No offer found in this snapshot'}</p>
      ${deltaBadge(p)}
      ${sparkline(h.slice(-60))}
      <div class="pw-foot"><span class="src-dots">${sourceDots(p)}</span><span class="muted">${p.offers.length} offers · ${p.community.length} deals</span></div>
    </div>
  </article>`;
}

export function renderPriceWatch() {
  const box = $('price-watch');
  if (!box) return;
  if (!latest) {
    box.innerHTML = loadError
      ? `<p class="status-line warn-text">The price snapshot could not be read (${esc(loadError)}).</p>`
      : '<div class="pw-grid">' + '<div class="pw-card skeleton"></div>'.repeat(4) + '</div>';
    return;
  }
  const s = latest.sources || {};
  $('price-watch-status').innerHTML = `Snapshot ${esc(timeAgo(latest.updatedAt))} · refreshed every 3 hours by a scheduled job · ` +
    Object.entries(s)
      .map(([id, x]) => `<span class="src-chip ${x.ok ? 'ok' : 'err'}" title="${esc(x.ok ? `answered ${x.ok} request(s)` : `refused: ${(x.errors || []).join(', ')}${x.lastOk ? ` · last success ${timeAgo(x.lastOk)}` : ''}`)}">${esc(x.name)} ${x.ok ? '✓' : '✕'}</span>`)
      .join(' ');
  box.innerHTML = `<div class="pw-grid">${latest.products.map(productCard).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Product detail dialog
// ---------------------------------------------------------------------------

let dialog = null;
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'pw-modal';
  document.body.appendChild(dialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-pw-close]')) dialog.close();
    const go = e.target.closest('[data-pw-calendar]');
    if (go) {
      dialog.close();
      cal = { ...cal, productId: go.dataset.pwCalendar, selected: '' };
      renderCalendar();
      $('price-calendar-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  return dialog;
}

function offerRow(o) {
  return `<tr><td>${esc(SOURCE_NAMES[o.source] || o.source)}</td><td><strong>${esc(o.store)}</strong><span class="muted pw-offer-title">${esc(o.title)}</span>${o.seenAt ? `<span class="badge badge-warn">seen ${esc(timeAgo(o.seenAt))}</span>` : ''}</td><td class="num">${brl(o.price)}</td><td><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">Open ↗</a></td></tr>`;
}

function dealCard(d) {
  return `<a class="pw-deal" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">
    ${d.image ? `<img src="${esc(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<span class="pw-deal-noimg">%</span>'}
    <span class="pw-deal-text"><span class="badge badge-muted">${esc(SOURCE_NAMES[d.source] || d.source)}</span>${d.seenAt ? ` <span class="badge badge-warn">seen ${esc(timeAgo(d.seenAt))}</span>` : ''}
      <strong>${esc(d.title)}</strong>
      <span class="muted">${d.price ? esc(brl(d.price)) : 'price in the post'}${d.store ? ` · ${esc(d.store)}` : ''}${d.coupon ? ` · cupom ${esc(d.coupon)}` : ''}</span></span>
  </a>`;
}

export function openProduct(id) {
  const p = productById(id);
  if (!p) return;
  const h = history[p.id] || [];
  const d = ensureDialog();
  const sources = Object.entries(p.sources || {})
    .map(([sid, s]) => `<li><span class="badge ${s.ok ? 'badge-ok' : s.carried ? 'badge-warn' : 'badge-muted'}">${s.ok ? 'OK' : s.carried ? 'Last good copy' : 'Refused'}</span> <strong>${esc(SOURCE_NAMES[sid] || sid)}</strong> <span class="muted">${esc(s.ok ? `${s.count} result(s)` : `${s.error || 'failed'}${s.carried ? ` · showing ${s.carried} result(s) seen ${timeAgo(s.seenAt)}` : ''}`)}</span>${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}</li>`)
    .join('');
  d.innerHTML = `<div class="pw-modal-card">
    <header class="pw-modal-head">
      ${p.image ? `<img src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" />` : ''}
      <div><p class="eyebrow">${esc(CAT_LABEL[p.category] || p.category)}</p><h3>${esc(p.name)}</h3>
        <p class="pw-price">${brl(p.lowest?.price)} <span class="muted">${p.lowest ? `${esc(p.lowest.store)} · via ${esc(SOURCE_NAMES[p.lowest.source])}` : ''}</span></p>${deltaBadge(p)}
        ${p.lowest?.fromHistory ? `<p class="status-line">Today's lowest comes from ${esc(SOURCE_NAMES[p.lowest.source])}'s own price record (a store beyond the offers listed below). <a href="${esc(p.lowest.url)}" target="_blank" rel="noopener noreferrer">See it on ${esc(SOURCE_NAMES[p.lowest.source])} ↗</a></p>` : ''}</div>
      <button type="button" class="ai-close" data-pw-close aria-label="Close">×</button>
    </header>
    <div class="pw-modal-body">
      <section><h4>Price history</h4>
        ${lineChart([{ points: h, cls: 'observed', area: true }], { label: `Price history of ${p.name}` })}
        <p class="status-line">Lowest daily price recorded by Buscapé/Zoom (their own 40-day history) and by each Calendra snapshot. ${h.length} day(s) recorded${p.avg40 ? ` · 40-day average ${esc(brl(p.avg40))}` : ''}.</p>
        <button type="button" class="btn btn-primary btn-sm" data-pw-calendar="${esc(p.id)}">Open the price calendar (2026–2028)</button>
      </section>
      <section><h4>Offers (${p.offers.length})</h4>
        ${p.offers.length ? `<div class="table-wrap"><table class="pw-offers"><thead><tr><th>Source</th><th>Store</th><th class="num">Price</th><th></th></tr></thead><tbody>${p.offers.map(offerRow).join('')}</tbody></table></div>` : '<p class="status-line">No offer in this snapshot.</p>'}
      </section>
      <section><h4>Community deals (${p.community.length})</h4>
        ${p.community.length ? `<div class="pw-deals">${p.community.map(dealCard).join('')}</div>` : '<p class="status-line">No community deal mentions this product right now.</p>'}
      </section>
      <section><h4>Sources for this product</h4><ul class="source-status">${sources}</ul>
        <p class="status-line">Prices are what each site showed at ${esc(new Date(latest.updatedAt).toLocaleString('pt-BR'))}. Confirm on the store before buying.</p></section>
    </div>
  </div>`;
  if (!d.open) d.showModal();
}

// ---------------------------------------------------------------------------
// Price calendar + simulation
// ---------------------------------------------------------------------------

function monthGrid(year, month, byDate, events) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < first.getUTCDay(); i += 1) cells.push('<span class="pc-day pad"></span>');
  for (let d = 1; d <= days; d += 1) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const x = byDate.get(date);
    if (!x) {
      cells.push(`<span class="pc-day">${d}</span>`);
      continue;
    }
    const b = priceBucket(x);
    const sel = cal.selected === date ? ' selected' : '';
    cells.push(`<button type="button" class="pc-day b${b}${x.kind === 'observed' ? ' observed' : ''}${x.event ? ' event' : ''}${sel}" data-pc-day="${date}" title="${esc(`${date}: ${brl(x.price)} (${x.kind === 'observed' ? 'real' : 'simulated'})${x.event ? ' · ' + x.event : ''}`)}">${d}</button>`);
  }
  const ev = events.filter((e) => e.start.getUTCMonth() === month || e.end.getUTCMonth() === month).map((e) => e.name);
  return `<div class="pc-month"><h5>${MONTHS[month]}</h5><div class="pc-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div><div class="pc-days">${cells.join('')}</div>${ev.length ? `<p class="pc-events">${esc([...new Set(ev)].join(' · '))}</p>` : ''}</div>`;
}

export function renderCalendar() {
  const box = $('price-calendar');
  if (!box) return;
  if (!latest) {
    box.innerHTML = loadError ? '' : '<p class="status-line">Loading…</p>';
    return;
  }
  const p = productById(cal.productId) || latest.products[0];
  if (!p) return;
  const sim = simulateYear(history[p.id] || [], { year: cal.year, category: p.category, fallbackPrice: p.lowest?.price });
  const controls = `<div class="pc-controls">
      <label class="pc-select"><span>Product</span><select id="pc-product">${latest.products.map((x) => `<option value="${esc(x.id)}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="seg pc-years" role="radiogroup" aria-label="Year">${SIM_YEARS.map((y) => `<button type="button" role="radio" aria-checked="${y === cal.year}" class="${y === cal.year ? 'active' : ''}" data-pc-year="${y}">${y}${y === BASE_YEAR ? ' · base' : ''}</button>`).join('')}</div>
    </div>`;
  if (!sim) {
    box.innerHTML = controls + '<p class="status-line">No price recorded for this product yet, so nothing can be simulated.</p>';
    return;
  }
  const byDate = new Map(sim.days.map((d) => [d.date, d]));

  const events = retailEvents(cal.year);
  const sel = cal.selected && byDate.get(cal.selected);
  const trend = CATEGORY_TREND[p.category] ?? CATEGORY_TREND.other;
  const observedPts = sim.days.filter((d) => d.kind === 'observed');
  box.innerHTML = `${controls}
    <div class="pc-summary">
      <div class="pc-stat"><span>Average ${cal.year}</span><strong>${brl(sim.average)}</strong></div>
      <div class="pc-stat good"><span>Cheapest day</span><strong>${brl(sim.min.price)}</strong><em>${esc(sim.min.date.split('-').reverse().join('/'))}${sim.min.event ? ` · ${esc(sim.min.event)}` : ''}</em></div>
      <div class="pc-stat bad"><span>Most expensive</span><strong>${brl(sim.max.price)}</strong><em>${esc(sim.max.date.split('-').reverse().join('/'))}${sim.max.event ? ` · ${esc(sim.max.event)}` : ''}</em></div>
      <div class="pc-stat"><span>Real days</span><strong>${sim.observedDays}</strong><em>${cal.year === BASE_YEAR ? 'the rest is estimated' : 'projection only'}</em></div>
    </div>
    <div class="pc-day-detail" aria-live="polite">${sel ? `<strong>${esc(sel.date.split('-').reverse().join('/'))}</strong> · ${brl(sel.price)} <span class="badge ${sel.kind === 'observed' ? 'badge-ok' : 'badge-muted'}">${sel.kind === 'observed' ? 'Real price' : `Simulated · range ${brl(sel.low)} – ${brl(sel.high)}`}</span>${sel.event ? ` <span class="badge badge-warn">${esc(sel.event)}</span>` : ''}` : 'Tap a day to see its price.'}</div>
    <div class="pc-legend"><span class="muted">Great day to buy</span><i class="b0"></i><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i><span class="muted">Better wait</span><span class="muted">(compared with that day's normal price)</span><span class="pc-legend-obs">● real price</span><span class="pc-legend-ev">▪ sales event</span></div>
    <div class="pc-year">${Array.from({ length: 12 }, (_, m) => monthGrid(cal.year, m, byDate, events)).join('')}</div>
    <h4>${cal.year} price curve</h4>
    ${lineChart(
      [
        { points: sim.days.filter((d) => d.kind === 'simulated'), cls: 'simulated', band: true },
        ...(observedPts.length ? [{ points: observedPts, cls: 'observed' }] : []),
      ],
      { label: `Simulated ${cal.year} prices for ${p.name}` }
    )}
    <div class="pc-best"><h4>Best times to buy in ${cal.year}</h4>
      <ol>${sim.bestWindows.slice(0, 5).map((w) => `<li><strong>${esc(w.name)}</strong> <span class="muted">${esc(w.start.slice(8) + '/' + w.start.slice(5, 7))}–${esc(w.end.slice(8) + '/' + w.end.slice(5, 7))}</span> · ~${brl(w.price)} <span class="pw-delta down">−${w.saving}% vs average</span></li>`).join('')}</ol></div>
    <details class="how-details"><summary>How this simulation works</summary>
      <p class="status-line">Base year ${BASE_YEAR}: the real daily lows we have (${sim.reference.observedDays} day(s) from Buscapé/Zoom and the snapshots) set a reference of ${brl(sim.reference.price)} around ${esc(sim.reference.date)}, with sales-event effects removed. Every other day = reference × category trend (${(trend * 100).toFixed(0)}% a year for ${esc(CAT_LABEL[p.category] || p.category)}) × the Brazilian retail calendar of that year (Black Friday on the last Friday of November, Prime Day in mid-July, Dia do Consumidor, Dia das Mães/Pais, 11.11, Natal…). The shaded band widens with distance from the data (observed volatility ${(sim.reference.volatility * 100).toFixed(0)}%). It is a planning aid, not a forecast: launches, exchange rates and shortages are not modelled.</p>
    </details>`;
}

// ---------------------------------------------------------------------------
// Search integration and events
// ---------------------------------------------------------------------------

/** Watch products and community deals (from every source in the snapshot) that match a free-text query. */
export function priceMatches(query) {
  if (!latest || !query) return { products: [], deals: [] };
  const words = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter((w) => w.length >= 2);
  const hay = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const products = latest.products.filter((p) => {
    const item = itemById(p.id);
    const text = hay(`${p.name} ${item.term || ''} ${(item.match?.any || []).join(' ')}`);
    return words.every((w) => text.includes(w)) || matchesItem(query, item);
  });
  const seen = new Set();
  const deals = latest.products
    .flatMap((p) => [...p.community, ...p.offers.map((o) => ({ ...o, offer: true }))])
    .filter((d) => words.every((w) => hay(d.title).includes(w)) && !seen.has(d.url + d.title) && seen.add(d.url + d.title))
    .sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12))
    .slice(0, 12);
  return { products, deals };
}

export function priceMatchesHtml(query) {
  const { products, deals } = priceMatches(query);
  if (!latest) return '';
  if (!products.length && !deals.length) return `<p class="status-line">Nothing in the price watch matches "${esc(query)}". The watch follows ${latest.products.length} products (edit <code>data/prices/watchlist.json</code> to add more).</p>`;
  return `${products.length ? `<div class="pw-grid compact">${products.map(productCard).join('')}</div>` : ''}
    ${deals.length ? `<div class="pw-deals">${deals.map((d) => (d.offer ? dealCard({ ...d, title: `${d.store}: ${d.title}` }) : dealCard(d))).join('')}</div>` : ''}
    <p class="status-line">From the snapshot of ${esc(timeAgo(latest.updatedAt))} (Buscapé, Zoom and the deal communities).</p>`;
}

export function initPriceWatch() {
  // An image the store's CDN does not deliver becomes a styled placeholder instead of a broken icon.
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.closest('.pw-media, .pw-deal, .pw-modal-head')) return;
      const ph = document.createElement('span');
      ph.className = img.closest('.pw-deal') ? 'pw-deal-noimg' : 'pw-noimg';
      ph.textContent = img.closest('.pw-deal') ? '%' : (img.closest('[data-product]')?.querySelector('h4')?.textContent || '').slice(0, 2);
      if (img.closest('.pw-modal-head')) img.remove();
      else img.replaceWith(ph);
    },
    true
  );
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-product]');
    if (card) return openProduct(card.dataset.product);
    const y = e.target.closest('[data-pc-year]');
    if (y) {
      cal = { ...cal, year: Number(y.dataset.pcYear), selected: '' };
      return renderCalendar();
    }
    const day = e.target.closest('[data-pc-day]');
    if (day) {
      cal = { ...cal, selected: day.dataset.pcDay };
      return renderCalendar();
    }
  });
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('[data-product]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openProduct(card.dataset.product);
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'pc-product') {
      cal = { ...cal, productId: e.target.value, selected: '' };
      renderCalendar();
    }
  });
  renderPriceWatch();
  return loadPriceWatch();
}
