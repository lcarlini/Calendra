/**
 * AI settings.
 *
 * Non-secret settings live in localStorage (calendra.ai.v1) and are included in exports.
 * The API key is separate:
 *   - by default it is kept in sessionStorage only (gone when the tab closes);
 *   - only if the user explicitly opts in is it written to localStorage (calendra.ai.apikey.v1).
 * That key is never exported. A key held in browser storage can be read by any script running on
 * this page: this app does not claim to protect it, and the Settings page says so.
 */
import { readJSON, removeKey, writeJSON } from '../core/store.js';

export const AI_KEY = 'calendra.ai.v1';
export const API_KEY_STORAGE = 'calendra.ai.apikey.v1';

export const PROVIDERS = {
  off: { label: 'AI disabled', needsKey: false, needsUrl: false },
  anthropic: {
    label: 'Anthropic (cloud, your API key)',
    needsKey: true,
    needsUrl: false,
    defaultModel: 'claude-haiku-5-5',
    baseUrl: 'https://api.anthropic.com',
  },
  ollama: {
    label: 'Ollama (local endpoint)',
    needsKey: false,
    needsUrl: true,
    defaultModel: 'qwen3:8b',
    defaultUrl: 'http://127.0.0.1:11434',
  },
};

export function defaultSettings() {
  return {
    provider: 'ollama', // local by default: nothing leaves this computer unless you add a Claude key
    model: '',
    baseUrl: PROVIDERS.ollama.defaultUrl,
    timeoutSec: 60,
    language: 'pt',
    cloudConsent: false, // user confirmed that headlines/excerpts may be sent to the cloud provider
  };
}

export function normalizeSettings(raw = {}) {
  const d = defaultSettings();
  const provider = Object.hasOwn(PROVIDERS, raw.provider) ? raw.provider : d.provider;
  const timeout = Number(raw.timeoutSec);
  return {
    provider,
    model: typeof raw.model === 'string' ? raw.model.trim().slice(0, 100) : d.model,
    baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim().replace(/\/+$/, '') : d.baseUrl,
    timeoutSec: Number.isFinite(timeout) ? Math.min(Math.max(Math.round(timeout), 5), 300) : d.timeoutSec,
    language: raw.language === 'en' ? 'en' : 'pt',
    cloudConsent: Boolean(raw.cloudConsent),
  };
}

export const loadAiSettings = (storage) => normalizeSettings(readJSON(AI_KEY, {}, storage));
export const saveAiSettings = (settings, storage) => writeJSON(AI_KEY, normalizeSettings(settings), storage);

/** Cloud use is pinned to the cheapest model at its lowest effort; only a local Ollama model can be chosen. */
export const CLOUD_EFFORT = 'low';

export function effectiveModel(settings) {
  if (settings.provider === 'anthropic') return PROVIDERS.anthropic.defaultModel;
  return settings.model || PROVIDERS[settings.provider]?.defaultModel || '';
}

function session() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}
function local() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** Session key first, then (only if the user opted in earlier) the persisted key. */
export function getApiKey({ sessionStore = session(), localStore = local() } = {}) {
  try {
    return sessionStore?.getItem(API_KEY_STORAGE) || localStore?.getItem(API_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function hasPersistedKey({ localStore = local() } = {}) {
  try {
    return Boolean(localStore?.getItem(API_KEY_STORAGE));
  } catch {
    return false;
  }
}

export function setApiKey(key, { persist = false, sessionStore = session(), localStore = local() } = {}) {
  const value = String(key || '').trim();
  if (!value) return false;
  try {
    sessionStore?.setItem(API_KEY_STORAGE, value);
    if (persist) localStore?.setItem(API_KEY_STORAGE, value);
    else localStore?.removeItem(API_KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

/** Remove the key everywhere and reset the non-secret settings. */
export function clearAi({ sessionStore = session(), localStore = local() } = {}) {
  try {
    sessionStore?.removeItem(API_KEY_STORAGE);
    localStore?.removeItem(API_KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
  removeKey(AI_KEY, localStore);
}
