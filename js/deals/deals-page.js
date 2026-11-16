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
import { COUPON_STORES, PROVIDERS, couponSearches, fallbackQuery, googleSearchUrl, helperQueries, unavailableProviders } from './providers.js';
import { initPriceWatch, priceMatchesHtml, snapshotInfo } from './price-watch.js';
import { ageLabel, couponThreads, filterThreads, loadDealPool, loadForumThreadsDetailed, mergeDealLists } from './forum.js';
import { DEALS_KEY, addToList, loadDeals, parseMoneyInput, saveDeals } from './model.js';

initThemeEverywhere();
initDisplay();

const $ = (id) => document.getElementById(id);
const THREADS_CACHE = 'deals.threads.v1';
const COLLECT_WORKFLOW = 'https://github.com/lcarlini/Calendra/actions/workflows/snapshot-feeds.yml';
const CACHE_MAX_AGE = 24 * 3600000;

let state = loadDeals();
let threads = []; // every community deal on screen: the pool plus the Adrenaline feed, newest first
let adrenaline = [];
let feed = { state: 'loading', message: '', fetchedAt: '', stale: false, via: '' };
let pool = { state: 'loading', message: '', threads: [], updatedAt: '', sources: {} };
const providerName = (id) => PROVIDERS.find((p) => p.id === id || p.poolId === id)?.name || id;
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
  const label = { pool: 'In the community deals · search link', snapshot: 'In the price watch · search link', via: 'Prices via Buscapé/Zoom · search link', unavailable: 'Search link only' }[provider.integration];
  return `<article class="provider-card">
    <header><h5>${esc(provider.name)}</h5><span class="badge badge-muted">${esc(label)}</span></header>
    <p class="muted">${esc(provider.role)}</p>
    <p class="reason">${esc(provider.reason || provider.detail)}</p>
    <div class="story-actions">
      <a class="btn btn-ghost btn-sm" href="${esc(googleSearchUrl(q))}" target="_blank" rel="noopener noreferrer">Open search on Google</a>
      <button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(q)}">Copy search query</button>
      <a class="btn btn-ghost btn-sm" href="${esc(provider.homepage)}" target="_blank" rel="noopener noreferrer">Open site</a>
    </div>
  </article>`;
}

const feedProblem = () => `Live refresh is throttled or unreachable right now (${esc(String(feed.message).replace(/HTTP 429/g, 'the free feed converter is rate-limiting this connection'))}).`;

function renderResults() {
  const box = $('deal-results');
  if (!lastQuery) {
    box.innerHTML = '<p class="status-line">Search for a product to check the community feed and get ready-made searches for the stores. Results from stores are never shown here: they are links you open yourself.</p>';
    return;
  }
  const all = filterThreads(threads, { q: lastQuery, hiddenIds: state.hiddenThreads });
  const matches = all.slice(0, 12);
  const scope = `${threads.length} recent deals from ${communityCount()} communities`;
  const feedPart =
    !threads.length && (feed.state === 'error' || pool.state === 'error')
      ? `<p class="status-line warn-text">${feedProblem()} Press the refresh button in a minute.</p>`
      : !threads.length
        ? '<p class="status-line">Loading the community deals…</p>'
        : matches.length
          ? `<div class="thread-list">${matches.map(threadCard).join('')}</div><p class="status-line">${all.length} match${all.length === 1 ? '' : 'es'}${all.length > matches.length ? ` (newest ${matches.length} shown; the Community deals list below shows them all)` : ''} among ${scope}.</p>`
          : `<p class="status-line">No deal among the ${scope} matches "${esc(lastQuery)}". Fewer or shorter words help (for example "ssd 1tb" instead of the full product name).</p>`;
  const others = unavailableProviders().map((p) => providerCard(p, lastQuery)).join('');
  const helpers = helperQueries(lastQuery)
    .map((h) => `<a class="chip" href="${esc(googleSearchUrl(h.query))}" target="_blank" rel="noopener noreferrer">${esc(h.label)}: Google</a>`)
    .join('');
  box.innerHTML = `
    <h4>From the price watch</h4>${priceMatchesHtml(lastQuery)}
    <h4>Community deals</h4>${feedPart}
    <h4>Search any store yourself</h4>
    <p class="status-line">Store search pages forbid automated reading (robots.txt), so a free-text search is a link you open: a Google search for "${esc(lastQuery)}" on each site, not live results.</p>
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
    source: $('f-source').value,
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
  const off = t.oldPrice && t.price ? Math.round((1 - t.price / t.oldPrice) * 100) : 0;
  const priceNote = t.priceSource === 'listing' ? 'as posted, not verified' : `stated in the ${esc(t.priceSource)}, not verified`;
  return `<article class="story-card thread${hidden ? ' is-hidden' : ''}${t.image ? ' has-thumb' : ''}" data-thread="${esc(t.id)}">
    ${t.image ? `<img class="thread-thumb" src="${esc(t.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}
    <div class="thread-body">
    <div class="story-top">
      <span class="badge badge-muted">${esc(providerName(t.sourceId))}</span>
      ${t.store ? `<span class="badge badge-ok">${esc(t.store)}</span>` : ''}
      <span class="badge badge-warn">Community-reported</span>
      <span class="muted">${esc(ageLabel(t.createdAt))}${t.author ? ` · ${esc(t.author)}` : ''}</span>
      ${t.possiblyExpired ? '<span class="badge badge-warn">Possibly expired (title says so)</span>' : ''}
      ${feed.stale && t.sourceId === 'adrenaline-ofertas' ? '<span class="badge badge-warn">Saved copy</span>' : ''}
    </div>
    <h4><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.title)}</a></h4>
    ${t.price != null ? `<p class="price-line">${esc(formatMoney(t.price, t.currency))}${t.oldPrice ? ` <s class="muted">${esc(formatMoney(t.oldPrice, t.currency))}</s> <span class="badge badge-ok">-${off}%</span>` : ''} <span class="muted">${priceNote}</span></p>` : ''}
    ${t.coupon ? `<p class="coupon-codes"><span class="coupon-pill"><code class="coupon-code">${esc(t.coupon)}</code><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(t.coupon)}">Copy coupon</button></span></p>` : ''}
    ${t.excerpt && !t.store ? `<p class="excerpt">${esc(t.excerpt)}</p>` : ''}
    <div class="story-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="thread-save" data-id="${esc(t.id)}" aria-pressed="${saved}">${saved ? 'Saved ★' : 'Save'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="thread-hide" data-id="${esc(t.id)}">${hidden ? 'Unhide' : 'Hide'}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(t.url)}">Copy link</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="thread-summary" data-id="${esc(t.id)}">Summarize</button>
    </div>
    <div class="summary-box" data-summary-for="${esc(t.id)}" hidden></div>
    </div>
  </article>`;
}

const communityCount = () => new Set(threads.map((t) => t.sourceId)).size;

function renderSourceFilter() {
  const select = $('f-source');
  const current = select.value;
  const counts = new Map();
  for (const t of threads) counts.set(t.sourceId, (counts.get(t.sourceId) || 0) + 1);
  select.innerHTML = `<option value="">All communities (${threads.length})</option>${[...counts]
    .map(([id, n]) => `<option value="${esc(id)}">${esc(providerName(id))} (${n})</option>`)
    .join('')}`;
  select.value = counts.has(current) ? current : '';
}

function renderFeed() {
  const status = $('feed-status');
  renderSourceFilter();
  const list = filterThreads(threads, feedFilters());
  const parts = [];
  if (pool.state === 'ok') {
    // GitHub runs the 30-minute schedule only every few hours on free repositories; the owner can start it by hand.
    const old = Date.now() - Date.parse(pool.updatedAt) > 2 * 3600000;
    parts.push(`${pool.threads.length} deals from Gatry, Promobit, Oferta Esperta and Pelando, collected ${timeAgo(pool.updatedAt)}${old ? ` (<a href="${COLLECT_WORKFLOW}" target="_blank" rel="noopener noreferrer">collect now on GitHub</a>: “Run workflow”)` : ''}`);
  }
  else if (pool.state === 'error') parts.push(`The community deal collection could not be read (${esc(pool.message)})`);
  if (feed.state === 'ok') parts.push(`${adrenaline.length} Adrenaline Ofertas threads, updated ${timeAgo(feed.fetchedAt)}${feed.via ? ` via ${esc(feed.via)}` : ''}`);
  else if (feed.state === 'error') parts.push(`Adrenaline Ofertas: ${feedProblem()} ${adrenaline.length ? `Showing its saved copy from ${esc(timeAgo(feed.fetchedAt))}.` : `It retries on its own, or press ↻.${loadNewsPrefs().rss2jsonKey ? '' : ' A free rss2json key (below) removes the limit.'}`}`);
  if (feed.state === 'loading' || pool.state === 'loading') parts.push('Loading…');
  status.innerHTML = parts.join(' · ');
  $('feed-count').textContent = threads.length ? `${list.length} of ${threads.length} deals` : '';
  // The full pool can be large: show the first 150 matches, the filters narrow it down.
  const shown = list.slice(0, 150);
  $('thread-list').innerHTML = threads.length
    ? shown.length
      ? shown.map(threadCard).join('') + (list.length > shown.length ? `<p class="status-line">${list.length - shown.length} more: add words or a price range to narrow the list.</p>` : '')
      : '<p class="status-line">No deal matches these filters.</p>'
    : '';
}

function combine() {
  threads = mergeDealLists(pool.threads, adrenaline);
}

async function loadAdrenaline(prefs, cached) {
  try {
    const result = await loadForumThreadsDetailed({
      proxyUrl: prefs.proxyUrl,
      rss2jsonKey: prefs.rss2jsonKey,
      snapshotBase: new URL('data/', location.href).href,
    });
    adrenaline = result.threads;
    cacheSet(THREADS_CACHE, { threads: adrenaline });
    feed = { state: 'ok', message: '', fetchedAt: result.fetchedAt || new Date().toISOString(), stale: false, via: result.via };
  } catch (error) {
    adrenaline = cached ? cached.value.threads : [];
    feed = { state: 'error', message: error.message, fetchedAt: cached?.fetchedAt || '', stale: Boolean(cached), via: '' };
  }
}

async function loadPool(force) {
  try {
    const result = await loadDealPool({ snapshotBase: new URL('data/', location.href).href, force });
    pool = { state: 'ok', message: '', ...result };
  } catch (error) {
    pool = { ...pool, state: 'error', message: error.message };
  }
}

async function loadFeed({ force = false } = {}) {
  const prefs = loadNewsPrefs();
  const cached = cacheGet(THREADS_CACHE, { maxAgeMs: CACHE_MAX_AGE });
  if (cached && !adrenaline.length) {
    adrenaline = cached.value.threads;
    feed = { state: 'loading', message: '', fetchedAt: cached.fetchedAt, stale: true, via: '' };
  } else {
    feed = { ...feed, state: 'loading' };
  }
  pool = { ...pool, state: 'loading' };
  combine();
  renderFeed();
  const done = () => {
    combine();
    renderFeed();
    renderResults();
    renderCoupons();
    renderProviders();
  };
  await Promise.all([loadAdrenaline(prefs, cached).then(done), loadPool(force).then(done)]);
  if (!threads.length && !autoRetried) {
    autoRetried = true;
    setTimeout(loadFeed, 60_000);
  }
}

// ---------------------------------------------------------------------------
// Coupon finder (links and community-posted codes; nothing is stored or verified)
// ---------------------------------------------------------------------------

function renderCoupons() {
  const query = $('coupon-q').value.trim();
  $('coupon-chips').innerHTML = COUPON_STORES.map((s) => `<button type="button" class="chip" data-coupon-store="${esc(s)}">${esc(s)}</button>`).join('');
  // Deals that carry a code first (newest first within each group), then threads that only talk about a coupon.
  const found = couponThreads(threads, query, { hiddenIds: state.hiddenThreads })
    .sort((x, y) => Number(y.codes.length > 0) - Number(x.codes.length > 0))
    .slice(0, 40);
  const community = found.length
    ? found
        .map(({ thread, codes }) => `<article class="deal-item coupon-find" data-coupon-thread="${esc(thread.id)}">
          <header class="story-top"><span class="badge badge-muted">${esc(providerName(thread.sourceId))}</span><span class="badge badge-warn">Community-reported · unverified</span><span class="muted">${esc(ageLabel(thread.createdAt))}</span>${feed.stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}</header>
          <h4><a href="${esc(thread.url)}" target="_blank" rel="noopener noreferrer">${esc(thread.title)}</a></h4>
          ${codes.length ? `<p class="coupon-codes">${codes.map((c) => `<span class="coupon-pill"><code class="coupon-code">${esc(c)}</code><button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(c)}">Copy code</button></span>`).join(' ')}</p>` : '<p class="status-line">No code in the title or excerpt: open the thread to see the offer.</p>'}
        </article>`)
        .join('')
    : feed.state === 'error' && pool.state === 'error' && !threads.length
      ? `<p class="status-line warn-text">${feedProblem()} The searches below still work.</p>`
      : (feed.state === 'loading' || pool.state === 'loading') && !threads.length
        ? '<p class="status-line">Loading the community feed…</p>'
        : `<p class="status-line">No coupon among the ${threads.length} recent deals${query ? ` mentions "${esc(query)}"` : ''}. Try another store, or use the searches below.</p>`;
  const searches = couponSearches(query)
    .map((s) => `<a class="chip" href="${esc(googleSearchUrl(s.query))}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`)
    .join('');
  $('coupon-results').innerHTML = `<h4>Found in the community feed</h4>${community}
    <h4>Search coupon sites</h4>
    <p class="status-line">Links to a Google search on each coupon site, not live results. Open them to see current codes.</p>
    <div class="chip-row">${searches}</div>
    <p class="status-line">Codes are only what people posted. Calendra cannot tell whether a code still works.</p>`;
}

function providerStatus(p, snap) {
  if (p.poolId && (p.integration === 'pool' || pool.state === 'ok')) {
    const s = pool.sources?.[p.poolId];
    const n = pool.threads.filter((t) => t.sourceId === p.poolId).length;
    if (s) {
      return s.ok
        ? { cls: 'badge-ok', label: 'Community deals', text: `${n} deals in the collection; ${s.count} read ${timeAgo(pool.updatedAt)}. ${p.detail}` }
        : { cls: n ? 'badge-ok' : 'badge-warn', label: n ? 'Community deals' : 'Refused', text: `${(s.errors || []).join(', ') || 'failed'} on the last run${n ? `; ${n} deals kept from earlier runs` : ''}${s.lastOk ? ` (last success ${timeAgo(s.lastOk)})` : ''}. ${p.detail}` };
    }
    if (p.integration === 'pool') return { cls: 'badge-muted', label: 'Community deals', text: pool.state === 'loading' ? 'Loading' : `Not read yet. ${p.detail}` };
  }
  if (p.integration === 'feed') {
    const live = feed.state === 'ok' ? `Live · ${adrenaline.length} threads · updated ${timeAgo(feed.fetchedAt)}` : feed.state === 'error' ? `Throttled: ${feed.message}` : 'Loading';
    return { cls: feed.state === 'ok' ? 'badge-ok' : 'badge-warn', label: 'Feed', text: `${live}. ${p.detail}` };
  }
  if (p.integration === 'snapshot') {
    const s = snap?.sources?.[p.snapshotId];
    if (!s) return { cls: 'badge-muted', label: 'Price watch', text: `Loading the snapshot. ${p.detail}` };
    return s.ok
      ? { cls: 'badge-ok', label: 'Working', text: `Answered ${s.ok} request(s) in the snapshot of ${timeAgo(snap.updatedAt)}. ${p.detail}` }
      : { cls: 'badge-warn', label: 'Refused', text: `${(s.errors || []).join(', ') || 'failed'} in the snapshot of ${timeAgo(snap.updatedAt)}${s.lastOk ? `; last success ${timeAgo(s.lastOk)}` : ''}. ${p.detail}` };
  }
  if (p.integration === 'via') {
    const re = new RegExp(p.storeMatch, 'i');
    const offers = (snap?.products || []).flatMap((x) => x.offers).filter((o) => re.test(o.store.replace('!', '')));
    return offers.length
      ? { cls: 'badge-ok', label: 'Via Buscapé/Zoom', text: `${offers.length} offer(s) from this store in the price watch. Direct access: ${p.reason}` }
      : { cls: 'badge-muted', label: 'Via Buscapé/Zoom', text: `No offer from this store among the watched products right now. Direct access: ${p.reason}` };
  }
  return { cls: 'badge-muted', label: 'Link only', text: p.reason };
}

function renderProviders() {
  const snap = snapshotInfo();
  $('provider-status').innerHTML = PROVIDERS.map((p) => {
    const s = providerStatus(p, snap);
    return `<li><span class="badge ${s.cls}">${esc(s.label)}</span> <strong>${esc(p.name)}</strong> <span class="muted">${esc(p.role)} · ${esc(s.text)}</span> <a href="${esc(p.homepage)}" target="_blank" rel="noopener noreferrer">Open site</a></li>`;
  }).join('');
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
  const articles = [{ sourceName: providerName(t.sourceId), title: t.title, excerpt: t.excerpt || '', originalUrl: t.url }];
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
$('feed-refresh').addEventListener('click', () => loadFeed({ force: true }));
$('coupon-q').addEventListener('input', renderCoupons);

onStoreChange([DEALS_KEY], () => {
  state = loadDeals();
  renderChips();
  renderFeed();
  renderCoupons();
});
onStoreChange([NEWS_KEY], () => loadFeed());

// A deal photo that does not load is removed, so the card falls back to text only.
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('thread-thumb')) return;
    img.closest('.thread')?.classList.remove('has-thumb');
    img.remove();
  },
  true
);

$('feed-key').value = loadNewsPrefs().rss2jsonKey;
renderAll();
loadFeed();
initPriceWatch().then(() => {
  renderResults();
  renderProviders();
});
