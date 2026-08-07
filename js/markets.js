/** Live FX / crypto / SELIC via public APIs (AwesomeAPI + BrasilAPI + BCB). */

const AWESOME = 'https://economia.awesomeapi.com.br';
const BRASIL_API_TAXAS = 'https://brasilapi.com.br/api/taxas/v1';
const BCB_SELIC = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados';
const COINGECKO_BTC =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl,usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true';

export const MARKET_TICKERS = [
  {
    id: 'usd',
    label: 'Dólar',
    symbol: 'USD',
    pair: 'USD-BRL',
    unit: 'R$',
    accent: 'usd',
  },
  {
    id: 'eur',
    label: 'Euro',
    symbol: 'EUR',
    pair: 'EUR-BRL',
    unit: 'R$',
    accent: 'eur',
  },
  {
    id: 'btc',
    label: 'Bitcoin',
    symbol: 'BTC',
    pair: 'BTC-BRL',
    unit: 'R$',
    accent: 'btc',
  },
  {
    id: 'selic',
    label: 'Selic',
    symbol: 'SELIC',
    pair: null,
    unit: '%',
    accent: 'selic',
  },
];

/** Chart / analysis ranges shown in the market modal. */
export const MARKET_RANGES = [
  { id: '1h', label: '1H', mode: 'intraday', count: 72, selic: false },
  { id: '24h', label: '24H', mode: 'intraday', count: 288, selic: false },
  { id: '7d', label: '7D', mode: 'daily', days: 7, selic: true },
  { id: '30d', label: '30D', mode: 'daily', days: 30, selic: true },
  { id: '90d', label: '90D', mode: 'daily', days: 90, selic: true },
  { id: '1y', label: '1A', mode: 'daily', days: 365, selic: true },
  { id: 'max', label: 'Máx', mode: 'daily', days: 360, selic: true, selicYears: 10 },
];

const historyCache = new Map();

function num(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function digitsFor(ticker, value) {
  if (ticker?.id === 'selic') return 2;
  if (ticker?.id === 'btc') return value != null && value < 1000 ? 2 : 0;
  if (value != null && value >= 1000) return 2;
  return 4;
}

export function formatMoney(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatTickerValue(ticker, quote) {
  if (!quote || quote.value == null) return '—';
  if (ticker.id === 'selic') return `${formatMoney(quote.value, 2)}%`;
  if (ticker.id === 'btc') return `R$ ${formatMoney(quote.value, digitsFor(ticker, quote.value))}`;
  return `R$ ${formatMoney(quote.value, 4)}`;
}

export function formatChange(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatSigned(value, digits = 4) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMoney(value, digits)}`;
}

async function fetchAwesomeQuotes() {
  const pairs = MARKET_TICKERS.filter((t) => t.pair)
    .map((t) => t.pair)
    .join(',');
  const res = await fetch(`${AWESOME}/json/last/${pairs}`);
  if (!res.ok) throw new Error(`FX failed (${res.status})`);
  return res.json();
}

async function fetchSelic() {
  const res = await fetch(BRASIL_API_TAXAS);
  if (!res.ok) throw new Error(`SELIC failed (${res.status})`);
  const data = await res.json();
  const row = (Array.isArray(data) ? data : []).find((t) =>
    String(t.nome || t.name || '')
      .toLowerCase()
      .includes('selic')
  );
  if (!row) throw new Error('SELIC empty');
  return {
    value: num(row.valor ?? row.value),
    date: null,
    changePct: null,
    high: null,
    low: null,
    ask: null,
    varBid: null,
    name: 'Taxa Selic',
  };
}

async function fetchBtcExtras() {
  try {
    const res = await fetch(COINGECKO_BTC);
    if (!res.ok) return null;
    const data = await res.json();
    const b = data.bitcoin;
    if (!b) return null;
    return {
      marketCapBrl: num(b.brl_market_cap),
      marketCapUsd: num(b.usd_market_cap),
      volume24hBrl: num(b.brl_24h_vol),
      change24hCg: num(b.brl_24h_change),
      priceUsd: num(b.usd),
    };
  } catch {
    return null;
  }
}

function parseAwesomeRow(row) {
  const bid = num(row.bid);
  const ask = num(row.ask);
  return {
    value: bid,
    ask,
    changePct: num(row.pctChange),
    varBid: num(row.varBid),
    high: num(row.high),
    low: num(row.low),
    name: row.name || row.code,
    timestamp: row.create_date || row.timestamp,
    code: row.code,
    codein: row.codein,
    spread: bid != null && ask != null ? ask - bid : null,
  };
}

export async function fetchMarketQuotes() {
  const [awesome, selic] = await Promise.all([
    fetchAwesomeQuotes(),
    fetchSelic().catch(() => null),
  ]);

  const out = {};
  for (const ticker of MARKET_TICKERS) {
    if (ticker.id === 'selic') {
      out.selic = selic;
      continue;
    }
    const key = ticker.pair.replace('-', '');
    const row = awesome[key];
    out[ticker.id] = row ? parseAwesomeRow(row) : null;
  }
  return out;
}

function mapAwesomeSeries(rows, { timeStyle = 'date' } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const ts = r.timestamp ? Number(r.timestamp) * 1000 : null;
      const d = ts ? new Date(ts) : null;
      let label = r.create_date || '';
      let labelFull = label;
      if (d && !Number.isNaN(d.getTime())) {
        label =
          timeStyle === 'time'
            ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString('pt-BR');
        labelFull = d.toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
      return {
        date: label,
        labelFull,
        value: num(r.bid),
        high: num(r.high),
        low: num(r.low),
        ask: num(r.ask),
        pctChange: num(r.pctChange),
        varBid: num(r.varBid),
        ts,
      };
    })
    .filter((p) => p.value != null)
    .reverse();
}

async function fetchAwesomeIntraday(pair, count) {
  const res = await fetch(`${AWESOME}/json/${pair}/${count}`);
  if (!res.ok) throw new Error('Intraday failed');
  return mapAwesomeSeries(await res.json(), { timeStyle: 'time' });
}

async function fetchAwesomeDaily(pair, days) {
  const res = await fetch(`${AWESOME}/json/daily/${pair}/${days}`);
  if (!res.ok) throw new Error('Daily failed');
  return mapAwesomeSeries(await res.json(), { timeStyle: 'date' });
}

function formatBrDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function fetchSelicHistory(range) {
  const end = new Date();
  const start = new Date();
  if (range.id === 'max' || range.selicYears) {
    start.setFullYear(start.getFullYear() - (range.selicYears || 10));
  } else {
    start.setDate(start.getDate() - (range.days || 30));
  }
  const url = `${BCB_SELIC}?formato=json&dataInicial=${formatBrDate(start)}&dataFinal=${formatBrDate(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('SELIC history failed');
  const rows = await res.json();
  // Keep weekly-ish samples for long ranges to keep chart readable
  let points = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      date: r.data,
      labelFull: r.data,
      value: num(r.valor),
      high: null,
      low: null,
    }))
    .filter((p) => p.value != null);

  if (points.length > 180) {
    const step = Math.ceil(points.length / 180);
    points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }
  return points;
}

export function rangesForTicker(tickerId) {
  if (tickerId === 'selic') return MARKET_RANGES.filter((r) => r.selic);
  return MARKET_RANGES;
}

export async function fetchMarketHistory(tickerId, rangeId = '30d') {
  const ticker = MARKET_TICKERS.find((t) => t.id === tickerId);
  if (!ticker) throw new Error('Unknown ticker');
  const range = MARKET_RANGES.find((r) => r.id === rangeId) || MARKET_RANGES.find((r) => r.id === '30d');
  const cacheKey = `${tickerId}:${range.id}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 45_000) return cached.data;

  let data;
  if (ticker.id === 'selic') {
    data = await fetchSelicHistory(range);
  } else if (range.mode === 'intraday') {
    data = await fetchAwesomeIntraday(ticker.pair, range.count);
  } else {
    data = await fetchAwesomeDaily(ticker.pair, range.days);
  }

  historyCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

export function computeSeriesStats(points, quote = null) {
  if (!points?.length) {
    return {
      open: null,
      close: null,
      high: null,
      low: null,
      avg: null,
      change: null,
      changePct: null,
      amplitude: null,
      amplitudePct: null,
      samples: 0,
      quoteHigh: quote?.high ?? null,
      quoteLow: quote?.low ?? null,
      ask: quote?.ask ?? null,
      bid: quote?.value ?? null,
      spread: quote?.spread ?? null,
      varBid: quote?.varBid ?? null,
      dayPct: quote?.changePct ?? null,
    };
  }

  const values = points.map((p) => p.value);
  const open = values[0];
  const close = values[values.length - 1];
  const seriesHigh = Math.max(...values);
  const seriesLow = Math.min(...values);
  const highs = points.map((p) => p.high).filter((v) => v != null);
  const lows = points.map((p) => p.low).filter((v) => v != null);
  const high = highs.length ? Math.max(seriesHigh, ...highs) : seriesHigh;
  const low = lows.length ? Math.min(seriesLow, ...lows) : seriesLow;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const change = close - open;
  const changePct = open ? (change / open) * 100 : null;
  const amplitude = high - low;
  const amplitudePct = low ? (amplitude / low) * 100 : null;

  return {
    open,
    close,
    high,
    low,
    avg,
    change,
    changePct,
    amplitude,
    amplitudePct,
    samples: values.length,
    quoteHigh: quote?.high ?? null,
    quoteLow: quote?.low ?? null,
    ask: quote?.ask ?? null,
    bid: quote?.value ?? null,
    spread: quote?.spread ?? null,
    varBid: quote?.varBid ?? null,
    dayPct: quote?.changePct ?? null,
  };
}

export async function fetchMarketDetails(tickerId, rangeId = '30d') {
  const ticker = MARKET_TICKERS.find((t) => t.id === tickerId);
  const [quotes, history] = await Promise.all([
    fetchMarketQuotes(),
    fetchMarketHistory(tickerId, rangeId),
  ]);
  const quote = quotes?.[tickerId] || null;
  let extras = null;
  if (tickerId === 'btc') extras = await fetchBtcExtras();
  const stats = computeSeriesStats(history, quote);
  return { ticker, quote, history, stats, extras, rangeId };
}

/** Lightweight SVG area chart (no deps). */
export function buildChartSvg(points, { width = 640, height = 260, accent = '#2dd4bf', ticker = null } = {}) {
  const chart = prepareChartGeometry(points, { width, height, accent, ticker });
  if (!chart) {
    return `<svg viewBox="0 0 ${width} ${height}" class="market-chart-svg" role="img" aria-label="Sem dados">
      <text x="50%" y="50%" text-anchor="middle" fill="currentColor" opacity="0.5" font-size="14">Sem histórico</text>
    </svg>`;
  }
  return chart.svg;
}

function prepareChartGeometry(points, { width = 640, height = 260, accent = '#2dd4bf', ticker = null } = {}) {
  if (!points?.length) return null;

  const gid = `mktFill-${Math.random().toString(36).slice(2, 9)}`;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padX = 18;
  const padTop = 28;
  const padBot = 28;
  const span = max - min || 1;
  const stepX = (width - padX * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((p, i) => {
    const x = padX + i * stepX;
    const y = height - padBot - ((p.value - min) / span) * (height - padTop - padBot);
    return { x, y, point: p, i };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${height - padBot} L${coords[0].x.toFixed(1)},${height - padBot} Z`;
  const last = points[points.length - 1];
  const first = points[0];
  const up = last.value >= first.value;
  const dig = digitsFor(ticker, last.value);

  const mid = (min + max) / 2;
  const yMax = padTop;
  const yMid = height - padBot - ((mid - min) / span) * (height - padTop - padBot);
  const yMin = height - padBot;

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" class="market-chart-svg" role="img" aria-label="Gráfico interativo">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.42"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${yMax}" x2="${width - padX}" y2="${yMax}" stroke="currentColor" stroke-opacity="0.12" />
      <line x1="${padX}" y1="${yMid}" x2="${width - padX}" y2="${yMid}" stroke="currentColor" stroke-opacity="0.1" stroke-dasharray="4 4" />
      <line x1="${padX}" y1="${yMin}" x2="${width - padX}" y2="${yMin}" stroke="currentColor" stroke-opacity="0.12" />
      <text x="${width - padX}" y="${yMax + 12}" font-size="10" fill="currentColor" opacity="0.5" text-anchor="end">${formatMoney(max, dig)}</text>
      <text x="${width - padX}" y="${yMin - 4}" font-size="10" fill="currentColor" opacity="0.5" text-anchor="end">${formatMoney(min, dig)}</text>
      <path d="${area}" fill="url(#${gid})" />
      <path d="${line}" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
      <line class="mkt-crosshair" x1="0" y1="${padTop}" x2="0" y2="${height - padBot}" stroke="${accent}" stroke-opacity="0" stroke-width="1.25" stroke-dasharray="3 3" />
      <circle class="mkt-focus-dot" cx="0" cy="0" r="6" fill="${accent}" stroke="#fff" stroke-width="2" opacity="0" />
      <circle cx="${coords[coords.length - 1].x}" cy="${coords[coords.length - 1].y}" r="5.5" fill="${accent}" />
      <text x="${padX}" y="${height - 8}" font-size="11" fill="currentColor" opacity="0.55">${first.date}</text>
      <text x="${width - padX}" y="${height - 8}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="end">${last.date}</text>
      <text x="${padX}" y="16" font-size="12" fill="${accent}" opacity="0.95">${up ? '▲' : '▼'} ${formatMoney(last.value, dig)}</text>
      <rect class="mkt-hit" x="${padX}" y="${padTop}" width="${width - padX * 2}" height="${height - padTop - padBot}" fill="transparent" />
    </svg>
  `;

  return { svg, coords, width, height, padX, padTop, padBot, dig, ticker };
}

function formatPointPrice(ticker, value, dig) {
  if (value == null) return '—';
  if (ticker?.id === 'selic') return `${formatMoney(value, 2)}%`;
  return `R$ ${formatMoney(value, dig)}`;
}

/**
 * Mount interactive chart with crosshair + tooltip (price over time).
 * @returns {{ destroy: () => void }}
 */
export function mountInteractiveChart(container, points, { accent = '#2dd4bf', ticker = null } = {}) {
  if (!container) return { destroy() {} };

  const geometry = prepareChartGeometry(points, { accent, ticker });
  container.innerHTML = `
    <div class="mkt-chart-interactive">
      ${geometry ? geometry.svg : buildChartSvg([])}
      <div class="mkt-tooltip" hidden>
        <div class="mkt-tooltip-date"></div>
        <div class="mkt-tooltip-price"></div>
        <div class="mkt-tooltip-extra"></div>
      </div>
    </div>
  `;

  if (!geometry) return { destroy() {} };

  const wrap = container.querySelector('.mkt-chart-interactive');
  const svg = container.querySelector('.market-chart-svg');
  const tip = container.querySelector('.mkt-tooltip');
  const tipDate = tip.querySelector('.mkt-tooltip-date');
  const tipPrice = tip.querySelector('.mkt-tooltip-price');
  const tipExtra = tip.querySelector('.mkt-tooltip-extra');
  const cross = svg.querySelector('.mkt-crosshair');
  const dot = svg.querySelector('.mkt-focus-dot');
  const hit = svg.querySelector('.mkt-hit');
  const { coords, dig } = geometry;

  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('stroke-opacity', '0');
    dot.setAttribute('opacity', '0');
  };

  const showAt = (idx, clientX, clientY) => {
    const c = coords[idx];
    if (!c) return;
    const p = c.point;
    cross.setAttribute('x1', c.x);
    cross.setAttribute('x2', c.x);
    cross.setAttribute('stroke-opacity', '0.75');
    dot.setAttribute('cx', c.x);
    dot.setAttribute('cy', c.y);
    dot.setAttribute('opacity', '1');

    tipDate.textContent = p.labelFull || p.date || '—';
    tipPrice.textContent = formatPointPrice(ticker, p.value, dig);
    const extras = [];
    if (p.high != null) extras.push(`Máx ${formatPointPrice(ticker, p.high, dig)}`);
    if (p.low != null) extras.push(`Mín ${formatPointPrice(ticker, p.low, dig)}`);
    if (p.pctChange != null) extras.push(`${formatChange(p.pctChange)}`);
    tipExtra.textContent = extras.filter(Boolean).join(' · ');
    tip.hidden = false;

    const rect = wrap.getBoundingClientRect();
    const tipW = tip.offsetWidth || 140;
    const tipH = tip.offsetHeight || 64;
    let left = clientX - rect.left + 14;
    let top = clientY - rect.top - tipH - 12;
    if (left + tipW > rect.width - 8) left = clientX - rect.left - tipW - 14;
    if (top < 8) top = clientY - rect.top + 18;
    tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  };

  const onMove = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const cursor = pt.matrixTransform(ctm.inverse());
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i += 1) {
      const d = Math.abs(coords[i].x - cursor.x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    showAt(best, e.clientX, e.clientY);
  };

  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerdown', onMove);
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('pointercancel', hide);

  return {
    destroy() {
      hit.removeEventListener('pointermove', onMove);
      hit.removeEventListener('pointerdown', onMove);
      hit.removeEventListener('pointerleave', hide);
      hit.removeEventListener('pointercancel', hide);
    },
  };
}
