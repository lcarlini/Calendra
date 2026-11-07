/**
 * Renders policy-rate cards and keeps them fresh with ONE shared timer.
 * Used by the dashboard strip and by markets.html (same data layer).
 */
import { fetchPolicyRates } from './providers.js';
import { esc, formatWhen } from '../core/format.js';

export { esc };

const REFRESH_MS = 30 * 60 * 1000; // policy rates change a few times a year

function card(rate) {
  const stale = rate.stale
    ? '<span class="badge badge-warn" title="The last request failed; this is the last value we saved.">Stale</span>'
    : '';
  return `
    <article class="rate-card" data-rate="${esc(rate.id)}">
      <header>
        <h4>${esc(rate.label)}</h4>${stale}
      </header>
      <p class="rate-value" aria-label="${esc(rate.label)}: ${esc(rate.display)}">${esc(rate.display)}</p>
      <p class="rate-unit">${esc(rate.unit)}</p>
      <p class="rate-type">${esc(rate.rateType)}</p>
      <dl class="rate-meta">
        <dt>Effective</dt><dd>${esc(rate.effectiveDate || 'not provided')} <small>(${esc(rate.effectiveDateMeaning)})</small></dd>
        <dt>Source</dt><dd><a href="${esc(rate.sourceUrl)}" target="_blank" rel="noopener">${esc(rate.source)}</a></dd>
        <dt>Fetched</dt><dd>${esc(formatWhen(rate.fetchedAt))}</dd>
      </dl>
    </article>`;
}

/** Pure: HTML for a rates result. */
export function ratesHtml(result) {
  const byId = new Map(result.rates.map((r) => [r.id, r]));
  const order = ['selic', 'fed-target', 'effr', 'ecb-deposit'];
  const main = order.map((id) => byId.get(id)).filter(Boolean);
  const ecbOthers = ['ecb-refi', 'ecb-lending'].map((id) => byId.get(id)).filter(Boolean);

  const missing = Object.entries(result.errors)
    .filter(([id]) => !byId.has(id) || byId.get(id)?.stale)
    .map(([id, message]) => `<li><strong>${esc(id)}</strong>: ${esc(message)}</li>`)
    .join('');

  const cards = main.map(card).join('');
  const details = ecbOthers.length
    ? `<details class="rate-details"><summary>Other ECB policy rates</summary><div class="rates-grid">${ecbOthers.map(card).join('')}</div></details>`
    : '';
  const warn = missing
    ? `<div class="status-card rates-warning" role="status"><p>Some rates could not be loaded and are not shown (nothing is estimated):</p><ul>${missing}</ul></div>`
    : '';
  const empty = !main.length
    ? '<p class="status-line" role="status">Rates are unavailable right now. Check your connection and try again.</p>'
    : '';
  return `${empty}<div class="rates-grid">${cards}</div>${details}${warn}`;
}

let timer = null;

/** Mount the rates view. Only one refresh timer ever exists, even if called again. */
export function mountRates(container, { refreshButton, onUpdate } = {}) {
  if (!container) return;
  let busy = false;
  const load = async () => {
    if (busy) return;
    busy = true;
    container.setAttribute('aria-busy', 'true');
    try {
      const result = await fetchPolicyRates();
      container.innerHTML = ratesHtml(result);
      onUpdate?.(result);
    } finally {
      busy = false;
      container.removeAttribute('aria-busy');
    }
  };
  container.innerHTML = '<p class="status-line" role="status">Loading policy rates…</p>';
  refreshButton?.addEventListener('click', load);
  if (timer) clearInterval(timer);
  timer = setInterval(load, REFRESH_MS);
  return load();
}
