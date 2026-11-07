/**
 * Market data layer shared by the dashboard rates strip and markets.html.
 *
 * Only documented, browser-readable (CORS-enabled) sources are used:
 *  - BCB SGS 432   Selic target set by Copom        https://api.bcb.gov.br
 *  - ECB Data API  deposit facility / MRO / MLF     https://data-api.ecb.europa.eu
 *  - NY Fed        EFFR and the Fed target range    https://markets.newyorkfed.org
 *  - brapi.dev     B3 quotes and history            https://brapi.dev
 *
 * No US stock/ETF/index provider is wired in: the free ones are not readable
 * from a browser, so those assets are reported as unavailable (never invented).
 *
 * Parsers are pure functions so they can be tested with captured responses.
 */
import { fetchJson } from '../core/http.js';
import { cacheGet, cacheSet } from '../core/cache.js';

export const RATES_CACHE_KEY = 'rates.v1';
export const RATES_MAX_AGE_MS = 6 * 60 * 60 * 1000; // policy rates change a few times a year

/** Explicit date window ending today: the series API rejects ultimos/N above 20 and can list future-dated rows. */
export function bcbSelicUrl(now = new Date(), days = 45) {
  const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados?formato=json&dataInicial=${fmt(start)}&dataFinal=${fmt(now)}`;
}
const ECB_URL = (series) =>
  `https://data-api.ecb.europa.eu/service/data/FM/${series}?lastNObservations=1&format=jsondata`;
const NYFED_EFFR_URL = 'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json';

const ECB_SERIES = {
  deposit: { series: 'B.U2.EUR.4F.KR.DFR.LEV', label: 'Deposit facility rate' },
  refi: { series: 'B.U2.EUR.4F.KR.MRR_FR.LEV', label: 'Main refinancing operations rate' },
  lending: { series: 'B.U2.EUR.4F.KR.MLFR.LEV', label: 'Marginal lending facility rate' },
};

const ANNUALIZED = '% p.a. (annualized)';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function isoToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "dd/mm/yyyy" → "yyyy-mm-dd" (or null). */
export function brDateToIso(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Selic target from BCB SGS 432 (daily series). The API can return rows dated
 * after today, so only the latest row dated on or before today is used.
 */
export function parseBcbSelicTarget(rows, today = isoToday()) {
  if (!Array.isArray(rows)) return null;
  const valid = rows
    .map((r) => ({ date: brDateToIso(r.data), value: Number(String(r.valor).replace(',', '.')) }))
    .filter((r) => r.date && Number.isFinite(r.value) && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = valid.at(-1);
  if (!latest) return null;
  return {
    id: 'selic',
    label: 'Selic target',
    kind: 'policy-target',
    rateType: 'Target set by Copom (not the overnight effective rate)',
    value: latest.value,
    display: `${latest.value.toFixed(2)}%`,
    unit: ANNUALIZED,
    effectiveDate: latest.date,
    effectiveDateMeaning: 'latest daily value on or before today',
    source: 'Banco Central do Brasil, SGS series 432',
    sourceUrl: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json',
  };
}

/** One ECB series. The observation's time period is the date the rate changed. */
export function parseEcbRate(json, { id, label, primary = false } = {}) {
  const series = json?.dataSets?.[0]?.series;
  const first = series && Object.values(series)[0];
  const observations = first?.observations;
  if (!observations) return null;
  const index = Object.keys(observations).map(Number).sort((a, b) => a - b).at(-1);
  const value = observations[String(index)]?.[0];
  if (!Number.isFinite(value)) return null;
  const effectiveDate = json?.structure?.dimensions?.observation?.[0]?.values?.[index]?.id || null;
  return {
    id,
    label,
    kind: 'policy-rate',
    rateType: primary ? 'Primary ECB policy rate (deposit facility)' : 'ECB policy rate',
    value,
    display: `${value.toFixed(2)}%`,
    unit: ANNUALIZED,
    effectiveDate,
    effectiveDateMeaning: 'date the rate last changed',
    source: 'European Central Bank, Data Portal (FM dataflow)',
    sourceUrl: 'https://data.ecb.europa.eu/',
  };
}

/** NY Fed EFFR response → Fed target range (policy) and EFFR (effective overnight). */
export function parseNyFedEffr(json) {
  const r = json?.refRates?.[0];
  if (!r) return { fedTarget: null, effr: null };
  const from = Number(r.targetRateFrom);
  const to = Number(r.targetRateTo);
  const source = 'Federal Reserve Bank of New York, Reference Rates API';
  const sourceUrl = 'https://www.newyorkfed.org/markets/reference-rates/effr';
  const fedTarget =
    Number.isFinite(from) && Number.isFinite(to)
      ? {
          id: 'fed-target',
          label: 'Fed funds target range',
          kind: 'policy-target-range',
          rateType: 'Target range set by the FOMC (not the effective rate)',
          range: { from, to },
          display: `${from.toFixed(2)}%–${to.toFixed(2)}%`,
          unit: ANNUALIZED,
          effectiveDate: r.effectiveDate || null,
          effectiveDateMeaning: 'reference-rate date that reports this target range',
          source,
          sourceUrl,
        }
      : null;
  const effrValue = Number(r.percentRate);
  const effr = Number.isFinite(effrValue)
    ? {
        id: 'effr',
        label: 'Effective federal funds rate (EFFR)',
        kind: 'effective-overnight',
        rateType: 'Effective overnight rate (market outcome, not a target)',
        value: effrValue,
        display: `${effrValue.toFixed(2)}%`,
        unit: ANNUALIZED,
        effectiveDate: r.effectiveDate || null,
        effectiveDateMeaning: 'rate date',
        source,
        sourceUrl,
      }
    : null;
  return { fedTarget, effr };
}

/**
 * Fetch all policy rates. Each source fails independently: the result carries
 * the rates that loaded, per-source errors, and `fetchedAt`. When a source
 * fails, the last cached value is returned and marked stale.
 */
export async function fetchPolicyRates({ fetchOpts = {}, now = new Date(), useCache = true } = {}) {
  const cached = useCache ? cacheGet(RATES_CACHE_KEY, { maxAgeMs: RATES_MAX_AGE_MS, now: now.getTime() }) : null;
  const previous = new Map((cached?.value?.rates || []).map((r) => [r.id, r]));
  const errors = {};
  const out = [];
  const fetchedAt = now.toISOString();

  const attempt = async (ids, task) => {
    try {
      const rates = (await task()).filter(Boolean);
      if (!rates.length) throw new Error('Source returned no usable data');
      for (const r of rates) out.push({ ...r, fetchedAt, stale: false });
    } catch (error) {
      for (const id of ids) {
        errors[id] = error?.message || 'Unavailable';
        const old = previous.get(id);
        if (old) out.push({ ...old, stale: true });
      }
    }
  };

  await Promise.all([
    attempt(['selic'], async () => [parseBcbSelicTarget(await fetchJson(bcbSelicUrl(now), fetchOpts), isoToday(now))]),
    attempt(['fed-target', 'effr'], async () => {
      const { fedTarget, effr } = parseNyFedEffr(await fetchJson(NYFED_EFFR_URL, fetchOpts));
      return [fedTarget, effr];
    }),
    attempt(['ecb-deposit'], async () => {
      const rates = [];
      for (const [key, { series, label }] of Object.entries(ECB_SERIES)) {
        try {
          const rate = parseEcbRate(await fetchJson(ECB_URL(series), fetchOpts), {
            id: `ecb-${key}`,
            label,
            primary: key === 'deposit',
          });
          if (rate) rates.push(rate);
        } catch (error) {
          if (key === 'deposit') throw error; // the primary rate is required
        }
      }
      return rates;
    }),
  ]);

  const result = { rates: out, errors, fetchedAt };
  if (out.some((r) => !r.stale)) cacheSet(RATES_CACHE_KEY, result, { now: now.getTime() });
  return result;
}

// ---------------------------------------------------------------------------
// B3 quotes (brapi.dev)
// ---------------------------------------------------------------------------

const BRAPI = 'https://brapi.dev/api/quote';

/** Tickers brapi serves without a token (verified against the live API). */
export const BRAPI_KEYLESS = ['PETR4', 'VALE3', 'ITUB4', 'MGLU3'];

export function parseBrapiQuotes(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results
    .filter((r) => r && r.symbol && Number.isFinite(r.regularMarketPrice))
    .map((r) => ({
      symbol: r.symbol,
      name: r.longName || r.shortName || r.symbol,
      exchange: 'B3',
      currency: r.currency || 'BRL',
      price: r.regularMarketPrice,
      change: r.regularMarketChange ?? null,
      changePercent: r.regularMarketChangePercent ?? null,
      previousClose: r.regularMarketPreviousClose ?? null,
      quoteTime: r.regularMarketTime || null,
      marketCap: r.marketCap ?? null,
      delayed: true,
      source: 'brapi.dev',
    }));
}

/** History points with adjusted closes. Only points present in the response are returned. */
export function parseBrapiHistory(json) {
  const rows = json?.results?.[0]?.historicalDataPrice;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((p) => Number.isFinite(p.close) && Number.isFinite(p.date))
    .map((p) => ({
      date: new Date(p.date * 1000).toISOString().slice(0, 10),
      close: p.close,
      adjustedClose: Number.isFinite(p.adjustedClose) ? p.adjustedClose : null,
    }));
}

/** brapi tickers that need a token without one are reported, not guessed. */
export function splitByAvailability(symbols, token) {
  if (token) return { available: [...symbols], needsToken: [] };
  const upper = symbols.map((s) => s.toUpperCase());
  return {
    available: upper.filter((s) => BRAPI_KEYLESS.includes(s)),
    needsToken: upper.filter((s) => !BRAPI_KEYLESS.includes(s)),
  };
}

/** Provider implementing the neutral MarketDataProvider contract for B3. */
export function createBrapiProvider({ token = '', fetchOpts = {} } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return {
    id: 'brapi',
    name: 'brapi.dev (B3)',
    capabilities: { quotes: true, history: true, search: false, profile: false, policyRates: false },
    async searchAssets() {
      return []; // search needs a token on brapi; not offered here
    },
    async getQuotes(symbols) {
      const { available } = splitByAvailability(symbols, token);
      if (!available.length) return [];
      return parseBrapiQuotes(await fetchJson(`${BRAPI}/${available.join(',')}`, { ...fetchOpts, headers }));
    },
    async getHistory(symbol, range = '1mo') {
      return parseBrapiHistory(
        await fetchJson(`${BRAPI}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { ...fetchOpts, headers })
      );
    },
    async getCompanyProfile() {
      return null; // not available without a token
    },
    async getPolicyRates() {
      return [];
    },
  };
}

/** Period return from real history points only; null when the data does not cover it. */
export function periodReturn(points, { useAdjusted = true } = {}) {
  const usable = points.filter((p) => (useAdjusted ? p.adjustedClose ?? p.close : p.close) != null);
  if (usable.length < 2) return null;
  const pick = (p) => (useAdjusted ? p.adjustedClose ?? p.close : p.close);
  const first = pick(usable[0]);
  const last = pick(usable.at(-1));
  if (!first) return null;
  return { from: usable[0].date, to: usable.at(-1).date, percent: ((last - first) / first) * 100, adjusted: useAdjusted };
}

// ---------------------------------------------------------------------------
// Currencies (BCB end-of-day rates)
// ---------------------------------------------------------------------------

const FX_SERIES = {
  usdbrl: { sgs: 1, label: 'USD/BRL', name: 'US dollar, sell rate' },
  eurbrl: { sgs: 21619, label: 'EUR/BRL', name: 'Euro, sell rate' },
};

export function bcbSeriesUrl(sgs, now = new Date(), days = 12) {
  const fmt = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${sgs}/dados?formato=json&dataInicial=${fmt(start)}&dataFinal=${fmt(now)}`;
}

/** Latest and previous daily value on or before `today` from a BCB SGS series. */
export function parseBcbDaily(rows, today = isoToday()) {
  if (!Array.isArray(rows)) return null;
  const valid = rows
    .map((r) => ({ date: brDateToIso(r.data), value: Number(String(r.valor).replace(',', '.')) }))
    .filter((r) => r.date && Number.isFinite(r.value) && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = valid.at(-1);
  if (!latest) return null;
  const previous = valid.at(-2) || null;
  return {
    value: latest.value,
    date: latest.date,
    previousValue: previous ? previous.value : null,
    previousDate: previous ? previous.date : null,
    changePercent: previous ? ((latest.value - previous.value) / previous.value) * 100 : null,
  };
}

/**
 * End-of-day currency rates from the Central Bank of Brazil (SGS). These are daily
 * closing rates, not a live feed, and they say so.
 */
export async function fetchFxRates({ fetchOpts = {}, now = new Date() } = {}) {
  const out = [];
  const errors = {};
  await Promise.all(
    Object.entries(FX_SERIES).map(async ([id, spec]) => {
      try {
        const parsed = parseBcbDaily(await fetchJson(bcbSeriesUrl(spec.sgs, now), fetchOpts), isoToday(now));
        if (!parsed) throw new Error('No recent observation');
        out.push({
          id,
          label: spec.label,
          name: spec.name,
          currency: 'BRL',
          ...parsed,
          kind: 'end-of-day',
          source: `Banco Central do Brasil, SGS series ${spec.sgs}`,
          fetchedAt: now.toISOString(),
        });
      } catch (error) {
        errors[id] = error?.message || 'Unavailable';
      }
    })
  );
  return { rates: out.sort((a, b) => a.id.localeCompare(b.id)), errors };
}
