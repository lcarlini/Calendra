// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  allSpecializedEntries,
  coveredYears,
  specializedEntriesForYear,
} from '../js/calendar/specialized.js';
import {
  easterSunday,
  brazilHolidays,
  usaHolidays,
  holidaysForYear,
  holidaysOnDate,
  holidayMapForYears,
  HOLIDAY_CATEGORY_DEFAULTS,
} from '../js/holidays.js';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

function namesOn(iso, list) {
  return list.filter((h) => h.date === iso).map((h) => h.name);
}

const ALL_PREFS = { ...HOLIDAY_CATEGORY_DEFAULTS };
const ONLY_US_BR = { US: true, BR: true, GCM: false, BRREF: false, DAVI: false };

// --- Source transcription integrity -----------------------------------------

test('every reference entry has a weekday consistent with its source label', () => {
  for (const e of allSpecializedEntries()) {
    assert.equal(weekdayOf(e.date), e.dow, `${e.category.id} ${e.date} ${e.name}`);
  }
});

test('Davi reference entries never fall on a weekend (source rule)', () => {
  for (const e of specializedEntriesForYear('davi', 2026)) {
    assert.ok(!['Saturday', 'Sunday'].includes(weekdayOf(e.date)), `${e.date} ${e.name}`);
  }
});

test('reference data is only provided for years the sources cover', () => {
  assert.deepEqual(coveredYears('gcm'), [2025, 2026, 2027]);
  assert.deepEqual(coveredYears('brasil-ref'), [2026]);
  assert.deepEqual(coveredYears('davi'), [2026]);
  assert.deepEqual(specializedEntriesForYear('gcm', 2028), []);
  assert.deepEqual(specializedEntriesForYear('davi', 2027), []);
});

test('GCM 2026 matches the Holidays.png 2026 column', () => {
  const dates = specializedEntriesForYear('gcm', 2026).map((e) => e.date);
  assert.deepEqual(dates, [
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
    '2026-07-03', '2026-09-07', '2026-11-26', '2026-11-27', '2026-12-25',
  ]);
});

test('GCM Good Friday matches the computed Easter for 2025, 2026 and 2027', () => {
  for (const year of [2025, 2026, 2027]) {
    const goodFriday = isoOf(new Date(easterSunday(year).getTime() - 2 * 86400000));
    const gcmGoodFriday = specializedEntriesForYear('gcm', year).find((e) => e.name === 'Good Friday');
    assert.equal(gcmGoodFriday.date, goodFriday, String(year));
  }
});

// --- Reference dates in 2026 -------------------------------------------------

test('2026 reference dates: Easter, Carnaval, Corpus Christi', () => {
  assert.equal(isoOf(easterSunday(2026)), '2026-04-05');
  const br = brazilHolidays(2026);
  assert.deepEqual(namesOn('2026-02-16', br), ['Carnaval']);
  assert.deepEqual(namesOn('2026-02-17', br), ['Carnaval']);
  assert.deepEqual(namesOn('2026-06-04', br), ['Corpus Christi']);
  assert.deepEqual(namesOn('2026-04-03', br), ['Sexta-feira Santa']);
});

test('US 2026 movable holidays follow the Holidays.png GCM dates', () => {
  const us = usaHolidays(2026);
  assert.deepEqual(namesOn('2026-01-19', us), ['Martin Luther King Jr. Day']);
  assert.deepEqual(namesOn('2026-02-16', us), ["Presidents' Day"]);
  assert.deepEqual(namesOn('2026-05-25', us), ['Memorial Day']);
  assert.deepEqual(namesOn('2026-09-07', us), ['Labor Day']);
  assert.deepEqual(namesOn('2026-11-26', us), ['Thanksgiving']);
});

// --- Multi-year generation ---------------------------------------------------

test('2027 generation: observed dates and movable holidays shift correctly', () => {
  const list = holidaysForYear(2027, ALL_PREFS);
  assert.ok(namesOn('2027-06-18', list).includes('Juneteenth (observed)'));
  assert.ok(namesOn('2027-07-05', list).includes('Independence Day (observed)'));
  assert.ok(namesOn('2027-12-24', list).includes('Christmas Day (observed)'));
  assert.ok(namesOn('2027-03-26', list).includes('Good Friday'));
  // Not shifted from 2026: New Year 2027 is a Friday, not a Thursday.
  assert.equal(weekdayOf('2027-01-01'), 'Friday');
  assert.ok(namesOn('2027-01-01', list).includes("New Year's Day"));
});

test('2027 does not invent Brasil or Davi entries', () => {
  const list = holidaysForYear(2027, ALL_PREFS);
  assert.equal(list.filter((h) => h.category === 'brasil-ref' || h.category === 'davi').length, 0);
});

test('2025 GCM entries from the image are present', () => {
  const list = holidaysForYear(2025, ALL_PREFS);
  assert.ok(namesOn('2025-11-28', list).includes('Day after Thanksgiving'));
  assert.ok(namesOn('2025-06-19', list).includes('Juneteenth'));
});

// --- Leap year and boundaries ------------------------------------------------

test('2028 is a leap year: February 29 exists and is a Tuesday', () => {
  assert.equal(weekdayOf('2028-02-29'), 'Tuesday');
  assert.equal(easterSunday(2028).getMonth(), 3);
  assert.equal(easterSunday(2028).getDate(), 16);
});

test('2028 generation uses rules, not the fixed 2026 list, and creates no reference rows', () => {
  const list = holidaysForYear(2028, ALL_PREFS);
  assert.equal(list.filter((h) => h.category).length, 0);
  assert.ok(namesOn('2028-11-23', list).includes('Thanksgiving'));
  // Third Monday of February 2028 is the 21st.
  assert.equal(weekdayOf('2028-02-21'), 'Monday');
  assert.ok(namesOn('2028-02-21', list).includes("Presidents' Day"));
});

test('Carnaval 2028 falls in February of a leap year (Easter 16 April 2028)', () => {
  const list = brazilHolidays(2028);
  const carnaval = list.filter((h) => h.name === 'Carnaval').map((h) => h.date);
  assert.deepEqual(carnaval, ['2028-02-28', '2028-02-29']);
});

test('month and year boundary: 31 Dec 2026 and 1 Jan 2027 are distinct', () => {
  const map = holidayMapForYears([2026, 2027], ALL_PREFS);
  assert.ok(map.get('2026-12-25')?.length);
  assert.equal(map.get('2026-12-31'), undefined);
  assert.ok(map.get('2027-01-01')?.some((h) => h.name === "New Year's Day"));
});

// --- Category separation and prefs -------------------------------------------

test('GCM US holidays and the Calendra US list stay distinct categories', () => {
  const list = holidaysForYear(2026, ALL_PREFS);
  const onLabor = list.filter((h) => h.date === '2026-09-07');
  const countries = onLabor.map((h) => h.country).sort();
  assert.deepEqual(countries, ['BR', 'BR ref', 'Davi', 'GCM', 'US']);
  assert.ok(onLabor.some((h) => h.category === 'gcm' && h.name === 'Labor Day'));
  assert.ok(onLabor.some((h) => h.country === 'US' && h.name === 'Labor Day'));
});

test('turning a category off removes only its items', () => {
  const list = holidaysForYear(2026, ONLY_US_BR);
  assert.equal(list.filter((h) => h.category).length, 0);
  assert.ok(list.some((h) => h.country === 'US'));
  assert.ok(list.some((h) => h.country === 'BR'));
});

test('holidaysOnDate returns reference items when their category is enabled', () => {
  const items = holidaysOnDate('2026-11-06', ALL_PREFS);
  assert.ok(items.some((h) => h.category === 'davi' && h.name.includes('Poços de Caldas')));
  assert.equal(holidaysOnDate('2026-11-06', ONLY_US_BR).length, 0);
});

test('unconfirmed Davi "Recesso" rows are flagged needs-review', () => {
  const flagged = specializedEntriesForYear('davi', 2026).filter((e) => e.verificationStatus === 'needs-review');
  assert.equal(flagged.length, 4);
});

// --- Movable holiday sanity -------------------------------------------------

test('Easter sample dates for known years', () => {
  assert.equal(isoOf(easterSunday(2025)), '2025-04-20');
  assert.equal(isoOf(easterSunday(2027)), '2027-03-28');
  assert.equal(isoOf(easterSunday(2028)), '2028-04-16');
});
