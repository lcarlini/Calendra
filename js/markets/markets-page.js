/**
 * Markets page. Policy rates share rates-ui.js with the dashboard strip; quotes come
 * from the provider layer in providers.js. Nothing here fills gaps with invented values.
 */
import { initThemeEverywhere } from '../themes.js';
import { initDisplay } from '../core/display.js';
import { onStoreChange, readJSON, writeJSON } from '../core/store.js';
import { esc, formatMoney, formatPercent, formatWhen } from '../core/format.js';
import { mountRates } from './rates-ui.js';
import { BRAPI_KEYLESS, createBrapiProvider, fetchFxRates, periodReturn, splitByAvailability } from './providers.js';
import { sparklineSvg } from './chart.js';

initThemeEverywhere();
initDisplay();

export const WATCH_KEY = 'calendra.watchlists.v1';
const TOKEN_KEY = 'calendra.brapi.token'; // sessionStorage only; never exported, gone when the tab closes
const REFRESH_MS = 2 * 60 * 1000;

export const DEFAULT_WATCHLISTS = {
  br: ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'WEGE3'],
  usStocks: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'],
  usEtfs: ['SPY', 'VOO', 'QQQ', 'VTI', 'VT'],
  indices: ['^GSPC', '^IXIC', '^DJI', '^BVSP'],
};
const US_TITLES = { usStocks: 'US stocks', usEtfs: 'US ETFs', indices: 'Indices' };

const BR_PATTERN = /^[A-Z]{4}\d{1,2}[A-Z]?$/;
const GENERIC_PATTERN = /^[A-Z0-9.^-]{1,12}$/;

export function normalizeSymbol(text, list = 'br') {
  const s = String(text || '').trim().toUpperCase();
  const ok = list === 'br' ? BR_PATTERN.test(s) : GENERIC_PATTERN.test(s);
  return ok ? s : null;
}

function loadLists() {
  const saved = readJSON(WATCH_KEY, {});
  const out = {};
  for (const key of Object.keys(DEFAULT_WATCHLISTS)) {
    out[key] = Array.isArray(saved[key]) ? saved[key].filter((s) => typeof s === 'string') : [...DEFAULT_WATCHLISTS[key]];
  }
  return out;
}

const getToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const $ = (id) => document.getElementById(id);
let lists = loadLists();
const historyCache = new Map(); // `${symbol}|${range}|${token?}` -> { at, points }
let busy = false;

function saveLists() {
  writeJSON(WATCH_KEY, lists);
}

function statusFor(symbol, quote, needsToken) {
  if (needsToken) return '<span class="badge badge-muted" title="This ticker is not served without a brapi token.">Needs token</span>';
  if (!quote) return '<span class="badge badge-warn">No data</span>';
  return '<span class="badge badge-warn" title="Quotes are delayed">Delayed</span>';
}

function changeCell(q) {
  if (!q || q.change == null) return '—';
  const cls = q.change > 0 ? 'up' : q.change < 0 ? 'down' : '';
  return `<span class="chg ${cls}">${esc(formatPercent(q.changePercent))}<small> (${esc(q.change > 0 ? '+' : '')}${esc(q.change.toFixed(2))})</small></span>`;
}

async function renderBr() {
  if (busy) return;
  busy = true;
  const token = getToken();
  const range = $('br-range').value;
  const provider = createBrapiProvider({ token });
  const { available, needsToken } = splitByAvailability(lists.br, token);
  const tbody = $('br-table').querySelector('tbody');
  const statusEl = $('br-status');

  statusEl.textContent = 'Loading quotes…';
  let quotes = [];
  let quoteError = '';
  try {
    quotes = await provider.getQuotes(available);
  } catch (error) {
    quoteError = error?.message || 'unavailable';
  }
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));

  // History for the chosen range: only for symbols that have a quote; one request each, cached 5 min.
  const histories = new Map();
  await Promise.all(
    quotes.map(async (q) => {
      const key = `${q.symbol}|${range}|${token ? 't' : ''}`;
      const cached = historyCache.get(key);
      if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
        histories.set(q.symbol, cached.points);
        return;
      }
      try {
        const points = await provider.getHistory(q.symbol, range);
        historyCache.set(key, { at: Date.now(), points });
        histories.set(q.symbol, points);
      } catch {
        histories.set(q.symbol, null);
      }
    })
  );

  $('br-return-head').textContent = `Return (${range}, adjusted)`;
  tbody.innerHTML = lists.br
    .map((symbol) => {
      const q = bySymbol.get(symbol);
      const points = histories.get(symbol);
      const ret = points ? periodReturn(points) : null;
      const spark = points ? sparklineSvg(points.map((p) => p.adjustedClose ?? p.close), { label: `${symbol} ${range} history` }) : '';
      return `<tr data-symbol="${esc(symbol)}">
        <th scope="row">${esc(symbol)}</th>
        <td>${esc(q ? q.name : '—')}</td>
        <td class="num">${q ? esc(formatMoney(q.price, q.currency)) : '—'}</td>
        <td class="num">${changeCell(q)}</td>
        <td>${spark || '—'}</td>
        <td class="num">${ret ? esc(formatPercent(ret.percent)) : '—'}${ret ? `<small class="muted"> ${esc(ret.from)} → ${esc(ret.to)}</small>` : ''}</td>
        <td>${q && q.quoteTime ? esc(formatWhen(q.quoteTime)) : '—'}</td>
        <td>${statusFor(symbol, q, needsToken.includes(symbol))}</td>
        <td><button type="button" class="btn-icon" data-remove="${esc(symbol)}" aria-label="Remove ${esc(symbol)}">×</button></td>
      </tr>`;
    })
    .join('');

  const parts = [];
  if (quoteError) parts.push(`Quotes could not be loaded (${quoteError}). Nothing is estimated.`);
  else parts.push(`Updated ${new Date().toLocaleTimeString()} · ${quotes.length} of ${lists.br.length} tickers loaded`);
  if (needsToken.length) parts.push(`${needsToken.join(', ')} need a brapi token (free at brapi.dev). Keyless tickers: ${BRAPI_KEYLESS.join(', ')}.`);
  statusEl.textContent = parts.join(' ');
  busy = false;
}

async function renderFx() {
  const grid = $('fx-grid');
  grid.innerHTML = '<p class="status-line" role="status">Loading currencies…</p>';
  const { rates, errors } = await fetchFxRates();
  const cards = rates
    .map(
      (r) => `<article class="rate-card">
        <header><h4>${esc(r.label)}</h4><span class="badge badge-muted">End of day</span></header>
        <p class="rate-value">${esc(r.value.toFixed(4))}</p>
        <p class="rate-unit">BRL per 1 ${esc(r.label.slice(0, 3))} · ${esc(r.name)}</p>
        <p class="rate-type">${r.changePercent == null ? 'Previous day not available' : `${esc(formatPercent(r.changePercent))} vs ${esc(r.previousDate)}`}</p>
        <dl class="rate-meta"><dt>As of</dt><dd>${esc(r.date)}</dd><dt>Source</dt><dd>${esc(r.source)}</dd><dt>Fetched</dt><dd>${esc(formatWhen(r.fetchedAt))}</dd></dl>
      </article>`
    )
    .join('');
  const failed = Object.entries(errors).map(([id, m]) => `<li><strong>${esc(id)}</strong>: ${esc(m)}</li>`).join('');
  grid.innerHTML = cards + (failed ? `<div class="status-card rates-warning" role="status"><p>Not shown (unavailable, nothing estimated):</p><ul>${failed}</ul></div>` : '');
}

function renderUs() {
  $('us-lists').innerHTML = Object.entries(US_TITLES)
    .map(([key, title]) => {
      const chips = lists[key]
        .map(
          (s) => `<li class="chip-static"><span>${esc(s)}</span>
            <a href="https://www.google.com/search?q=${encodeURIComponent(`${s} stock price`)}" target="_blank" rel="noopener" aria-label="Search ${esc(s)} on Google (opens a new tab)">Search</a>
            <button type="button" class="btn-icon" data-us-remove="${key}|${esc(s)}" aria-label="Remove ${esc(s)}">×</button></li>`
        )
        .join('');
      return `<div class="us-list"><h4>${esc(title)} <span class="badge badge-muted">No quotes available</span></h4>
        <ul class="chip-list" role="list">${chips || '<li class="status-line">Empty</li>'}</ul>
        <form class="inline-form" data-us-add="${key}" autocomplete="off">
          <label for="us-${key}">Add symbol</label><input id="us-${key}" type="text" maxlength="12" required />
          <button type="submit" class="btn btn-ghost btn-sm">Add</button></form></div>`;
    })
    .join('');
}

document.addEventListener('click', (event) => {
  const rm = event.target.closest('[data-remove]');
  if (rm) {
    lists = { ...lists, br: lists.br.filter((s) => s !== rm.dataset.remove) };
    saveLists();
    renderBr();
    return;
  }
  const usRm = event.target.closest('[data-us-remove]');
  if (usRm) {
    const [key, symbol] = usRm.dataset.usRemove.split('|');
    lists = { ...lists, [key]: lists[key].filter((s) => s !== symbol) };
    saveLists();
    renderUs();
  }
});

$('br-add').addEventListener('submit', (event) => {
  event.preventDefault();
  const symbol = normalizeSymbol($('br-symbol').value, 'br');
  if (!symbol) {
    $('br-status').textContent = 'That does not look like a B3 ticker (for example PETR4 or BBDC4).';
    return;
  }
  if (!lists.br.includes(symbol)) lists = { ...lists, br: [...lists.br, symbol] };
  $('br-symbol').value = '';
  saveLists();
  renderBr();
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-us-add]');
  if (!form) return;
  event.preventDefault();
  const key = form.dataset.usAdd;
  const input = form.querySelector('input');
  const symbol = normalizeSymbol(input.value, key);
  if (symbol && !lists[key].includes(symbol)) {
    lists = { ...lists, [key]: [...lists[key], symbol] };
    saveLists();
  }
  renderUs();
});

$('br-range').addEventListener('change', renderBr);
$('br-refresh').addEventListener('click', () => {
  historyCache.clear();
  renderBr();
});
$('fx-refresh').addEventListener('click', renderFx);
$('br-token-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('br-token').value.trim();
  if (!value) return;
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
  } catch {
    $('br-status').textContent = 'Session storage is blocked in this browser, so the token cannot be kept.';
    return;
  }
  $('br-token').value = '';
  historyCache.clear();
  renderBr();
});
$('br-token-clear').addEventListener('click', () => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
  historyCache.clear();
  renderBr();
});

onStoreChange([WATCH_KEY], () => {
  lists = loadLists();
  renderUs();
  renderBr();
});

mountRates($('rates-grid'), { refreshButton: $('rates-refresh') });
renderFx();
renderUs();
renderBr();

// One shared timer; skipped while the tab is hidden.
setInterval(() => {
  if (!document.hidden) renderBr();
}, REFRESH_MS);
