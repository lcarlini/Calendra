/**
 * Deals page: FIND things, never register them. A community deal feed (the only live data), ready searches for
 * stores and coupon sites, and a coupon finder over the community threads. Every price is labelled with its source.
 * Only light preferences (recent/saved searches, saved/hidden threads) are kept in this browser.
 */
import { initThemeEverywhere } from '../themes.js';
import { initDisplay } from '../core/display.js';
import { cacheGet, cacheSet } from '../core/cache.js';
import { copyText, esc, formatMoney, timeAgo } from '../core/format.js';
import { onStoreChange } from '../core/store.js';
import { loadNewsPrefs, NEWS_KEY, saveNewsPrefs } from '../news/loader.js';
import { prepareInputs, sendsToCloud, summarize } from '../ai/providers.js';
import { getApiKey, loadAiSettings } from '../ai/settings.js';
import { describeError, summaryHtml } from '../ai/summary-ui.js';
import { COUPON_STORES, PROVIDERS, couponSearches, fallbackQuery, googleSearchUrl, helperQueries, integratedProviders, unavailableProviders } from './providers.js';
import { ageLabel, couponThreads, filterThreads, loadForumThreadsDetailed } from './forum.js';
import { DEALS_KEY, addToList, loadDeals, parseMoneyInput, saveDeals } from './model.js';

initThemeEverywhere();
initDisplay();

const $ = (id) => document.getElementById(id);
const THREADS_CACHE = 'deals.threads.v1';
const CACHE_MAX_AGE = 24 * 3600000;

let state = loadDeals();
let threads = [];
let feed = { state: 'loading', message: '', fetchedAt: '', stale: false, via: '' };
let lastQuery = '';
let activeSummary = null;
let autoRetried = false;

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

const feedProblem = () => `Live refresh is throttled or unreachable right now (${esc(feed.message)}).`;

function renderResults() {
  const box = $('deal-results');
  if (!lastQuery) {
    box.innerHTML = '<p class="status-line">Search for a product to check the community feed and get ready-made searches for the stores. Results from stores are never shown here: they are links you open yourself.</p>';
    return;
  }
  const matches = filterThreads(threads, { q: lastQuery, hiddenIds: state.hiddenThreads }).slice(0, 8);
  const feedPart =
    feed.state === 'error' && !threads.length
      ? `<p class="status-line warn-text">${feedProblem()} Press the refresh button in a minute.</p>`
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
  else if (feed.state === 'error') status.innerHTML = `${feedProblem()} ${threads.length ? `Showing the saved copy from ${esc(timeAgo(feed.fetchedAt))}.` : `It retries on its own, or press ↻.${loadNewsPrefs().rss2jsonKey ? '' : ' A free rss2json key (below) removes the limit.'}`}`;
  else status.textContent = feed.fetchedAt ? `Updated ${timeAgo(feed.fetchedAt)}${feed.stale ? ' (saved copy)' : ''} · source: Adrenaline Ofertas RSS feed${feed.via ? ` · via ${feed.via}` : ''}` : '';
  $('feed-count').textContent = threads.length ? `${list.length} of ${threads.length} threads` : '';
  $('thread-list').innerHTML = threads.length ? list.map(threadCard).join('') || '<p class="status-line">No thread matches these filters.</p>' : '';
}

async function loadFeed() {
  const prefs = loadNewsPrefs();
  const cached = cacheGet(THREADS_CACHE, { maxAgeMs: CACHE_MAX_AGE });
  if (cached && !threads.length) {
    threads = cached.value.threads;
    feed = { state: 'loading', message: '', fetchedAt: cached.fetchedAt, stale: true, via: '' };
  } else {
    feed = { ...feed, state: 'loading' };
  }
  renderFeed();
  try {
    const result = await loadForumThreadsDetailed({ proxyUrl: prefs.proxyUrl, rss2jsonKey: prefs.rss2jsonKey });
    threads = result.threads;
    cacheSet(THREADS_CACHE, { threads });
    feed = { state: 'ok', message: '', fetchedAt: new Date().toISOString(), stale: false, via: result.via };
  } catch (error) {
    if (cached) {
      threads = cached.value.threads;
      feed = { state: 'error', message: error.message, fetchedAt: cached.fetchedAt, stale: true, via: '' };
    } else {
      threads = [];
      feed = { state: 'error', message: error.message, fetchedAt: '', stale: false, via: '' };
    }
    if (!threads.length && !autoRetried) {
      autoRetried = true;
      setTimeout(loadFeed, 60_000);
    }
  }
  renderFeed();
  renderResults();
  renderCoupons();
  renderProviders();
}

// ---------------------------------------------------------------------------
// Coupon finder (links and community-posted codes; nothing is stored or verified)
// ---------------------------------------------------------------------------

function renderCoupons() {
  const query = $('coupon-q').value.trim();
  $('coupon-chips').innerHTML = COUPON_STORES.map((s) => `<button type="button" class="chip" data-coupon-store="${esc(s)}">${esc(s)}</button>`).join('');
  const found = couponThreads(threads, query, { hiddenIds: state.hiddenThreads }).slice(0, 12);
  const community = found.length
    ? found
        .map(({ thread, codes }) => `<article class="deal-item coupon-find" data-coupon-thread="${esc(thread.id)}">
          <header class="story-top"><span class="badge badge-warn">Community-reported · unverified</span><span class="muted">${esc(ageLabel(thread.createdAt))}</span>${feed.stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}</header>
          <h4><a href="${esc(thread.url)}" target="_blank" rel="noopener noreferrer">${esc(thread.title)}</a></h4>
          ${codes.length ? `<p class="coupon-codes">${codes.map((c) => `<span class="coupon-pill"><code class="coupon-code">${esc(c)}</code><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(c)}">Copy code</button></span>`).join(' ')}</p>` : '<p class="status-line">No code in the title or excerpt: open the thread to see the offer.</p>'}
        </article>`)
        .join('')
    : feed.state === 'error' && !threads.length
      ? `<p class="status-line warn-text">${feedProblem()} The searches below still work.</p>`
      : feed.state === 'loading' && !threads.length
        ? '<p class="status-line">Loading the community feed…</p>'
        : `<p class="status-line">No coupon thread among the ${threads.length} newest ones${query ? ` mentions "${esc(query)}"` : ''}. Try another store, or use the searches below.</p>`;
  const searches = couponSearches(query)
    .map((s) => `<a class="chip" href="${esc(googleSearchUrl(s.query))}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`)
    .join('');
  $('coupon-results').innerHTML = `<h4>Found in the community feed</h4>${community}
    <h4>Search coupon sites</h4>
    <p class="status-line">Links to a Google search on each coupon site, not live results. Open them to see current codes.</p>
    <div class="chip-row">${searches}</div>
    <p class="status-line">Codes are only what people posted. Calendra cannot tell whether a code still works.</p>`;
}

function renderProviders() {
  const live = feed.state === 'ok' ? `Live · ${threads.length} threads · updated ${timeAgo(feed.fetchedAt)}` : feed.state === 'error' ? `Throttled: ${feed.message}` : 'Loading';
  $('provider-status').innerHTML = [
    ...integratedProviders().map((p) => `<li><span class="badge ${feed.state === 'ok' ? 'badge-ok' : 'badge-warn'}">Feed</span> <strong>${esc(p.name)}</strong> <span class="muted">${esc(p.role)} · ${esc(live)}. ${esc(p.detail)}</span> <a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">Open</a></li>`),
    ...unavailableProviders().map((p) => `<li><span class="badge badge-muted">Unavailable</span> <strong>${esc(p.name)}</strong> <span class="muted">${esc(p.role)}. ${esc(p.reason)}</span> <a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">Open site</a></li>`),
  ].join('');
}

function renderAll() {
  renderChips();
  renderResults();
  renderFeed();
  renderCoupons();
  renderProviders();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function summarizeThread(id) {
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
  const store = event.target.closest('[data-coupon-store]');
  if (store) {
    $('coupon-q').value = store.dataset.couponStore;
    return renderCoupons();
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
      renderCoupons();
      break;
    }
    case 'thread-summary':
      summarizeThread(id);
      break;
    default:
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'deal-search') {
    event.preventDefault();
    return runSearch($('deal-q').value);
  }
  if (form.id === 'feed-key-form') {
    event.preventDefault();
    saveNewsPrefs({ ...loadNewsPrefs(), rss2jsonKey: $('feed-key').value.trim() });
    autoRetried = false;
    loadFeed();
    return;
  }
  if (form.id === 'coupon-search') {
    event.preventDefault();
    renderCoupons();
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
$('coupon-q').addEventListener('input', renderCoupons);

onStoreChange([DEALS_KEY], () => {
  state = loadDeals();
  renderChips();
  renderFeed();
  renderCoupons();
});
onStoreChange([NEWS_KEY], loadFeed);

$('feed-key').value = loadNewsPrefs().rss2jsonKey;
renderAll();
loadFeed();
