import { ACCENTS, TEXT_MAX, TEXT_MIN, TEXT_SIZES, TEXT_STEP, THEMES, applyTheme, getTheme, initThemeEverywhere, loadAppearance, saveAppearance } from './themes.js';
import { initDisplay } from './core/display.js';
import { HOLIDAY_CATEGORY_DEFAULTS } from './holidays.js';
import { KEY_PREFIX, exportSettings, importSettings, validateImport, writeJSON } from './core/store.js';
import { downloadText, esc } from './core/format.js';
import { PROVIDERS, clearAi, effectiveModel, getApiKey, hasPersistedKey, loadAiSettings, normalizeSettings, saveAiSettings, setApiKey } from './ai/settings.js';
import { AiError, testConnection } from './ai/providers.js';

initThemeEverywhere();
initDisplay();

const $ = (id) => document.getElementById(id);

// --- Theme ----------------------------------------------------------------------
const select = $('theme-select');
select.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
select.value = getTheme();
select.addEventListener('change', () => applyTheme(select.value));

// --- Appearance + Text size (as in the UI folder's two panels) ------------------------------------
const appearanceHost = $('appearance-controls');
const sizeHost = $('text-size-controls');
const group = (label, id, body) => `<div class="appearance-group"><span id="ap-${id}">${label}</span>${body}</div>`;
function seg(id, options, current, extra = '') {
  const buttons = options
    .map((o) => `<button type="button" data-ap="${id}" data-value="${o.value}" aria-pressed="${String(o.value) === String(current)}"${o.title ? ` aria-label="${o.title}" title="${o.title}"` : ''}>${o.html}</button>`)
    .join('');
  return `<div class="seg ${extra}" role="group" aria-labelledby="ap-${id}">${buttons}</div>`;
}
const txt = (list) => list.map(([value, html]) => ({ value, html }));
function paintAppearance() {
  const a = loadAppearance();
  const themes = THEMES.map((t) => ({ value: t.id, html: `<span aria-hidden="true">${t.mode === 'dark' ? '☾' : '☀'}</span> ${t.label}` }));
  const accents = ACCENTS.map((x) => ({ value: x.id, title: x.label, html: x.color ? `<span class="swatch" style="background:${x.color}"></span>` : '<span class="swatch swatch-theme"></span>' }));
  appearanceHost.innerHTML =
    group('Theme', 'theme', seg('theme', themes, getTheme(), 'seg-themes')) +
    group('Accent', 'accent', seg('accent', accents, a.accent, 'seg-accent')) +
    group('Density', 'density', seg('density', txt([['comfortable', 'Comfortable'], ['compact', 'Compact']]), a.density)) +
    '<div class="appearance-pair">' +
    group('Contrast', 'contrast', seg('contrast', txt([['standard', 'Standard'], ['more', 'More']]), a.contrast)) +
    group('Motion', 'motion', seg('motion', txt([['on', 'On'], ['off', 'Off']]), a.motion)) +
    '</div>';
}
function paintSize() {
  const a = loadAppearance();
  sizeHost.innerHTML =
    `<div class="size-stepper"><button type="button" class="step-btn" data-step="-1" aria-label="Smaller text" ${a.textSize <= TEXT_MIN ? 'disabled' : ''}>−</button>` +
    `<div class="text-size-readout" aria-live="polite"><strong>${a.textSize}%</strong><small>of the default size</small></div>` +
    `<button type="button" class="step-btn" data-step="1" aria-label="Larger text" ${a.textSize >= TEXT_MAX ? 'disabled' : ''}>+</button></div>` +
    group('Presets', 'size', seg('textSize', TEXT_SIZES.map((n) => ({ value: n, html: `${n}%` })), a.textSize, 'seg-presets')) +
    group('Autoscale', 'autoscale', seg('autoscale', txt([['on', 'On'], ['off', 'Off']]), a.autoscale)) +
    '<p class="status-line">Autoscale grows the text a little on very large screens (TVs) and shrinks it on tiny phones.</p>';
}
const paintAll = () => {
  paintAppearance();
  paintSize();
  select.value = getTheme();
};
function onChoose(e) {
  const step = e.target.closest('[data-step]');
  if (step) {
    saveAppearance({ textSize: Math.min(TEXT_MAX, Math.max(TEXT_MIN, loadAppearance().textSize + Number(step.dataset.step) * TEXT_STEP)) });
    paintSize();
    return;
  }
  const b = e.target.closest('[data-ap]');
  if (!b) return;
  if (b.dataset.ap === 'theme') applyTheme(b.dataset.value);
  else saveAppearance({ [b.dataset.ap]: b.dataset.ap === 'textSize' ? Number(b.dataset.value) : b.dataset.value });
  paintAll();
}
appearanceHost.addEventListener('click', onChoose);
sizeHost.addEventListener('click', onChoose);
select.addEventListener('change', paintAll);
paintAll();

// --- AI ---------------------------------------------------------------------------
const providerSelect = $('ai-provider');
providerSelect.innerHTML = Object.entries(PROVIDERS)
  .map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`)
  .join('');

function fillAi() {
  const s = loadAiSettings();
  providerSelect.value = s.provider;
  $('ai-url').value = s.baseUrl;
  $('ai-model').value = s.model;
  $('ai-timeout').value = s.timeoutSec;
  $('ai-language').value = s.language;
  $('ai-consent').checked = s.cloudConsent;
  $('ai-persist').checked = hasPersistedKey() || !getApiKey();
  $('ai-consent').checked = s.cloudConsent || Boolean(getApiKey());
  $('ai-key').value = '';
  $('ai-key').placeholder = getApiKey() ? 'A key is set (hidden). Type a new one to replace it.' : 'sk-ant-...';
  syncVisibility();
}

function syncVisibility() {
  const provider = providerSelect.value;
  document.querySelectorAll('#ai-form [data-for]').forEach((el) => {
    el.hidden = !el.dataset.for.split(' ').includes(provider);
  });
  $('ai-model').placeholder = PROVIDERS[provider]?.defaultModel || '';
  $('ai-test').disabled = provider === 'off';
}

function readForm() {
  return normalizeSettings({
    provider: providerSelect.value,
    baseUrl: $('ai-url').value,
    model: $('ai-model').value,
    timeoutSec: $('ai-timeout').value,
    language: $('ai-language').value,
    cloudConsent: $('ai-consent').checked,
  });
}

function say(id, message, kind = '') {
  const el = $(id);
  el.textContent = message;
  el.className = `status-line ${kind}`;
}

function persistKeyFromForm() {
  const typed = $('ai-key').value.trim();
  const persist = $('ai-persist').checked;
  if (typed) setApiKey(typed, { persist });
  else if (getApiKey()) setApiKey(getApiKey(), { persist }); // only changes where the existing key lives
}

providerSelect.addEventListener('change', syncVisibility);

$('ai-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const settings = readForm();
  if (settings.provider === 'anthropic' && ($('ai-key').value.trim() || getApiKey())) settings.cloudConsent = true; // adding a key is the consent
  saveAiSettings(settings);
  if (settings.provider === 'anthropic') persistKeyFromForm();
  $('ai-key').value = '';
  say('ai-status', settings.provider === 'off' ? 'Saved. AI is off: nothing will be sent anywhere.' : `Saved (${PROVIDERS[settings.provider].label}, model ${effectiveModel(settings)}).`, 'ok-text');
  fillAi();
});

$('ai-test').addEventListener('click', async () => {
  const settings = readForm();
  const apiKey = $('ai-key').value.trim() || getApiKey();
  say('ai-status', 'Testing…');
  try {
    const result = await testConnection({ settings, apiKey });
    say('ai-status', result.message, 'ok-text');
  } catch (error) {
    say('ai-status', error instanceof AiError ? error.message : 'The test failed.', 'warn-text');
  }
});

$('ai-clear').addEventListener('click', () => {
  if (!window.confirm('Remove the AI configuration and forget the API key?')) return;
  clearAi();
  fillAi();
  say('ai-status', 'AI configuration and key removed. AI is off.', 'ok-text');
});

// --- Data ---------------------------------------------------------------------------
$('export-data').addEventListener('click', () => {
  const payload = exportSettings();
  const date = new Date().toISOString().slice(0, 10);
  downloadText(`calendra-export-${date}.json`, JSON.stringify(payload, null, 2), 'application/json');
  say('data-status', `Exported ${Object.keys(payload.data).length} items. API keys and caches are not included.`, 'ok-text');
});

let pendingImport = null;
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  const preview = $('import-preview');
  pendingImport = null;
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const check = validateImport(payload);
    if (!check.ok) {
      preview.hidden = false;
      preview.innerHTML = `<p class="status-line warn-text" role="alert">This file cannot be imported:</p><ul>${check.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      return;
    }
    pendingImport = payload;
    preview.hidden = false;
    preview.innerHTML = `<p><strong>${check.keys.length} items</strong> found (exported ${esc(payload.exportedAt || 'unknown date')}). Importing replaces your current value for each of these:</p>
      <ul>${check.keys.map((k) => `<li><code>${esc(k)}</code></li>`).join('')}</ul>
      <div class="settings-row"><button type="button" class="btn btn-primary" id="import-confirm">Import and replace</button><button type="button" class="btn btn-ghost" id="import-cancel">Cancel</button></div>`;
  } catch {
    preview.hidden = false;
    preview.innerHTML = '<p class="status-line warn-text" role="alert">That file is not valid JSON.</p>';
  }
});

document.addEventListener('click', (event) => {
  if (event.target.id === 'import-cancel') {
    pendingImport = null;
    $('import-preview').hidden = true;
    $('import-file').value = '';
  }
  if (event.target.id === 'import-confirm' && pendingImport) {
    const result = importSettings(pendingImport);
    pendingImport = null;
    $('import-preview').hidden = true;
    $('import-file').value = '';
    say('data-status', result.ok ? `Imported ${result.applied} items. Reload other open pages to see them.` : 'Import failed.', result.ok ? 'ok-text' : 'warn-text');
    fillAi();
    select.value = getTheme();
  }
});

$('reset-holiday-prefs').addEventListener('click', () => {
  if (!window.confirm('Restore the default holiday visibility? Reminders are not changed.')) return;
  writeJSON('calendra.holidays.v1', { ...HOLIDAY_CATEGORY_DEFAULTS });
  say('data-status', 'Holiday visibility restored to defaults.', 'ok-text');
});

$('reset-all').addEventListener('click', () => {
  if (!window.confirm('Delete ALL Calendra data in this browser (reminders, preferences, watchlists, saved items, AI settings and key)? This cannot be undone. Consider exporting first.')) return;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
    for (const key of keys) if (key && key.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
  fillAi();
  select.value = getTheme();
  say('data-status', 'All Calendra data in this browser was deleted.', 'ok-text');
});

fillAi();
