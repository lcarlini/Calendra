/**
 * Deals page. Every number is either typed by the user or comes from a labelled source.
 * The community feed is the only live data; everything else is local to this browser.
 */
import { initThemeEverywhere } from '../themes.js';
import { initDisplay } from '../core/display.js';
import { cacheGet, cacheSet } from '../core/cache.js';
import { copyText, esc, formatMoney, formatPercent, timeAgo } from '../core/format.js';
import { onStoreChange } from '../core/store.js';
import { loadNewsPrefs, NEWS_KEY } from '../news/loader.js';
import { fetchFxRates } from '../markets/providers.js';
import { sparklineSvg } from '../markets/chart.js';
import { prepareInputs, sendsToCloud, summarize } from '../ai/providers.js';
import { getApiKey, loadAiSettings } from '../ai/settings.js';
import { describeError, summaryHtml } from '../ai/summary-ui.js';
import { CHECKED_ON, PROVIDERS, fallbackQuery, googleSearchUrl, helperQueries, integratedProviders, unavailableProviders } from './providers.js';
import { ageLabel, filterThreads, loadForumThreads } from './forum.js';
import {
  DEALS_KEY,
  addAlertLog,
  addToList,
  compareUs,
  couponStatus,
  evaluateAlerts,
  isoToday,
  loadDeals,
  newCoupon,
  newItem,
  parseMoneyInput,
  priceStats,
  recordPrice,
  saveDeals,
} from './model.js';

initThemeEverywhere();
initDisplay();

const $ = (id) => document.getElementById(id);
const THREADS_CACHE = 'deals.threads.v1';

let state = loadDeals();
let threads = [];
let feed = { state: 'loading', message: '', fetchedAt: '', stale: false };
let lastQuery = '';
let activeSummary = null;

const persist = () => saveDeals(state);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function renderChips() {
  const saved = state.savedSearches.map((q) => `<span class="chip-static"><button type="button" class="chip" data-search="${esc(q)}">★ ${esc(q)}</button><button type="button" class="btn-icon" data-unsave="${esc(q)}" aria-label="Remove saved search ${esc(q)}">×</button></span>`);
  const recent = state.recentSearches.filter((q) => !state.savedSearches.includes(q)).map((q) => `<button type="button" class="chip" data-search="${esc(q)}">${esc(q)}</button>`);
  $('recent-searches').innerHTML = [...saved, ...recent].join('') || '<span class="status-line">Your recent and saved searches appear here.</span>';
}

function providerCard(provider, query) {
  const q = fallbackQuery(provider, query);
  return `<article class="provider-card">
    <header><h5>${esc(provider.name)}</h5><span class="badge badge-muted">Automated integration unavailable</span></header>
    <p class="muted">${esc(provider.role)}</p>
    <p class="reason">${esc(provider.reason)}</p>
    <div class="story-actions">
      <a class="btn btn-ghost btn-sm" href="${esc(googleSearchUrl(q))}" target="_blank" rel="noopener noreferrer">Open search on Google</a>
      <button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(q)}">Copy search query</button>
      <a class="btn btn-ghost btn-sm" href="${esc(provider.homepage)}" target="_blank" rel="noopener noreferrer">Open site</a>
    </div>
  </article>`;
}

function renderResults() {
  const box = $('deal-results');
  if (!lastQuery) {
    box.innerHTML = '<p class="status-line">Search for a product to check the community feed and get ready-made searches for the stores. Results from stores are never shown here: they are links you open yourself.</p>';
    return;
  }
  const matches = filterThreads(threads, { q: lastQuery, hiddenIds: state.hiddenThreads }).slice(0, 8);
  const feedPart =
    feed.state === 'needs-proxy'
      ? '<p class="status-line">The community feed needs the news proxy. <a href="news.html">Set its address on the News page</a> (the same proxy is used here).</p>'
      : feed.state === 'error' && !threads.length
        ? `<p class="status-line warn-text">The community feed could not be loaded: ${esc(feed.message)}</p>`
        : matches.length
          ? `<div class="thread-list">${matches.map(threadCard).join('')}</div><p class="status-line">Searched the ${threads.length} newest threads loaded from the feed${feed.stale ? ' (saved copy)' : ''}, not the forum's whole history.</p>`
          : `<p class="status-line">No thread among the ${threads.length} newest ones matches "${esc(lastQuery)}".</p>`;
  const others = unavailableProviders().map((p) => providerCard(p, lastQuery)).join('');
  const helpers = helperQueries(lastQuery)
    .map((h) => `<a class="chip" href="${esc(googleSearchUrl(h.query))}" target="_blank" rel="noopener noreferrer">${esc(h.label)}: Google</a>`)
    .join('');
  box.innerHTML = `
    <h4>Community feed matches</h4>${feedPart}
    <h4>Where automated search is unavailable</h4>
    <p class="status-line">These are links to a Google search for "${esc(lastQuery)}" on each site, not live results. Each card says why a direct integration is not offered.</p>
    <div class="chip-row">${helpers}</div>
    <div class="provider-grid">${others}</div>`;
}

function runSearch(query) {
  const q = String(query || '').trim();
  if (!q) return;
  lastQuery = q;
  $('deal-q').value = q;
  state = { ...state, recentSearches: addToList(state.recentSearches, q) };
  persist();
  renderChips();
  renderResults();
}

// ---------------------------------------------------------------------------
// Community feed
// ---------------------------------------------------------------------------

function feedFilters() {
  return {
    q: $('f-q').value,
    exclude: $('f-exclude').value.split(',').map((s) => s.trim()).filter(Boolean),
    minPrice: parseMoneyInput($('f-min').value),
    maxPrice: parseMoneyInput($('f-max').value),
    sinceHours: Number($('f-age').value) || 0,
    savedOnly: $('f-saved').checked,
    showHidden: $('f-hidden').checked,
    hiddenIds: state.hiddenThreads,
    savedIds: state.savedThreads,
  };
}

function threadCard(t) {
  const saved = state.savedThreads.includes(t.id);
  const hidden = state.hiddenThreads.includes(t.id);
  const provider = PROVIDERS.find((p) => p.id === t.sourceId);
  return `<article class="story-card thread${hidden ? ' is-hidden' : ''}" data-thread="${esc(t.id)}">
    <div class="story-top">
      <span class="badge badge-muted">${esc(provider ? provider.name : t.sourceId)}</span>
      <span class="badge badge-warn">Community-reported</span>
      <span class="muted">${esc(ageLabel(t.createdAt))}${t.author ? ` · ${esc(t.author)}` : ''}</span>
      ${t.possiblyExpired ? '<span class="badge badge-warn">Possibly expired (title says so)</span>' : ''}
      ${feed.stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}
    </div>
    <h4><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.title)}</a></h4>
    ${t.price != null ? `<p class="price-line">${esc(formatMoney(t.price, t.currency))} <span class="muted">stated in the ${esc(t.priceSource)}, not verified</span></p>` : ''}
    ${t.excerpt ? `<p class="excerpt">${esc(t.excerpt)}</p>` : ''}
    <div class="story-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="thread-save" data-id="${esc(t.id)}" aria-pressed="${saved}">${saved ? 'Saved ★' : 'Save'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="thread-hide" data-id="${esc(t.id)}">${hidden ? 'Unhide' : 'Hide'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(t.url)}">Copy link</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="thread-summary" data-id="${esc(t.id)}">Summarize</button>
    </div>
    <div class="summary-box" data-summary-for="${esc(t.id)}" hidden></div>
  </article>`;
}

function renderFeed() {
  const status = $('feed-status');
  const list = filterThreads(threads, feedFilters());
  if (feed.state === 'loading' && !threads.length) status.textContent = 'Loading the community feed…';
  else if (feed.state === 'needs-proxy' && !threads.length) status.innerHTML = 'The community feed needs the news proxy. <a href="news.html">Set its address on the News page</a>: the same proxy serves both pages.';
  else if (feed.state === 'error') status.textContent = `Could not refresh: ${feed.message}${threads.length ? ' Showing the saved copy.' : ''}`;
  else status.textContent = feed.fetchedAt ? `Updated ${timeAgo(feed.fetchedAt)}${feed.stale ? ' (saved copy)' : ''} · source: Adrenaline Ofertas RSS feed` : '';
  $('feed-count').textContent = threads.length ? `${list.length} of ${threads.length} threads` : '';
  $('thread-list').innerHTML = threads.length ? list.map(threadCard).join('') || '<p class="status-line">No thread matches these filters.</p>' : '';
}

async function loadFeed() {
  const proxyUrl = loadNewsPrefs().proxyUrl;
  const cached = cacheGet(THREADS_CACHE, { maxAgeMs: 6 * 3600000 });
  feed = { ...feed, state: 'loading' };
  renderFeed();
  try {
    threads = await loadForumThreads({ proxyUrl });
    cacheSet(THREADS_CACHE, { threads });
    feed = { state: 'ok', message: '', fetchedAt: new Date().toISOString(), stale: false };
  } catch (error) {
    if (cached) {
      threads = cached.value.threads;
      feed = { state: 'error', message: error.message, fetchedAt: cached.fetchedAt, stale: true };
    } else {
      threads = [];
      feed = { state: 'error', message: error.message, fetchedAt: '', stale: false };
    }
  }
  renderFeed();
  renderResults();
  renderProviders();
}

// ---------------------------------------------------------------------------
// Tracked products
// ---------------------------------------------------------------------------

function usResultHtml(item) {
  if (!item.us) return '';
  const r = compareUs({ ...item.us, brPrice: item.country === 'BR' ? item.observations.at(-1)?.price ?? null : null });
  if (r.total == null) return `<p class="status-line">${esc(r.note)}</p>`;
  const rows = r.components.map((c) => `<tr><th scope="row">${esc(c.label)}</th><td class="num">${c.usd != null ? esc(formatMoney(c.usd, 'USD', 'en-US')) : ''}</td><td class="num">${esc(formatMoney(c.brl, 'BRL'))}</td></tr>`).join('');
  const versus = r.versus
    ? `<p>Brazilian price ${esc(formatMoney(r.versus.brPrice, 'BRL'))} is <strong>${esc(formatPercent(Math.abs(r.versus.percent), 1).replace('+', ''))} ${r.versus.differenceBrl >= 0 ? 'above' : 'below'}</strong> this estimate (${esc(formatMoney(Math.abs(r.versus.differenceBrl), 'BRL'))}).</p>`
    : '<p class="status-line">Record a Brazilian price to compare.</p>';
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="US price breakdown"><table class="data-table"><thead><tr><th scope="col">Component</th><th scope="col" class="num">USD</th><th scope="col" class="num">BRL</th></tr></thead><tbody>${rows}<tr><th scope="row">Estimate</th><td></td><td class="num"><strong>${esc(formatMoney(r.total, 'BRL'))}</strong></td></tr></tbody></table></div>
    ${versus}
    <p class="status-line">Exchange rate used: ${esc(String(item.us.rate))} BRL per USD (${esc(item.us.rateSource || 'entered by you')}). ${esc(r.note)}</p>`;
}

function itemCard(item) {
  const stats = priceStats(item.observations);
  const prices = item.observations.map((o) => o.price);
  const us = item.us || {};
  const val = (v) => (v == null ? '' : String(v));
  return `<article class="deal-item" data-item="${esc(item.id)}">
    <header class="story-top">
      <h4>${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>` : esc(item.title)}</h4>
      <span class="badge badge-muted">${esc(item.country)} · ${esc(item.currency)} · ${esc(item.condition)}</span>
      ${item.store ? `<span class="badge badge-muted">${esc(item.store)}</span>` : ''}
    </header>
    ${
      stats
        ? `<dl class="stat-grid">
        <div><dt>Latest</dt><dd>${esc(formatMoney(stats.current, item.currency))}<small> ${esc(stats.currentDate)}</small></dd></div>
        <div><dt>Lowest</dt><dd>${esc(formatMoney(stats.lowest, item.currency))}</dd></div>
        <div><dt>Highest</dt><dd>${esc(formatMoney(stats.highest, item.currency))}</dd></div>
        <div><dt>Average</dt><dd>${esc(formatMoney(stats.average, item.currency))}</dd></div>
        <div><dt>Trend</dt><dd>${stats.trend ? esc(stats.trend) : 'needs 2 prices'}</dd></div>
        <div><dt>Last drop</dt><dd>${stats.lastDrop ? `${esc(formatPercent(-stats.lastDrop.percent, 1))} on ${esc(stats.lastDrop.date)}` : 'none recorded'}</dd></div>
      </dl>
      <div class="spark-row">${sparklineSvg(prices, { width: 160, height: 36, label: `${item.title} recorded prices` }) || '<span class="muted">Record one more price to see a chart.</span>'}<span class="muted">${stats.count} price${stats.count === 1 ? '' : 's'} · ${esc(stats.origin)}</span></div>`
        : '<p class="status-line">No prices recorded yet. No price history exists until you add prices.</p>'
    }
    <form class="deal-form inline-grid" data-form="record" data-id="${esc(item.id)}" autocomplete="off">
      <label>Price seen (${esc(item.currency)})<input name="price" type="text" inputmode="decimal" required /></label>
      <label>Date<input name="date" type="date" value="${isoToday()}" max="${isoToday()}" /></label>
      <button type="submit" class="btn btn-primary btn-sm">Record price</button>
    </form>
    <details class="how-details"><summary>Alert rules</summary>
      <form class="deal-form inline-grid" data-form="alert" data-id="${esc(item.id)}" autocomplete="off">
        <label>Target price<input name="target" type="text" inputmode="decimal" value="${esc(val(item.alert?.targetPrice))}" /></label>
        <label>Drop % from highest<input name="drop" type="text" inputmode="decimal" value="${esc(val(item.alert?.dropPercent))}" /></label>
        <button type="submit" class="btn btn-ghost btn-sm">Save rules</button>
      </form>
      <p class="status-line">Checked each time you record a price. Leave a box empty for no rule.</p>
    </details>
    <details class="how-details"><summary>Compare with a US price</summary>
      <form class="deal-form inline-grid" data-form="us" data-id="${esc(item.id)}" autocomplete="off">
        <label>US price (USD)<input name="priceUsd" type="text" inputmode="decimal" value="${esc(val(us.priceUsd))}" /></label>
        <label>Shipping (USD)<input name="shippingUsd" type="text" inputmode="decimal" value="${esc(val(us.shippingUsd))}" /></label>
        <label>Import duty %<input name="dutyPercent" type="text" inputmode="decimal" value="${esc(val(us.dutyPercent))}" /></label>
        <label>Tax %<input name="taxPercent" type="text" inputmode="decimal" value="${esc(val(us.taxPercent))}" /></label>
        <label>Other costs (BRL)<input name="otherBrl" type="text" inputmode="decimal" value="${esc(val(us.otherBrl))}" /></label>
        <label>BRL per USD<input name="rate" type="text" inputmode="decimal" value="${esc(val(us.rate))}" /></label>
        <button type="submit" class="btn btn-primary btn-sm">Calculate</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="use-fx" data-id="${esc(item.id)}">Use today's BCB rate</button>
      </form>
      <p class="status-line">Only what you fill in is counted. Duty and tax are never guessed. The BCB rate is an end-of-day sell rate.</p>
      <div data-us-result="${esc(item.id)}">${usResultHtml(item)}</div>
    </details>
    <div class="story-actions">
      <a class="btn btn-ghost btn-sm" href="${esc(googleSearchUrl(`${item.title} histórico de preço`))}" target="_blank" rel="noopener noreferrer">Price history on Google</a>
      ${item.url ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(item.url)}">Copy link</button>` : ''}
      <button type="button" class="btn btn-ghost btn-sm danger" data-action="item-delete" data-id="${esc(item.id)}">Delete</button>
    </div>
  </article>`;
}

function renderItems() {
  $('item-list').innerHTML = state.items.length ? state.items.map(itemCard).join('') : '<p class="status-line">Nothing tracked yet.</p>';
}

// ---------------------------------------------------------------------------
// Coupons, alerts, providers
// ---------------------------------------------------------------------------

function renderCoupons() {
  $('coupon-list').innerHTML = state.coupons.length
    ? state.coupons
        .map((c) => {
          const s = couponStatus(c);
          const badge = s.state === 'expired' ? 'badge-warn' : s.state === 'valid' || s.state === 'expires-today' ? 'badge-ok' : 'badge-muted';
          return `<article class="deal-item" data-coupon="${esc(c.id)}">
            <header class="story-top"><h4>${esc(c.store)}</h4><span class="badge ${badge}">${esc(s.label)}</span><span class="badge badge-muted">Unverified · ${esc(c.source)}</span></header>
            <p><code class="coupon-code">${esc(c.code)}</code> ${c.description ? `· ${esc(c.description)}` : ''}</p>
            ${c.conditions ? `<p class="excerpt">${esc(c.conditions)}</p>` : ''}
            ${c.minPurchase != null ? `<p class="excerpt">Minimum purchase: ${esc(formatMoney(c.minPurchase, 'BRL'))}</p>` : ''}
            <p class="status-line">Added ${esc(c.addedAt)}. Calendra cannot check whether this code works.</p>
            <div class="story-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(c.code)}">Copy code</button>
              ${c.url ? `<a class="btn btn-ghost btn-sm" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open store</a>` : ''}
              <button type="button" class="btn btn-ghost btn-sm danger" data-action="coupon-delete" data-id="${esc(c.id)}">Delete</button>
            </div></article>`;
        })
        .join('')
    : '<p class="status-line">No coupons saved.</p>';
}

function renderAlerts() {
  $('alert-log').innerHTML = state.alerts.length
    ? state.alerts.map((a) => `<li class="${a.read ? 'read' : 'unread'}"><span class="muted">${esc(timeAgo(a.at))}</span> ${esc(a.text)} ${a.read ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-action="alert-read" data-id="${esc(a.id)}">Mark read</button>`}</li>`).join('')
    : '<li class="status-line">No alerts yet.</li>';
  const supported = typeof Notification !== 'undefined';
  $('notify-enable').hidden = !supported || Notification.permission === 'granted';
}

function renderProviders() {
  const live = feed.state === 'ok' ? `Live · ${threads.length} threads · updated ${timeAgo(feed.fetchedAt)}` : feed.state === 'needs-proxy' ? 'Needs the news proxy' : feed.state === 'error' ? `Error: ${feed.message}` : 'Loading';
  $('provider-status').innerHTML = [
    ...integratedProviders().map((p) => `<li><span class="badge ${feed.state === 'ok' ? 'badge-ok' : 'badge-warn'}">Feed</span> <strong>${esc(p.name)}</strong> <span class="muted">${esc(p.role)} · ${esc(live)}. ${esc(p.detail)}</span> <a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">Open</a></li>`),
    ...unavailableProviders().map((p) => `<li><span class="badge badge-muted">Unavailable</span> <strong>${esc(p.name)}</strong> <span class="muted">${esc(p.role)}. ${esc(p.reason)}</span> <a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">Open site</a></li>`),
  ].join('');
}

function renderAll() {
  renderChips();
  renderResults();
  renderFeed();
  renderItems();
  renderCoupons();
  renderAlerts();
  renderProviders();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function notify(messages) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const m of messages) {
    try {
      new Notification('Calendra price alert', { body: m.text });
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

const itemById = (id) => state.items.find((i) => i.id === id);
function updateItem(id, fn) {
  state = { ...state, items: state.items.map((i) => (i.id === id ? fn(i) : i)) };
  persist();
}
const formNum = (form, name) => parseMoneyInput(form.elements[name]?.value);

async function summarizeThread(id, button) {
  const t = threads.find((x) => x.id === id);
  const box = document.querySelector(`[data-summary-for="${CSS.escape(id)}"]`);
  if (!t || !box) return;
  const settings = loadAiSettings();
  box.hidden = false;
  if (settings.provider === 'off') {
    box.innerHTML = '<p class="status-line">AI summaries are off. <a href="settings.html">Choose a provider in Settings</a> to enable them. Nothing is sent anywhere until you do.</p>';
    return;
  }
  const articles = [{ sourceName: 'Adrenaline Ofertas', title: t.title, excerpt: t.excerpt || '', originalUrl: t.url }];
  const inputs = prepareInputs(articles);
  if (activeSummary) activeSummary.abort();
  const controller = new AbortController();
  activeSummary = controller;
  const where = sendsToCloud(settings) ? 'Anthropic (a cloud service)' : `your local endpoint (${esc(settings.baseUrl)})`;
  box.innerHTML = `<p class="status-line" role="status">Sending this thread's title${inputs.items[0].excerpt ? ' and short excerpt' : ''} to ${where}… <button type="button" class="btn btn-ghost btn-sm" data-cancel-summary>Cancel</button></p>`;
  box.querySelector('[data-cancel-summary]').addEventListener('click', () => controller.abort());
  try {
    box.innerHTML = summaryHtml(await summarize({ settings, apiKey: getApiKey(), mode: 'short', articles, signal: controller.signal }));
  } catch (error) {
    box.innerHTML = error?.code === 'cancelled' ? '<p class="status-line">Cancelled.</p>' : `<p class="status-line summary-error" role="alert">${describeError(error)}</p>`;
  } finally {
    if (activeSummary === controller) activeSummary = null;
  }
}

document.addEventListener('click', async (event) => {
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    const ok = await copyText(copy.dataset.copy);
    const old = copy.textContent;
    copy.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => (copy.textContent = old), 1500);
    return;
  }
  const search = event.target.closest('[data-search]');
  if (search) return runSearch(search.dataset.search);
  const unsave = event.target.closest('[data-unsave]');
  if (unsave) {
    state = { ...state, savedSearches: state.savedSearches.filter((q) => q !== unsave.dataset.unsave) };
    persist();
    return renderChips();
  }
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'thread-save': {
      const has = state.savedThreads.includes(id);
      state = { ...state, savedThreads: has ? state.savedThreads.filter((x) => x !== id) : [...state.savedThreads, id] };
      persist();
      renderFeed();
      renderResults();
      break;
    }
    case 'thread-hide': {
      const has = state.hiddenThreads.includes(id);
      state = { ...state, hiddenThreads: has ? state.hiddenThreads.filter((x) => x !== id) : [...state.hiddenThreads, id] };
      persist();
      renderFeed();
      renderResults();
      break;
    }
    case 'thread-summary':
      summarizeThread(id, btn);
      break;
    case 'item-delete':
      if (window.confirm('Delete this product and its recorded prices?')) {
        state = { ...state, items: state.items.filter((i) => i.id !== id) };
        persist();
        renderItems();
      }
      break;
    case 'coupon-delete':
      state = { ...state, coupons: state.coupons.filter((c) => c.id !== id) };
      persist();
      renderCoupons();
      break;
    case 'alert-read':
      state = { ...state, alerts: state.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) };
      persist();
      renderAlerts();
      break;
    case 'use-fx': {
      const form = document.querySelector(`[data-form="us"][data-id="${CSS.escape(id)}"]`);
      btn.disabled = true;
      const { rates, errors } = await fetchFxRates();
      btn.disabled = false;
      const usd = rates.find((r) => r.id === 'usdbrl');
      if (!usd) {
        form.insertAdjacentHTML('afterend', `<p class="status-line warn-text" role="alert">The exchange rate could not be loaded (${esc(errors.usdbrl || 'unavailable')}). Type a rate instead.</p>`);
        break;
      }
      form.elements.rate.value = String(usd.value);
      form.dataset.rateSource = `BCB end-of-day USD sell rate for ${usd.date}`;
      form.requestSubmit();
      break;
    }
    default:
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'deal-search') {
    event.preventDefault();
    return runSearch($('deal-q').value);
  }
  if (form.id === 'item-form') {
    event.preventDefault();
    let item = newItem({ title: $('i-title').value, url: $('i-url').value, store: $('i-store').value, country: $('i-country').value, currency: $('i-currency').value, condition: $('i-condition').value });
    if (!item) return;
    const first = parseMoneyInput($('i-price').value);
    if (first != null) item = recordPrice(item, first);
    state = { ...state, items: [item, ...state.items] };
    persist();
    form.reset();
    return renderItems();
  }
  if (form.id === 'coupon-form') {
    event.preventDefault();
    const coupon = newCoupon({ store: $('c-store').value, code: $('c-code').value, description: $('c-desc').value, conditions: $('c-cond').value, minPurchase: $('c-min').value, expiresOn: $('c-exp').value, url: $('c-url').value });
    if (!coupon) return;
    state = { ...state, coupons: [coupon, ...state.coupons] };
    persist();
    form.reset();
    return renderCoupons();
  }
  const kind = form.dataset?.form;
  if (!kind) return;
  event.preventDefault();
  const id = form.dataset.id;
  const item = itemById(id);
  if (!item) return;
  if (kind === 'record') {
    const price = formNum(form, 'price');
    if (price == null) return;
    const date = form.elements.date.value || isoToday();
    const before = item.observations;
    const next = recordPrice(item, price, date);
    const messages = evaluateAlerts(next, price, before.filter((o) => o.date !== date));
    updateItem(id, () => next);
    if (messages.length) {
      state = addAlertLog(state, messages);
      persist();
      notify(messages);
    }
    renderItems();
    renderAlerts();
  } else if (kind === 'alert') {
    updateItem(id, (i) => ({ ...i, alert: { targetPrice: formNum(form, 'target'), dropPercent: formNum(form, 'drop') } }));
    renderItems();
  } else if (kind === 'us') {
    const us = {
      priceUsd: formNum(form, 'priceUsd'),
      shippingUsd: formNum(form, 'shippingUsd'),
      dutyPercent: formNum(form, 'dutyPercent'),
      taxPercent: formNum(form, 'taxPercent'),
      otherBrl: formNum(form, 'otherBrl'),
      rate: formNum(form, 'rate'),
      rateSource: form.dataset.rateSource || 'entered by you',
    };
    updateItem(id, (i) => ({ ...i, us }));
    renderItems();
    // keep the US panel open so the result stays in view
    document.querySelector(`[data-item="${CSS.escape(id)}"] [data-us-result]`)?.closest('details')?.setAttribute('open', '');
  }
});

$('save-search').addEventListener('click', () => {
  const q = $('deal-q').value.trim();
  if (!q) return;
  state = { ...state, savedSearches: addToList(state.savedSearches, q, 20) };
  persist();
  renderChips();
});
$('feed-filters').addEventListener('input', renderFeed);
$('feed-filters').addEventListener('submit', (e) => e.preventDefault());
$('feed-refresh').addEventListener('click', loadFeed);
$('notify-enable').addEventListener('click', async () => {
  try {
    await Notification.requestPermission();
  } catch {
    /* unsupported */
  }
  renderAlerts();
});
$('alerts-clear').addEventListener('click', () => {
  state = { ...state, alerts: [] };
  persist();
  renderAlerts();
});

onStoreChange([DEALS_KEY], () => {
  state = loadDeals();
  renderChips();
  renderItems();
  renderCoupons();
  renderAlerts();
  renderFeed();
});
onStoreChange([NEWS_KEY], loadFeed);

renderAll();
loadFeed();
