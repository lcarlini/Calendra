/** Live FX / crypto / SELIC via public APIs (AwesomeAPI + BrasilAPI). */

const AWESOME = 'https://economia.awesomeapi.com.br';
const BRASIL_API_TAXAS = 'https://brasilapi.com.br/api/taxas/v1';

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

const historyCache = new Map();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(value, digits = 2) {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatTickerValue(ticker, quote) {
  if (!quote || quote.value == null) return '—';
  if (ticker.id === 'selic') {
    return `${formatMoney(quote.value, 2)}%`;
  }
  if (ticker.id === 'btc') {
    return `R$ ${formatMoney(quote.value, 0)}`;
  }
  return `R$ ${formatMoney(quote.value, 4)}`;
}

export function formatChange(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

async function fetchAwesomeQuotes() {
  const pairs = MARKET_TICKERS.filter((t) => t.pair).map((t) => t.pair).join(',');
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
  };
}

function parseAwesomeRow(row) {
  const bid = num(row.bid);
  const pct = num(row.pctChange);
  return {
    value: bid,
    changePct: pct,
    high: num(row.high),
    low: num(row.low),
    name: row.name || row.code,
    timestamp: row.create_date || row.timestamp,
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

export async function fetchMarketHistory(tickerId, days = 30) {
  const ticker = MARKET_TICKERS.find((t) => t.id === tickerId);
  if (!ticker) throw new Error('Unknown ticker');

  const cacheKey = `${tickerId}:${days}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60_000) return cached.data;

  if (ticker.id === 'selic') {
    const current = await fetchSelic();
    const data = Array.from({ length: Math.min(days, 30) }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (Math.min(days, 30) - 1 - i));
      return {
        date: d.toLocaleDateString('pt-BR'),
        value: current.value,
      };
    });
    historyCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  const res = await fetch(`${AWESOME}/json/daily/${ticker.pair}/${days}`);
  if (!res.ok) throw new Error('History failed');
  const rows = await res.json();
  const data = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      date: r.timestamp
        ? new Date(Number(r.timestamp) * 1000).toLocaleDateString('pt-BR')
        : r.create_date?.slice(0, 10) || '',
      value: num(r.bid),
    }))
    .filter((p) => p.value != null)
    .reverse();

  historyCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** Lightweight SVG sparkline / area chart (no deps). */
export function buildChartSvg(points, { width = 520, height = 220, accent = '#2dd4bf' } = {}) {
  if (!points?.length) {
    return `<svg viewBox="0 0 ${width} ${height}" class="market-chart-svg" role="img" aria-label="Sem dados">
      <text x="50%" y="50%" text-anchor="middle" fill="currentColor" opacity="0.5" font-size="14">Sem histórico</text>
    </svg>`;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 16;
  const span = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
    return [x, y];
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height - pad} L${coords[0][0].toFixed(1)},${height - pad} Z`;
  const last = points[points.length - 1];
  const first = points[0];
  const up = last.value >= first.value;
  const digits = last.value >= 1000 ? 0 : last.value >= 10 ? 2 : 4;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="market-chart-svg" role="img" aria-label="Gráfico">
      <defs>
        <linearGradient id="mktFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#mktFill)" />
      <path d="${line}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${coords[coords.length - 1][0]}" cy="${coords[coords.length - 1][1]}" r="5" fill="${accent}" />
      <text x="${pad}" y="${height - 4}" font-size="11" fill="currentColor" opacity="0.55">${first.date}</text>
      <text x="${width - pad}" y="${height - 4}" font-size="11" fill="currentColor" opacity="0.55" text-anchor="end">${last.date}</text>
      <text x="${pad}" y="14" font-size="12" fill="currentColor" opacity="0.7">${up ? '▲' : '▼'} ${formatMoney(last.value, digits)}</text>
    </svg>
  `;
}
