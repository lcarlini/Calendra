/**
 * Price calendar simulation. 2026 is the base year: real daily prices where we have them (Buscapé/Zoom's own
 * price history plus every snapshot), and an estimate for the other days. 2027 and 2028 are projections of
 * that base: a category trend (products get cheaper as they age) times the Brazilian retail calendar of the
 * target year (Black Friday, Prime Day, Dia do Consumidor, Natal...). Everything simulated is labelled as such.
 */

export const BASE_YEAR = 2026;
export const SIM_YEARS = [2026, 2027, 2028];

/** Yearly price change by category (negative = cheaper each year). Rough market averages, not forecasts. */
export const CATEGORY_TREND = { console: -0.06, gpu: -0.12, storage: -0.1, tv: -0.09, phone: -0.16, other: -0.07 };

/** How strongly each category reacts to sales events (1 = the event's base effect). */
const EVENT_SENSITIVITY = { console: 0.9, gpu: 1.1, storage: 1.2, tv: 1.15, phone: 0.9, other: 1 };

const DAY = 864e5;
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

/** n-th given weekday (0=Sunday) of a month, UTC. */
export function nthWeekday(year, month, weekday, n) {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/** Last given weekday of a month. */
function lastWeekday(year, month, weekday) {
  const last = utc(year, month + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

/**
 * Retail events that move prices in Brazil, placed on the target year's calendar.
 * effect: fractional change at the peak (negative = discount). The shape ramps in and out over the window.
 */
export function retailEvents(year) {
  const blackFriday = lastWeekday(year, 10, 5); // last Friday of November
  const mothers = nthWeekday(year, 4, 0, 2);
  const fathers = nthWeekday(year, 7, 0, 2);
  const primeDay = nthWeekday(year, 6, 2, 2); // Amazon Prime Day in Brazil: mid-July (2nd Tuesday, two days)
  return [
    { id: 'jan-sale', name: 'Liquidação de janeiro', start: utc(year, 0, 2), end: utc(year, 0, 15), effect: -0.04 },
    { id: 'consumer-day', name: 'Dia do Consumidor', start: utc(year, 2, 10), end: utc(year, 2, 16), effect: -0.06 },
    { id: 'mothers-day', name: 'Dia das Mães', start: addDays(mothers, -10), end: mothers, effect: -0.03 },
    { id: 'prime-day', name: 'Prime Day', start: primeDay, end: addDays(primeDay, 1), effect: -0.08 },
    { id: 'fathers-day', name: 'Dia dos Pais', start: addDays(fathers, -10), end: fathers, effect: -0.03 },
    { id: 'semana-brasil', name: 'Semana do Brasil', start: utc(year, 8, 1), end: utc(year, 8, 12), effect: -0.05 },
    { id: 'kids-day', name: 'Dia das Crianças', start: utc(year, 9, 5), end: utc(year, 9, 12), effect: -0.03 },
    { id: '11-11', name: '11.11', start: utc(year, 10, 10), end: utc(year, 10, 12), effect: -0.05 },
    { id: 'pre-black-friday', name: 'Esquenta Black Friday', start: utc(year, 10, 1), end: addDays(blackFriday, -1), effect: -0.04 },
    { id: 'black-friday', name: 'Black Friday', start: addDays(blackFriday, -1), end: addDays(blackFriday, 2), effect: -0.14 },
    { id: 'cyber-monday', name: 'Cyber Monday', start: addDays(blackFriday, 3), end: addDays(blackFriday, 3), effect: -0.1 },
    { id: 'christmas', name: 'Natal (prices rise)', start: utc(year, 11, 10), end: utc(year, 11, 24), effect: 0.03 },
    { id: 'after-christmas', name: 'Pós-Natal', start: utc(year, 11, 26), end: utc(year, 11, 31), effect: -0.03 },
  ].map((e) => ({ ...e, startIso: iso(e.start), endIso: iso(e.end) }));
}

/** Seasonal multiplier for one day: the strongest event active that day wins (events do not stack). */
export function seasonalFactor(date, category = 'other', events = retailEvents(date.getUTCFullYear())) {
  const t = date.getTime();
  let best = null;
  for (const e of events) {
    if (t < e.start.getTime() || t > e.end.getTime() + DAY - 1) continue;
    if (!best || Math.abs(e.effect) > Math.abs(best.effect) || (e.effect < 0 && best.effect > 0)) best = e;
  }
  if (!best) return { factor: 1, event: null };
  const sens = EVENT_SENSITIVITY[category] ?? 1;
  return { factor: 1 + best.effect * (best.effect < 0 ? sens : 1), event: best };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/**
 * The reference price at a reference date: the median observed low, with the seasonal effect of the days it
 * was observed taken out (so a Black Friday low does not become the "normal" price).
 */
export function referencePrice(history, category = 'other') {
  const pts = (history || []).filter((h) => h?.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(h.date));
  if (!pts.length) return null;
  const recent = pts.slice(-60);
  const deseason = recent.map((h) => h.price / seasonalFactor(new Date(h.date + 'T00:00:00Z'), category).factor);
  const prices = recent.map((h) => h.price);
  const mean = prices.reduce((s, x) => s + x, 0) / prices.length;
  const sd = Math.sqrt(prices.reduce((s, x) => s + (x - mean) ** 2, 0) / prices.length);
  return {
    price: median(deseason),
    date: new Date(recent[Math.floor(recent.length / 2)].date + 'T00:00:00Z'),
    volatility: Math.max(0.03, Math.min(0.2, mean ? sd / mean : 0.05)),
    observedDays: pts.length,
  };
}

/**
 * Daily prices for a year. Observed days in the history are returned as they are (kind 'observed');
 * every other day is simulated from the 2026 reference (kind 'simulated'), with a low/high band.
 */
export function simulateYear(history, { year = BASE_YEAR, category = 'other', fallbackPrice = null } = {}) {
  const ref = referencePrice(history, category) || (fallbackPrice ? { price: fallbackPrice, date: utc(BASE_YEAR, 10, 7), volatility: 0.06, observedDays: 0 } : null);
  if (!ref?.price) return null;
  const observed = new Map((history || []).map((h) => [h.date, h.price]));
  const trend = CATEGORY_TREND[category] ?? CATEGORY_TREND.other;
  const events = retailEvents(year);
  const days = [];
  for (let d = utc(year, 0, 1); d.getUTCFullYear() === year; d = addDays(d, 1)) {
    const date = iso(d);
    const yearsFromRef = (d - ref.date) / (365.25 * DAY);
    const { factor, event } = seasonalFactor(d, category, events);
    const normal = ref.price * Math.pow(1 + trend, yearsFromRef); // the day's price without any sales event
    const expected = normal * factor;
    const spread = ref.volatility * Math.sqrt(1 + Math.max(0, yearsFromRef));
    const round = (x) => Math.round(x * 100) / 100;
    if (observed.has(date)) {
      const p = observed.get(date);
      days.push({ date, price: p, low: p, high: p, rel: Math.round((p / normal) * 1e4) / 1e4, kind: 'observed', event: event?.name || '' });
    } else {
      days.push({ date, price: round(expected), low: round(expected * (1 - spread)), high: round(expected * (1 + spread)), rel: Math.round(factor * 1e4) / 1e4, kind: 'simulated', event: event?.name || '' });
    }
  }
  const prices = days.map((x) => x.price);
  const avg = prices.reduce((s, x) => s + x, 0) / prices.length;
  const sorted = [...days].sort((a, b) => a.price - b.price);
  return {
    year,
    category,
    reference: { price: Math.round(ref.price * 100) / 100, date: iso(ref.date), volatility: ref.volatility, observedDays: ref.observedDays },
    days,
    average: Math.round(avg * 100) / 100,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    observedDays: days.filter((x) => x.kind === 'observed').length,
    bestWindows: bestWindows(days, events, avg),
  };
}

/** Events of the year ranked by their average price, with the saving against the year's average. */
export function bestWindows(days, events, avg) {
  const byDate = new Map(days.map((x) => [x.date, x]));
  return events
    .map((e) => {
      const inside = [];
      for (let d = e.start; d <= e.end; d = addDays(d, 1)) if (byDate.has(iso(d))) inside.push(byDate.get(iso(d)).price);
      if (!inside.length) return null;
      const mean = inside.reduce((s, x) => s + x, 0) / inside.length;
      return { id: e.id, name: e.name, start: e.startIso, end: e.endIso, price: Math.round(mean * 100) / 100, saving: Math.round((1 - mean / avg) * 1000) / 10 };
    })
    .filter((w) => w && w.saving > 0)
    .sort((a, b) => b.saving - a.saving);
}

/**
 * Calendar colour bucket, 0 (great day to buy) .. 4 (worst), from how a day compares with that day's normal
 * price (`rel` = price / price without sales events). Comparing with the normal price, not the year's average,
 * keeps the slow yearly price drop from painting every January expensive.
 */
export function priceBucket(day) {
  const rel = day?.rel ?? 1;
  if (rel <= 0.9) return 0;
  if (rel <= 0.97) return 1;
  if (rel < 1.01) return 2;
  if (rel < 1.04) return 3;
  return 4;
}
