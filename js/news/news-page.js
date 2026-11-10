/**
 * News page: loads feeds through the proxy, groups articles into stories, and offers on-demand
 * AI summaries with visible provenance. All text from publishers is escaped before display.
 */
import { initThemeEverywhere } from '../themes.js';
import { initDisplay } from '../core/display.js';
import { esc, timeAgo } from '../core/format.js';
import { onStoreChange } from '../core/store.js';
import { SOURCES, TABS, integratedSources } from './sources.js';
import { buildStories, dedupeArticles, explainCluster } from './cluster.js';
import { dateCutoff, loadNews, loadNewsPrefs, normalizeProxyUrl, saveNewsPrefs, searchArticles, NEWS_KEY } from './loader.js';
import { prepareInputs, sendsToCloud, summarize } from '../ai/providers.js';
import { openNewsAi } from '../ai/news-modal.js';
import { openImageViewer } from './image-viewer.js';
import { getApiKey, loadAiSettings, AI_KEY } from '../ai/settings.js';
import { describeError, summaryHtml } from '../ai/summary-ui.js';

initThemeEverywhere();
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
    <h3 id="setup-h">Where the headlines come from</h3>
    <p class="status-line">
      Calendra runs entirely in your browser, so it reads each outlet's own public RSS feed through <strong>rss2json.com</strong>, a public feed converter that
      browsers are allowed to call. The free tier returns the newest 10 items per feed, which is why several feeds per outlet are loaded. No server of yours is needed.
    </p>
    <details class="how-details">
      <summary>Optional: get more headlines</summary>
      <form id="proxy-form" class="inline-form" autocomplete="off">
        <label for="rss-key">rss2json API key</label>
        <input id="rss-key" type="text" autocomplete="off" spellcheck="false" placeholder="free key from rss2json.com (50 items per feed)" value="${esc(prefs.rss2jsonKey)}" />
        <label for="proxy-url">or your own proxy</label>
        <input id="proxy-url" type="url" inputmode="url" placeholder="http://127.0.0.1:8791" value="${esc(prefs.proxyUrl)}" />
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
        ${hasProxy ? '<button type="button" class="btn btn-ghost btn-sm" id="proxy-clear">Remove proxy</button>' : ''}
      </form>
      <p class="status-line">A key is stored in this browser only. A proxy (<code>backend/news-proxy</code>) takes priority over rss2json when set.</p>
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

function summaryButtons(clusterId, coverage, leadId) {
  const cluster = coverage > 1;
  return `<div class="story-actions" role="group" aria-label="Summary">
    <button type="button" class="btn btn-ai btn-sm" data-ai-article="${esc(leadId)}" aria-label="Resumir esta noticia com IA">✨ AI</button>
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

/** Images shown on screen, in order, for the viewer's previous/next. */
let gallery = [];

const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
const hue = (text) => [...String(text)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

/**
 * Image header of a card: the publisher's own feed images (credited; a click opens the viewer). When the story has
 * more than one photo, arrows step through them on the card itself. Without any picture: a styled placeholder.
 */
function storyMedia(articles, title, extra = '') {
  const lead = articles[0];
  const pics = [];
  const seen = new Set();
  for (const a of articles) {
    if (!a.image || seen.has(a.image)) continue;
    seen.add(a.image);
    pics.push(a);
  }
  if (!pics.length) {
    return `<div class="story-media placeholder" style="--h:${hue(lead.sourceName)}" aria-hidden="true">
      <span class="story-media-mark">${esc(initials(lead.sourceName))}</span>
      <span class="story-media-source">${esc(lead.sourceName)}</span>${extra}
    </div>`;
  }
  const slides = pics.map((a) => gallery.push({ src: a.image, title, source: a.sourceName, url: a.originalUrl, when: a.publishedAt ? timeAgo(a.publishedAt) : '' }) - 1);
  const first = pics[0];
  const nav =
    slides.length > 1
      ? `<button type="button" class="story-nav story-prev" data-story-nav="-1" aria-label="Foto anterior">‹</button>
      <button type="button" class="story-nav story-next" data-story-nav="1" aria-label="Próxima foto">›</button>
      <span class="story-count" aria-hidden="true">1/${slides.length}</span>`
      : '';
  return `<div class="story-media" data-slides="${slides.join(',')}" data-slide="0">
      <button type="button" class="story-media-open" data-gallery="${slides[0]}" aria-label="View image: ${esc(title)}">
        <img src="${esc(first.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </button>
      <span class="story-media-zoom" aria-hidden="true">⤢</span>
      <span class="story-media-source">${esc(first.sourceName)}</span>${extra}
      ${nav}
    </div>`;
}

/** Moves a card's photo one step (wrapping), skipping photos that failed to load. */
function showSlide(media, step) {
  const slides = media.dataset.slides.split(',').map(Number);
  let pos = Number(media.dataset.slide) || 0;
  for (let k = 0; k < slides.length; k += 1) {
    pos = (pos + step + slides.length) % slides.length;
    if (gallery[slides[pos]]?.src) break;
  }
  const g = gallery[slides[pos]];
  if (!g?.src) return;
  media.dataset.slide = String(pos);
  media.querySelector('.story-media-open').dataset.gallery = String(slides[pos]);
  media.querySelector('.story-media-open img').src = g.src;
  media.querySelector('.story-media-source').textContent = g.source;
  const count = media.querySelector('.story-count');
  if (count) count.textContent = `${pos + 1}/${slides.length}`;
}

function storyCard(c, index = 0) {
  const ex = explainCluster(c, { topics: prefs.topics, region: prefs.region });
  const lead = c.articles[0];
  const stale = c.articles.every((a) => a.stale);
  const featured = index === 0;
  const coverage = c.coverage > 1 ? `<span class="story-coverage">${c.coverage} outlets</span>` : '';
  return `<article class="story-card news-card${featured ? ' featured' : ''}" data-id="${esc(c.id)}">
    ${storyMedia(c.articles, c.title, coverage)}
    <div class="news-card-body">
      <div class="story-top">
        <span class="badge ${c.coverage > 1 ? 'badge-ok' : 'badge-muted'}">${esc(ex.headline)}</span>
        <span class="muted">${esc(timeAgo(c.updatedAt))}</span>
        ${stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}
      </div>
      <h4><a href="${esc(lead.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a></h4>
      ${lead.excerpt ? `<p class="excerpt">${esc(lead.excerpt)}</p>` : ''}
      <p class="news-outlets muted">${esc(c.outlets.join(' · '))}</p>
      <div class="news-card-more">
        <details class="why">
          <summary>Why highlighted</summary>
          <ul>${ex.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </details>
        ${c.articles.length > 1 ? `<details class="related"><summary>Coverage (${c.articles.length})</summary><ul>${c.articles.map(articleLine).join('')}</ul></details>` : ''}
      </div>
      ${summaryButtons(c.id, c.coverage, lead.id)}
    </div>
  </article>`;
}

function latestRow(a) {
  return `<article class="story-card news-card">
    ${storyMedia([a], a.title)}
    <div class="news-card-body">
      <div class="story-top"><span class="muted">${esc(a.publishedAt ? timeAgo(a.publishedAt) : 'time not provided')}</span>${a.stale ? '<span class="badge badge-warn">Saved copy</span>' : ''}</div>
      <h4><a href="${esc(a.originalUrl)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></h4>
      ${a.excerpt ? `<p class="excerpt">${esc(a.excerpt)}</p>` : ''}
      <div class="story-actions"><button type="button" class="btn btn-ai btn-sm" data-ai-article="${esc(a.id)}" aria-label="Resumir esta noticia com IA">✨ AI</button></div>
    </div>
  </article>`;
}

function renderStatus() {
  const have = new Map(data.statuses.map((x) => [x.id, x]));
  const rows = SOURCES.map((x) => have.get(x.id) || { id: x.id, name: x.name, homepage: x.homepage, state: x.feed ? 'loading' : 'unavailable', message: x.unavailableReason || 'Loading' });
  rows.push(...data.statuses.filter((x) => !SOURCES.some((y) => y.id === x.id)));
  $('news-source-status').innerHTML = rows
    .map((s) => {
      const label = { ok: 'Live', stale: 'Saved copy', error: 'Error', unavailable: 'Unavailable', disabled: 'Off', 'needs-proxy': 'Needs proxy', loading: 'Loading' }[s.state];
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
    container.innerHTML = '<div class="status-card" role="status"><p><strong>No headlines could be loaded.</strong> The feed converter (rss2json.com) or your connection may be unavailable, or it is rate-limiting. Press Refresh in a minute; the source list below shows what failed. No sample headlines are used.</p></div>';
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

  gallery = [];
  container.classList.add('news-grid');
  if (prefs.tab === 'latest') {
    // Same article from several feeds of one publisher group (e.g. g1 and g1 Economia) is shown once.
    const sorted = dedupeArticles(list).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    container.innerHTML = sorted.slice(0, 81).map(latestRow).join('');
    $('news-summary-line').textContent = `${sorted.length} articles · ${live} live source${live === 1 ? '' : 's'}${partial}${q ? ` · matching "${q}"` : ''} · ${scope}`;
    stories = [];
  } else {
    stories = buildStories(list, { topics: prefs.topics, region: prefs.region });
    // The featured slot goes to the best-ranked of the top 4 stories that has a picture (ranking is otherwise kept).
    const shown = stories.slice(0, 61);
    const lead = shown.slice(0, 4).findIndex((c) => c.articles.some((a) => a.image));
    if (lead > 0) shown.unshift(...shown.splice(lead, 1));
    container.innerHTML = shown.map((c, i) => storyCard(c, i)).join('');
    $('news-summary-line').textContent = `${stories.length} stories from ${list.length} articles · ${live} live source${live === 1 ? '' : 's'}${partial}${q ? ` · matching "${q}"` : ''} · ${scope}`;
  }
}

let loadId = 0;
/** A newer request (e.g. after changing the proxy or key) supersedes one still running; a plain refresh does not stack. */
async function refresh({ force = false } = {}) {
  if (loading && !force) return;
  const id = ++loadId;
  loading = true;
  $('news-refresh').disabled = true;
  render();
  try {
    const result = await loadNews({
      proxyUrl: prefs.proxyUrl,
      rss2jsonKey: prefs.rss2jsonKey,
      disabled: prefs.disabledSources,
      onUpdate: (partial) => {
        if (id !== loadId) return;
        data = partial;
        render();
      },
    });
    if (id === loadId) data = result;
  } finally {
    if (id === loadId) {
      loading = false;
      $('news-refresh').disabled = false;
      render();
    }
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
  const nav = event.target.closest('[data-story-nav]');
  if (nav) {
    showSlide(nav.closest('.story-media'), Number(nav.dataset.storyNav));
    return;
  }
  const media = event.target.closest('[data-gallery]');
  if (media) {
    openImageViewer(gallery, Number(media.dataset.gallery));
    return;
  }
  const ai = event.target.closest('[data-ai-article]');
  if (ai) {
    const article = data.articles.find((a) => a.id === ai.dataset.aiArticle);
    if (article) openNewsAi(article);
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
    refresh({ force: true });
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
    prefs = { ...prefs, proxyUrl: url, rss2jsonKey: $('rss-key').value.trim() };
    saveNewsPrefs(prefs);
    renderSetup();
    refresh({ force: true });
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

// A publisher image that fails to load turns into the styled placeholder (and leaves the viewer's list).
$('news-list').addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const media = img.closest('.story-media');
    if (!media || media.classList.contains('placeholder')) return;
    const i = Number(media.querySelector('.story-media-open')?.dataset.gallery);
    if (gallery[i]) gallery[i] = { ...gallery[i], src: '' };
    // Another photo of the same story still loads: show it instead of a placeholder.
    if (media.dataset.slides.split(',').some((s) => gallery[Number(s)]?.src)) {
      showSlide(media, 1);
      return;
    }
    const source = media.querySelector('.story-media-source')?.textContent || '';
    const ph = document.createElement('div');
    ph.className = 'story-media placeholder';
    ph.style.setProperty('--h', hue(source));
    ph.setAttribute('aria-hidden', 'true');
    ph.innerHTML = `<span class="story-media-mark">${esc(initials(source))}</span><span class="story-media-source">${esc(source)}</span>${media.querySelector('.story-coverage')?.outerHTML || ''}`;
    media.replaceWith(ph);
  },
  true
);

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
  if (!document.hidden) refresh();
}, REFRESH_MS);
