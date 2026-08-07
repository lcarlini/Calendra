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
  return list;
}

export function brazilHolidays(year) {
  const easter = easterSunday(year);
  const carnivalTue = shift(easter, -47);
  const carnivalMon = shift(easter, -48);
  const goodFriday = shift(easter, -2);
  const corpusChristi = shift(easter, 60);

  return [
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
}

const KEY = 'calendra.holidays.v1';

export function loadHolidayPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { US: true, BR: true };
    return { US: true, BR: true, ...JSON.parse(raw) };
  } catch {
    return { US: true, BR: true };
  }
}

export function saveHolidayPrefs(prefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function holidaysForYear(year, prefs = loadHolidayPrefs()) {
  const out = [];
  if (prefs.US) out.push(...usaHolidays(year));
  if (prefs.BR) out.push(...brazilHolidays(year));
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
