/**
 * News page: loads feeds through the proxy, groups articles into stories, and offers on-demand
 * AI summaries with visible provenance. All text from publishers is escaped before display.
 */
import { initTheme } from '../themes.js';
import { initDisplay } from '../core/display.js';
import { esc, timeAgo } from '../core/format.js';
import { onStoreChange } from '../core/store.js';
import { SOURCES, TABS, integratedSources } from './sources.js';
import { buildStories, explainCluster } from './cluster.js';
import { dateCutoff, loadNews, loadNewsPrefs, normalizeProxyUrl, saveNewsPrefs, searchArticles, NEWS_KEY } from './loader.js';
import { prepareInputs, sendsToCloud, summarize } from '../ai/providers.js';
import { getApiKey, loadAiSettings, AI_KEY } from '../ai/settings.js';
import { describeError, summaryHtml } from '../ai/summary-ui.js';

initTheme();
initDisplay();

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 10 * 60 * 1000;

let prefs = loadNewsPrefs();
let data = { articles: [], statuses: [], fetchedAt: '' };
let stories = [];
let loading = false;
let activeSummary = null; // { controller }

function setupHtml() {
  const hasProxy = Boolean(prefs.proxyUrl);
  return `
    <h3 id="setup-h">${hasProxy ? 'News proxy' : 'Live feeds need the news proxy'}</h3>
    <p class="status-line">
      The publishers' RSS feeds cannot be read directly by a web page (they send no CORS headers), so Calendra uses a small
      companion proxy that only fetches these feeds, never arbitrary addresses. ${hasProxy ? '' : 'Until one is configured, no live headlines are shown.'}
    </p>
    <form id="proxy-form" class="inline-form" autocomplete="off">
      <label for="proxy-url">Proxy address</label>
      <input id="proxy-url" type="url" inputmode="url" placeholder="http://127.0.0.1:8791" value="${esc(prefs.proxyUrl)}" />
      <button type="submit" class="btn btn-primary btn-sm">Save</button>
      ${hasProxy ? '<button type="button" class="btn btn-ghost btn-sm" id="proxy-clear">Remove</button>' : ''}
    </form>
    <details class="how-details"${hasProxy ? '' : ' open'}>
      <summary>How to run the proxy</summary>
      <ol>
        <li>On your own computer: <code>ALLOWED_ORIGINS=https://lcarlini.github.io node backend/news-proxy/server.mjs</code> then use <code>http://127.0.0.1:8791</code>. Chrome asks you to allow “local network access” before an https page (like this site) may call a server on your own computer. If you decline, or your browser does not offer it, use option 2 and deploy the proxy over https.</li>
        <li>Or deploy <code>backend/news-proxy</code> as a Cloudflare Worker (<code>npx wrangler deploy</code>) and paste its https address here.</li>
        <li>Set <code>ALLOWED_ORIGINS</code> to the exact site address that will read it. The proxy refuses every other origin.</li>
      </ol>
    </details>`;
}

function renderSetup() {
  const el = $('news-setup');
  el.hidden = false;
  el.innerHTML = setupHtml();
}

function renderTabs() {
  $('news-tabs').innerHTML = TABS.map(
    (t) => `<button type="button" role="tab" class="chip${t.id === prefs.tab ? ' active' : ''}" data-tab="${t.id}" aria-selected="${t.id === prefs.tab}">${esc(t.label)}</button>`
  ).join('');
  $('news-date').value = prefs.date;
  $('news-sources').innerHTML = integratedSources()
    .map((s) => {
      const on = !prefs.disabledSources.includes(s.id);
      return `<label class="check-pill"><input type="checkbox" data-source="${esc(s.id)}"${on ? ' checked' : ''} /><span>${esc(s.name)}</span></label>`;
    })
    .join('');
}

function visibleArticles() {
  const cutoff = dateCutoff(prefs.date);
  let list = data.articles.filter((a) => !prefs.disabledSources.includes(a.sourceId));
  if (cutoff) list = list.filter((a) => !a.publishedAt || a.publishedAt >= cutoff);
  if (!['top', 'latest'].includes(prefs.tab)) list = list.filter((a) => (a.tags || []).includes(prefs.tab));
  return searchArticles(list, $('news-q').value);
}

function summaryButtons(clusterId, coverage) {
  const cluster = coverage > 1;
  return `<div class="story-actions" role="group" aria-label="Summary">
    ${cluster ? `<button type="button" class="btn btn-ghost btn-sm" data-summary="cluster" data-id="${esc(clusterId)}">Summarize coverage</button>` : ''}
    <button type="button" class="btn btn-ghost btn-sm" data-summary="short" data-id="${esc(clusterId)}">Short summary</button>
    <button type="button" class="btn btn-ghost btn-sm" data-summary="bullets" data-id="${esc(clusterId)}">Bullets</button>
  </div>
  <div class="summary-box" data-summary-for="${esc(clusterId)}" hidden></div>`;
}

function articleLine(a) {
  const when = a.publishedAt ? timeAgo(a.publishedAt) : 'time not provided';
  return `<li class="related-item">
      <a href="${esc(a.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
      <span class="muted"> · ${esc(a.sourceName)} · ${esc(when)}${a.stale ? ' · saved copy' : ''}</span>
      ${a.excerpt ? `<p class="excerpt">${esc(a.excerpt)}</p>` : '<p class="excerpt muted">Headline only</p>'}
    </li>`;
}

function storyCard(c) {
  const ex = explainCluster(c, { topics: prefs.topics, region: prefs.region });
  const lead = c.articles[0];
  const stale = c.articles.every((a) => a.stale);
  return `<article class="story-card" data-id="${esc(c.id)}">
    <div class="story-top">
      <span class="badge ${c.coverage > 1 ? 'badge-ok' : 'badge-muted'}">${esc(ex.headline)}</span>
      <span class="muted">Updated ${esc(timeAgo(c.updatedAt))}</span>
      ${stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}
    </div>
    <h4><a href="${esc(lead.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a></h4>
    <p class="muted">${esc(c.outlets.join(' · '))}</p>
    ${lead.excerpt ? `<p class="excerpt">${esc(lead.excerpt)}</p>` : ''}
    <details class="why">
      <summary>Why this story is highlighted</summary>
      <ul>${ex.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </details>
    ${c.articles.length > 1 ? `<details class="related"><summary>Related coverage (${c.articles.length})</summary><ul>${c.articles.map(articleLine).join('')}</ul></details>` : ''}
    ${summaryButtons(c.id, c.coverage)}
  </article>`;
}

function latestRow(a) {
  return `<article class="story-card compact">
    <div class="story-top"><span class="badge badge-muted">${esc(a.sourceName)}</span><span class="muted">${esc(a.publishedAt ? timeAgo(a.publishedAt) : 'time not provided')}</span>${a.stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}</div>
    <h4><a href="${esc(a.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></h4>
    ${a.excerpt ? `<p class="excerpt">${esc(a.excerpt)}</p>` : ''}
  </article>`;
}

function renderStatus() {
  $('news-source-status').innerHTML = (data.statuses.length ? data.statuses : SOURCES.map((s) => ({ id: s.id, name: s.name, homepage: s.homepage, state: s.feed ? 'needs-proxy' : 'unavailable', message: s.unavailableReason || 'Needs the news proxy' })))
    .map((s) => {
      const label = { ok: 'Live', stale: 'Saved copy', error: 'Error', unavailable: 'Unavailable', disabled: 'Off', 'needs-proxy': 'Needs proxy' }[s.state];
      const cls = s.state === 'ok' ? 'badge-ok' : s.state === 'error' || s.state === 'stale' ? 'badge-warn' : 'badge-muted';
      const detail = s.state === 'ok' ? `${s.count} items · fetched ${timeAgo(s.fetchedAt)}` : s.message || '';
      return `<li><span class="badge ${cls}">${esc(label)}</span> <strong>${esc(s.name)}</strong> <span class="muted">${esc(detail)}</span> <a href="${esc(s.homepage)}" target="_blank" rel="noopener noreferrer">Open publisher</a></li>`;
    })
    .join('');
}

function render() {
  renderTabs();
  renderStatus();
  const list = visibleArticles();
  const container = $('news-list');
  const q = $('news-q').value.trim();
  const live = data.statuses.filter((s) => s.state === 'ok').length;
  const failed = data.statuses.filter((s) => s.state === 'error');

  if (loading && !data.articles.length) {
    container.innerHTML = '<p class="status-line" role="status">Loading headlines…</p>';
    $('news-summary-line').textContent = '';
    return;
  }
  if (!data.articles.length) {
    container.innerHTML = prefs.proxyUrl
      ? '<div class="status-card" role="status"><p><strong>No headlines could be loaded.</strong> Check that the proxy is running and allows this site, then refresh. The source list below shows what failed.</p></div>'
      : '<div class="status-card" role="status"><p><strong>No live headlines yet.</strong> Add the news proxy address above to load them. Nothing is shown in the meantime, and no sample headlines are used.</p></div>';
    $('news-summary-line').textContent = '';
    return;
  }

  const partial = failed.length ? ` · ${failed.length} source${failed.length === 1 ? '' : 's'} failed (see Sources)` : '';
  const scope = `Search scope: ${data.articles.length} loaded articles`;
  if (!list.length) {
    container.innerHTML = '<div class="status-card" role="status"><p>No articles match these filters. Try a wider date range or fewer words.</p></div>';
    $('news-summary-line').textContent = `${scope}${partial}`;
    return;
  }

  if (prefs.tab === 'latest') {
    const sorted = [...list].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    container.innerHTML = sorted.slice(0, 80).map(latestRow).join('');
    $('news-summary-line').textContent = `${sorted.length} articles · ${live} live source${live === 1 ? '' : 's'}${partial}${q ? ` · matching "${q}"` : ''} · ${scope}`;
    stories = [];
  } else {
    stories = buildStories(list, { topics: prefs.topics, region: prefs.region });
    container.innerHTML = stories.slice(0, 60).map(storyCard).join('');
    $('news-summary-line').textContent = `${stories.length} stories from ${list.length} articles · ${live} live source${live === 1 ? '' : 's'}${partial}${q ? ` · matching "${q}"` : ''} · ${scope}`;
  }
}

async function refresh() {
  if (loading) return;
  loading = true;
  $('news-refresh').disabled = true;
  render();
  try {
    data = await loadNews({ proxyUrl: prefs.proxyUrl, disabled: prefs.disabledSources });
  } finally {
    loading = false;
    $('news-refresh').disabled = false;
    render();
  }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function clusterArticlesFor(id) {
  return stories.find((s) => s.id === id)?.articles || [];
}

async function runSummary(button) {
  const id = button.dataset.id;
  const mode = button.dataset.summary;
  const box = document.querySelector(`[data-summary-for="${CSS.escape(id)}"]`);
  const articles = clusterArticlesFor(id);
  const settings = loadAiSettings();
  box.hidden = false;

  if (settings.provider === 'off') {
    box.innerHTML = '<p class="status-line">AI summaries are off. <a href="settings.html">Choose a provider in Settings</a> to enable them. Nothing is sent anywhere until you do.</p>';
    return;
  }
  const inputs = prepareInputs(articles);
  const where = sendsToCloud(settings) ? 'Anthropic (a cloud service)' : `your local endpoint (${esc(settings.baseUrl)})`;
  if (activeSummary) activeSummary.controller.abort();
  const controller = new AbortController();
  activeSummary = { controller };
  box.innerHTML = `<p class="status-line" role="status">Sending ${inputs.items.length} headline${inputs.items.length === 1 ? '' : 's'}${inputs.items.some((i) => i.excerpt) ? ' and excerpts' : ''} to ${where}… <button type="button" class="btn btn-ghost btn-sm" data-cancel-summary>Cancel</button></p>`;
  box.querySelector('[data-cancel-summary]').addEventListener('click', () => controller.abort());
  try {
    const result = await summarize({ settings, apiKey: getApiKey(), mode, articles, signal: controller.signal });
    box.innerHTML = summaryHtml(result);
  } catch (error) {
    box.innerHTML = error?.code === 'cancelled' ? '<p class="status-line">Cancelled.</p>' : `<p class="status-line summary-error" role="alert">${describeError(error)}</p>`;
  } finally {
    if (activeSummary?.controller === controller) activeSummary = null;
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    prefs = { ...prefs, tab: tab.dataset.tab };
    saveNewsPrefs(prefs);
    render();
    return;
  }
  const summary = event.target.closest('[data-summary]');
  if (summary) {
    runSummary(summary);
    return;
  }
  if (event.target.closest('#proxy-clear')) {
    prefs = { ...prefs, proxyUrl: '' };
    saveNewsPrefs(prefs);
    renderSetup();
    refresh();
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'proxy-form') {
    event.preventDefault();
    const url = normalizeProxyUrl($('proxy-url').value);
    if (!url && $('proxy-url').value.trim()) {
      $('proxy-url').setCustomValidity('Enter an http(s) address such as http://127.0.0.1:8791');
      $('proxy-url').reportValidity();
      $('proxy-url').setCustomValidity('');
      return;
    }
    prefs = { ...prefs, proxyUrl: url };
    saveNewsPrefs(prefs);
    renderSetup();
    refresh();
  }
  if (event.target.id === 'news-search-form') {
    event.preventDefault();
    render();
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'news-date') {
    prefs = { ...prefs, date: event.target.value };
    saveNewsPrefs(prefs);
    render();
  }
  const src = event.target.closest?.('[data-source]');
  if (src) {
    const off = new Set(prefs.disabledSources);
    if (src.checked) off.delete(src.dataset.source);
    else off.add(src.dataset.source);
    prefs = { ...prefs, disabledSources: [...off] };
    saveNewsPrefs(prefs);
    render();
  }
});

$('news-q').addEventListener('input', () => render());
$('news-refresh').addEventListener('click', refresh);

onStoreChange([NEWS_KEY, AI_KEY], () => {
  prefs = loadNewsPrefs();
  renderSetup();
  render();
});

renderSetup();
render();
refresh();
setInterval(() => {
  if (!document.hidden && prefs.proxyUrl) refresh();
}, REFRESH_MS);
