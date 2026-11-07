// Run with: node --test tests/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  exportSettings,
  importSettings,
  readJSON,
  removeKey,
  validateImport,
  writeJSON,
  SECRET_KEYS,
} from '../js/core/store.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('readJSON falls back on missing or corrupt values and never throws', () => {
  const s = memoryStorage({ 'calendra.bad': '{not json' });
  assert.equal(readJSON('calendra.missing', 'x', s), 'x');
  assert.equal(readJSON('calendra.bad', 'fallback', s), 'fallback');
  assert.equal(readJSON('anything', 'f', null), 'f');
});

test('writeJSON round-trips and reports failure instead of throwing', () => {
  const s = memoryStorage();
  assert.equal(writeJSON('calendra.a', { n: 1 }, s), true);
  assert.deepEqual(readJSON('calendra.a', null, s), { n: 1 });
  const broken = { setItem() { throw new Error('quota'); } };
  assert.equal(writeJSON('calendra.a', 1, broken), false);
});

test('export includes settings but never credentials or caches', () => {
  const [secretKey] = [...SECRET_KEYS];
  const s = memoryStorage({
    'calendra.theme.v1': 'ink',
    'calendra.reminders.v1': JSON.stringify([{ id: 'r1', title: 'Dentist' }]),
    [secretKey]: JSON.stringify('sk-live-123'),
    'calendra.cache.rates.v1': JSON.stringify({ x: 1 }),
    'other.app.key': 'nope',
  });
  const out = exportSettings(s, new Date('2026-11-07T00:00:00Z'));
  assert.deepEqual(Object.keys(out.data), ['calendra.reminders.v1', 'calendra.theme.v1']);
  assert.equal(out.credentialsIncluded, false);
  assert.ok(!JSON.stringify(out).includes('sk-live-123'));
  assert.equal(out.exportedAt, '2026-11-07T00:00:00.000Z');
});

test('validateImport rejects foreign files, credentials, caches and bad versions', () => {
  const [secretKey] = [...SECRET_KEYS];
  assert.equal(validateImport(null).ok, false);
  assert.equal(validateImport([]).ok, false);
  assert.equal(validateImport({ app: 'other', version: 1, data: {} }).ok, false);
  assert.equal(validateImport({ app: 'calendra', version: 99, data: {} }).ok, false);
  assert.equal(validateImport({ app: 'calendra', version: 1 }).ok, false);
  assert.equal(validateImport({ app: 'calendra', version: 1, data: { 'evil.key': 1 } }).ok, false);
  assert.equal(validateImport({ app: 'calendra', version: 1, data: { [secretKey]: 'x' } }).ok, false);
  assert.equal(validateImport({ app: 'calendra', version: 1, data: { 'calendra.cache.a': 1 } }).ok, false);
  const good = validateImport({ app: 'calendra', version: 1, data: { 'calendra.theme.v1': 'mist' } });
  assert.equal(good.ok, true);
  assert.deepEqual(good.keys, ['calendra.theme.v1']);
});

test('importSettings applies only the keys in the file and leaves the rest untouched', () => {
  const s = memoryStorage({ 'calendra.reminders.v1': '[1]', 'calendra.theme.v1': '"ink"' });
  const res = importSettings({ app: 'calendra', version: 1, data: { 'calendra.theme.v1': 'mist' } }, s);
  assert.equal(res.ok, true);
  assert.equal(res.applied, 1);
  assert.equal(readJSON('calendra.theme.v1', null, s), 'mist');
  assert.equal(s.getItem('calendra.reminders.v1'), '[1]');
});

test('importSettings refuses an invalid file and changes nothing', () => {
  const s = memoryStorage({ 'calendra.theme.v1': '"ink"' });
  const res = importSettings({ app: 'calendra', version: 1, data: { 'evil': 1, 'calendra.theme.v1': 'x' } }, s);
  assert.equal(res.ok, false);
  assert.equal(res.applied, 0);
  assert.equal(readJSON('calendra.theme.v1', null, s), 'ink');
});

test('export then import round-trips non-secret data', () => {
  const a = memoryStorage({ 'calendra.holidays.v1': JSON.stringify({ US: false }) });
  const b = memoryStorage();
  const res = importSettings(exportSettings(a), b);
  assert.equal(res.ok, true);
  assert.deepEqual(readJSON('calendra.holidays.v1', null, b), { US: false });
});

test('removeKey deletes a value', () => {
  const s = memoryStorage({ 'calendra.x': '1' });
  removeKey('calendra.x', s);
  assert.equal(s.getItem('calendra.x'), null);
});
