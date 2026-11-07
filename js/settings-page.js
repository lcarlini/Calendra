import { THEMES, applyTheme, getTheme, initTheme } from './themes.js';
import { initDisplay } from './core/display.js';
import { HOLIDAY_CATEGORY_DEFAULTS } from './holidays.js';
import { KEY_PREFIX, exportSettings, importSettings, validateImport, writeJSON } from './core/store.js';
import { downloadText, esc } from './core/format.js';
import { PROVIDERS, clearAi, effectiveModel, getApiKey, hasPersistedKey, loadAiSettings, normalizeSettings, saveAiSettings, setApiKey } from './ai/settings.js';
import { AiError, testConnection } from './ai/providers.js';

initTheme();
initDisplay();

const $ = (id) => document.getElementById(id);

// --- Theme ----------------------------------------------------------------------
const select = $('theme-select');
select.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
select.value = getTheme();
select.addEventListener('change', () => applyTheme(select.value));

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
  $('ai-persist').checked = hasPersistedKey();
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
