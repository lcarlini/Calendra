/**
 * Last-known-good cache. Values come back with `stale: true` once older than
 * `maxAgeMs`, so the UI can label them instead of silently showing old data.
 * Cache keys are never exported (see store.js).
 */
import { CACHE_PREFIX, readJSON, writeJSON } from './store.js';

export function cacheSet(key, value, { storage, now = Date.now() } = {}) {
  return writeJSON(CACHE_PREFIX + key, { value, fetchedAt: new Date(now).toISOString() }, storage);
}

export function cacheGet(key, { maxAgeMs = 0, storage, now = Date.now() } = {}) {
  const entry = readJSON(CACHE_PREFIX + key, null, storage);
  if (!entry || !entry.fetchedAt) return null;
  const age = now - Date.parse(entry.fetchedAt);
  return { value: entry.value, fetchedAt: entry.fetchedAt, stale: maxAgeMs > 0 ? age > maxAgeMs : false };
}
