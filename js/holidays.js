import { specializedEntriesForYear } from './calendar/specialized.js';
import { writeJSON } from './core/store.js';

/** Fixed + movable public holidays for USA and Brazil. */

function pad(n) {
  return String(n).padStart(2, '0');
}

function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  let day = 1 + ((weekday - first.getDay() + 7) % 7);
  day += (n - 1) * 7;
  return new Date(year, month - 1, day);
}

function lastWeekday(year, month, weekday) {
  const last = new Date(year, month, 0);
  const diff = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month - 1, last.getDate() - diff);
}

/** Anonymous Gregorian algorithm → Easter Sunday. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function shift(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toISO(d) {
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function usaHolidays(year) {
  const list = [
    { date: iso(year, 1, 1), name: "New Year's Day", country: 'US' },
    { date: toISO(nthWeekday(year, 1, 1, 3)), name: 'Martin Luther King Jr. Day', country: 'US' },
    { date: toISO(nthWeekday(year, 2, 1, 3)), name: "Presidents' Day", country: 'US' },
    { date: toISO(lastWeekday(year, 5, 1)), name: 'Memorial Day', country: 'US' },
    { date: iso(year, 6, 19), name: 'Juneteenth', country: 'US' },
    { date: iso(year, 7, 4), name: 'Independence Day', country: 'US' },
    { date: toISO(nthWeekday(year, 9, 1, 1)), name: 'Labor Day', country: 'US' },
    { date: toISO(nthWeekday(year, 10, 1, 2)), name: 'Columbus Day', country: 'US' },
    { date: iso(year, 11, 11), name: 'Veterans Day', country: 'US' },
    { date: toISO(nthWeekday(year, 11, 4, 4)), name: 'Thanksgiving', country: 'US' },
    { date: iso(year, 12, 25), name: 'Christmas Day', country: 'US' },
  ];
  // Federal holidays. Time-off planning treats them as statutory; banks/markets may differ.
  return list.map((h) => ({ ...h, kind: 'statutory' }));
}

const BR_OPTIONAL = new Set(["Carnaval", "Corpus Christi"]);

export function brazilHolidays(year) {
  const easter = easterSunday(year);
  const carnivalTue = shift(easter, -47);
  const carnivalMon = shift(easter, -48);
  const goodFriday = shift(easter, -2);
  const corpusChristi = shift(easter, 60);

  const list = [
    { date: iso(year, 1, 1), name: 'Confraternização Universal', country: 'BR' },
    { date: toISO(carnivalMon), name: 'Carnaval', country: 'BR' },
    { date: toISO(carnivalTue), name: 'Carnaval', country: 'BR' },
    { date: toISO(goodFriday), name: 'Sexta-feira Santa', country: 'BR' },
    { date: iso(year, 4, 21), name: 'Tiradentes', country: 'BR' },
    { date: iso(year, 5, 1), name: 'Dia do Trabalho', country: 'BR' },
    { date: toISO(corpusChristi), name: 'Corpus Christi', country: 'BR' },
    { date: iso(year, 9, 7), name: 'Independência do Brasil', country: 'BR' },
    { date: iso(year, 10, 12), name: 'Nossa Senhora Aparecida', country: 'BR' },
    { date: iso(year, 11, 2), name: 'Finados', country: 'BR' },
    { date: iso(year, 11, 15), name: 'Proclamação da República', country: 'BR' },
    { date: iso(year, 11, 20), name: 'Dia da Consciência Negra', country: 'BR' },
    { date: iso(year, 12, 25), name: 'Natal', country: 'BR' },
  ];
  // Carnaval and Corpus Christi are ponto facultativo / optional, not statutory days off.
  return list.map((h) => ({ ...h, kind: BR_OPTIONAL.has(h.name) ? 'optional' : 'statutory' }));
}

const KEY = 'calendra.holidays.v1';

/** Every toggleable calendar category. Stored prefs are merged over these defaults, so older saves keep working. */
export const HOLIDAY_CATEGORY_DEFAULTS = { US: true, BR: true, GCM: true, BRREF: true, DAVI: true };

export function loadHolidayPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...HOLIDAY_CATEGORY_DEFAULTS };
    return { ...HOLIDAY_CATEGORY_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...HOLIDAY_CATEGORY_DEFAULTS };
  }
}

export function saveHolidayPrefs(prefs) {
  const merged = { ...HOLIDAY_CATEGORY_DEFAULTS };
  for (const key of Object.keys(HOLIDAY_CATEGORY_DEFAULTS)) {
    if (key in prefs) merged[key] = !!prefs[key];
  }
  writeJSON(KEY, merged);
}

/** Reference (specialized) categories mapped to their preference key. */
const REFERENCE_PREF = { gcm: 'GCM', 'brasil-ref': 'BRREF', davi: 'DAVI' };

/**
 * All holidays and reference-calendar items for one year, filtered by prefs.
 * Reference items carry `country` as their short label and `category` as
 * their category id; they are never generated for years the sources do not cover.
 */
export function holidaysForYear(year, prefs = loadHolidayPrefs()) {
  const out = [];
  if (prefs.US) out.push(...usaHolidays(year));
  if (prefs.BR) out.push(...brazilHolidays(year));
  for (const [categoryId, prefKey] of Object.entries(REFERENCE_PREF)) {
    if (!prefs[prefKey]) continue;
    for (const e of specializedEntriesForYear(categoryId, year)) {
      out.push({
        date: e.date,
        name: e.name,
        country: e.category.pillLabel,
        category: categoryId,
        categoryLabel: e.category.label,
        source: e.source,
        verificationStatus: e.verificationStatus || 'verified',
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function holidaysOnDate(isoDate, prefs = loadHolidayPrefs()) {
  const year = Number(isoDate.slice(0, 4));
  return holidaysForYear(year, prefs).filter((h) => h.date === isoDate);
}

export function holidayMapForYears(years, prefs = loadHolidayPrefs()) {
  const map = new Map();
  for (const year of years) {
    for (const h of holidaysForYear(year, prefs)) {
      if (!map.has(h.date)) map.set(h.date, []);
      map.get(h.date).push(h);
    }
  }
  return map;
}
