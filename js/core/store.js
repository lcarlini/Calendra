/**
 * Versioned localStorage helpers shared by every module.
 *
 * - All reads and writes are wrapped: private windows or blocked storage never throw.
 * - Credentials live under SECRET_KEYS and are never exported.
 * - `calendra.cache.*` keys are caches and are never exported either.
 * - Cross-tab updates use the browser `storage` event; same-tab listeners use a custom event.
 *
 * Scope: data stays in this browser and origin. Nothing here syncs across devices.
 */

export const APP_ID = 'calendra';
export const EXPORT_VERSION = 1;
export const KEY_PREFIX = 'calendra.';
export const CACHE_PREFIX = 'calendra.cache.';
export const SECRET_KEYS = new Set(['calendra.ai.apikey.v1']);
const MAX_IMPORT_BYTES = 1_000_000;
const LOCAL_EVENT = 'calendra:store';

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readJSON(key, fallback = null, storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value, storage = defaultStorage()) {
  try {
    storage.setItem(key, JSON.stringify(value));
    globalThis.dispatchEvent?.(new CustomEvent(LOCAL_EVENT, { detail: { key } }));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key, storage = defaultStorage()) {
  try {
    storage.removeItem(key);
    globalThis.dispatchEvent?.(new CustomEvent(LOCAL_EVENT, { detail: { key } }));
    return true;
  } catch {
    return false;
  }
}

/** Call `callback(key)` when any of `keys` changes in this tab or another tab. Returns an unsubscribe function. */
export function onStoreChange(keys, callback) {
  const wanted = new Set(keys);
  const fromOtherTab = (event) => {
    if (event.key === null || wanted.has(event.key)) callback(event.key);
  };
  const fromThisTab = (event) => {
    if (wanted.has(event.detail?.key)) callback(event.detail.key);
  };
  globalThis.addEventListener?.('storage', fromOtherTab);
  globalThis.addEventListener?.(LOCAL_EVENT, fromThisTab);
  return () => {
    globalThis.removeEventListener?.('storage', fromOtherTab);
    globalThis.removeEventListener?.(LOCAL_EVENT, fromThisTab);
  };
}

function isExportable(key) {
  return key.startsWith(KEY_PREFIX) && !key.startsWith(CACHE_PREFIX) && !SECRET_KEYS.has(key);
}

function listKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
  return keys.filter(Boolean);
}

/** Non-secret settings and calendar data, as a plain object ready to serialise. */
export function exportSettings(storage = defaultStorage(), now = new Date()) {
  const data = {};
  for (const key of listKeys(storage).filter(isExportable).sort()) {
    try {
      data[key] = JSON.parse(storage.getItem(key));
    } catch {
      data[key] = storage.getItem(key);
    }
  }
  return { app: APP_ID, version: EXPORT_VERSION, exportedAt: now.toISOString(), credentialsIncluded: false, data };
}

/** Validate an import payload without applying it. */
export function validateImport(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['Not a Calendra export file.'], keys: [] };
  }
  if (payload.app !== APP_ID) errors.push('Not a Calendra export file (app id mismatch).');
  if (payload.version !== EXPORT_VERSION) errors.push(`Unsupported export version: ${payload.version}.`);
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    errors.push('Missing data section.');
  }
  const keys = [];
  if (!errors.length) {
    if (JSON.stringify(payload.data).length > MAX_IMPORT_BYTES) errors.push('File is too large.');
    for (const key of Object.keys(payload.data)) {
      if (!key.startsWith(KEY_PREFIX)) errors.push(`Unexpected key outside the app namespace: ${key}`);
      else if (SECRET_KEYS.has(key)) errors.push(`Credentials cannot be imported: ${key}`);
      else if (key.startsWith(CACHE_PREFIX)) errors.push(`Caches are not imported: ${key}`);
      else keys.push(key);
    }
  }
  return { ok: errors.length === 0, errors, keys };
}

/** Apply a validated import. Existing keys are only overwritten for keys present in the file. */
export function importSettings(payload, storage = defaultStorage()) {
  const check = validateImport(payload);
  if (!check.ok) return { applied: 0, ...check };
  let applied = 0;
  for (const key of check.keys) {
    if (writeJSON(key, payload.data[key], storage)) applied += 1;
  }
  return { applied, ok: true, errors: [], keys: check.keys };
}
