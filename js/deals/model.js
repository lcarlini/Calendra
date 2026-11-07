/**
 * Deals data model: saved products with locally observed prices, alerts, coupons and the US price
 * comparison. Everything is stored in this browser (calendra.deals.v1) and every number comes from
 * something the user typed or a labelled source. No price history is ever invented.
 */
import { readJSON, writeJSON } from '../core/store.js';
import { hashId } from '../news/normalize.js';

export const DEALS_KEY = 'calendra.deals.v1';

export function emptyState() {
  return { version: 1, recentSearches: [], savedSearches: [], items: [], coupons: [], savedThreads: [], hiddenThreads: [], alerts: [], excludeWords: [] };
}

export function loadDeals(storage) {
  const saved = readJSON(DEALS_KEY, {}, storage);
  const base = emptyState();
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key])) base[key] = Array.isArray(saved[key]) ? saved[key] : [];
  }
  return base;
}

export const saveDeals = (state, storage) => writeJSON(DEALS_KEY, state, storage);

/** Accepts "1.299,90", "1299,90", "1299.90", "R$ 1.299" and returns a number or null. */
export function parseMoneyInput(text) {
  let s = String(text ?? '').replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(',') && s.includes('.')) {
    // the later separator is the decimal one
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const pad = (n) => String(n).padStart(2, '0');
export const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// --- Saved products ------------------------------------------------------------------

export function newItem({ title, url = '', store = '', country = 'BR', currency = 'BRL', condition = 'new', note = '' }, now = new Date()) {
  const t = String(title || '').trim();
  if (!t) return null;
  const safeUrl = /^https?:\/\//i.test(url) ? url : '';
  return {
    id: hashId(`${t}|${now.getTime()}|${Math.random()}`),
    title: t.slice(0, 160),
    url: safeUrl,
    store: String(store).trim().slice(0, 60),
    country: country === 'US' ? 'US' : 'BR',
    currency: currency === 'USD' ? 'USD' : 'BRL',
    condition: ['new', 'used', 'refurbished'].includes(condition) ? condition : 'new',
    note: String(note).trim().slice(0, 300),
    createdAt: now.toISOString(),
    observations: [],
    alert: { targetPrice: null, dropPercent: null },
    us: null,
  };
}

/** Add a price you observed. Returns the new item (immutably); same-day entries replace each other. */
export function recordPrice(item, price, date = isoToday()) {
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0) return item;
  const rest = item.observations.filter((o) => o.date !== date);
  const observations = [...rest, { date, price: value }].sort((a, b) => a.date.localeCompare(b.date));
  return { ...item, observations };
}

/** Statistics over the observations you entered. Needs at least one point; a trend needs two. */
export function priceStats(observations) {
  if (!observations.length) return null;
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const prices = sorted.map((o) => o.price);
  const current = sorted.at(-1);
  const previous = sorted.length > 1 ? sorted.at(-2) : null;
  let lastDrop = null;
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    if (sorted[i].price < sorted[i - 1].price) {
      lastDrop = { date: sorted[i].date, from: sorted[i - 1].price, to: sorted[i].price, percent: ((sorted[i - 1].price - sorted[i].price) / sorted[i - 1].price) * 100 };
      break;
    }
  }
  return {
    count: sorted.length,
    current: current.price,
    currentDate: current.date,
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    average: prices.reduce((a, b) => a + b, 0) / prices.length,
    trend: previous ? (current.price < previous.price ? 'down' : current.price > previous.price ? 'up' : 'flat') : null,
    lastDrop,
    origin: 'locally observed (entered by you)',
  };
}

/**
 * Alerts triggered by a newly recorded price. Alerts only fire from prices you enter:
 * there is no automatic price checking because no permitted source supports it.
 */
export function evaluateAlerts(item, newPrice, previousObservations = item.observations) {
  const messages = [];
  const { targetPrice, dropPercent } = item.alert || {};
  if (targetPrice != null && newPrice <= targetPrice) {
    messages.push({ kind: 'target', text: `${item.title}: price ${newPrice.toFixed(2)} reached your target of ${targetPrice.toFixed(2)}.` });
  }
  if (dropPercent != null && previousObservations.length) {
    const highest = Math.max(...previousObservations.map((o) => o.price));
    const drop = ((highest - newPrice) / highest) * 100;
    if (highest > 0 && drop >= dropPercent) {
      messages.push({ kind: 'drop', text: `${item.title}: ${drop.toFixed(1)}% below the highest price you recorded (${highest.toFixed(2)}).` });
    }
  }
  if (item.us) {
    const cmp = compareUs({ ...item.us, brPrice: newPrice });
    if (cmp.total != null && newPrice <= cmp.total) {
      messages.push({ kind: 'below-us', text: `${item.title}: the Brazilian price is at or below your US estimate (${cmp.total.toFixed(2)} BRL).` });
    }
  }
  return messages;
}

export function addAlertLog(state, messages, now = new Date()) {
  const entries = messages.map((m, i) => ({ id: hashId(`${m.text}|${now.getTime()}|${i}`), at: now.toISOString(), text: m.text, kind: m.kind, read: false }));
  return { ...state, alerts: [...entries, ...state.alerts].slice(0, 100) };
}

// --- Coupons -----------------------------------------------------------------------------

export function newCoupon({ store, code, description = '', conditions = '', minPurchase = '', expiresOn = '', url = '' }, now = new Date()) {
  const s = String(store || '').trim();
  const c = String(code || '').trim();
  if (!s || !c) return null;
  return {
    id: hashId(`${s}|${c}|${now.getTime()}|${Math.random()}`),
    store: s.slice(0, 60),
    code: c.slice(0, 60),
    description: String(description).trim().slice(0, 200),
    conditions: String(conditions).trim().slice(0, 300),
    minPurchase: parseMoneyInput(minPurchase),
    expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? expiresOn : '',
    url: /^https?:\/\//i.test(url) ? url : '',
    source: 'manual entry',
    verification: 'unverified',
    addedAt: now.toISOString().slice(0, 10),
  };
}

/** expired / expires-today / valid (with days left) / no-expiry. Never says a coupon "works". */
export function couponStatus(coupon, today = isoToday()) {
  if (!coupon.expiresOn) return { state: 'no-expiry', label: 'No expiry date entered' };
  if (coupon.expiresOn < today) return { state: 'expired', label: `Expired on ${coupon.expiresOn}` };
  if (coupon.expiresOn === today) return { state: 'expires-today', label: 'Expires today' };
  const days = Math.round((Date.parse(coupon.expiresOn) - Date.parse(today)) / 86400000);
  return { state: 'valid', label: `Valid until ${coupon.expiresOn} (${days} day${days === 1 ? '' : 's'} left, as entered)` };
}

// --- US price comparison -----------------------------------------------------------------

/**
 * Compare a Brazilian price with a US listing. Only the components the user supplies are included,
 * and the result says which ones are missing: it is an estimate from your inputs, not a landed cost.
 * Inputs: priceUsd, shippingUsd, dutyPercent, taxPercent, otherBrl, rate (BRL per USD), brPrice.
 * Duty applies to (product + shipping); tax applies to (product + shipping + duty).
 */
export function compareUs({ priceUsd, shippingUsd = null, dutyPercent = null, taxPercent = null, otherBrl = null, rate, brPrice = null }) {
  const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const n = (v) => Number(v);
  if (!has(priceUsd) || !has(rate) || n(rate) <= 0) {
    return { total: null, components: [], missing: ['US price', 'exchange rate'].filter((_, i) => (i === 0 ? !has(priceUsd) : !has(rate) || n(rate) <= 0)), complete: false, note: 'Enter the US price and an exchange rate.' };
  }
  const components = [];
  const product = n(priceUsd) * n(rate);
  components.push({ label: 'Product', usd: n(priceUsd), brl: product });
  let base = product;
  if (has(shippingUsd)) {
    const ship = n(shippingUsd) * n(rate);
    components.push({ label: 'Shipping', usd: n(shippingUsd), brl: ship });
    base += ship;
  }
  let duty = 0;
  if (has(dutyPercent)) {
    duty = (base * n(dutyPercent)) / 100;
    components.push({ label: `Import duty (${n(dutyPercent)}%, your input)`, brl: duty });
  }
  let tax = 0;
  if (has(taxPercent)) {
    tax = ((base + duty) * n(taxPercent)) / 100;
    components.push({ label: `Tax (${n(taxPercent)}%, your input)`, brl: tax });
  }
  let other = 0;
  if (has(otherBrl)) {
    other = n(otherBrl);
    components.push({ label: 'Other costs (your input)', brl: other });
  }
  const total = base + duty + tax + other;
  const missing = [];
  if (!has(shippingUsd)) missing.push('shipping');
  if (!has(dutyPercent)) missing.push('import duty');
  if (!has(taxPercent)) missing.push('tax');
  const result = { total, components, missing, complete: missing.length === 0, rate: n(rate) };
  result.note = missing.length
    ? `Not included because you did not enter them: ${missing.join(', ')}. This is not the final cost of importing.`
    : 'Estimate built only from the values you entered; actual costs at import may differ.';
  if (has(brPrice) && n(brPrice) > 0) {
    const diff = n(brPrice) - total;
    result.versus = { brPrice: n(brPrice), differenceBrl: diff, percent: (diff / total) * 100 };
  }
  return result;
}

export function addToList(list, value, max = 12) {
  const v = String(value || '').trim();
  if (!v) return list;
  return [v, ...list.filter((x) => x !== v)].slice(0, max);
}
