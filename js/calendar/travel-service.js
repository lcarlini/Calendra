/**
 * Time-off planning: finds long weekends and bridge-day opportunities from
 * statutory holidays. Pure logic (no DOM), so it runs in the browser and in
 * Node tests.
 *
 * Rules:
 *  - Only holidays tagged kind === 'statutory' count as days off. Optional
 *    observances (Carnaval, Corpus Christi) and reference-calendar items
 *    (GCM, Brasil ref., Davi) never do.
 *  - Rest days are weekends and statutory holidays.
 *  - A bridge is at most MAX_LEAVE_PER_SIDE workdays on one side of a
 *    holiday, placed directly next to it, joining the holiday to a rest run.
 *  - Output is limited to runs of at least MIN_REST_DAYS consecutive rest days.
 *  - Ranking: more consecutive rest days first, then fewer leave days, then date.
 *    No opaque score is produced.
 *
 * Limitations: runs are computed inside one calendar year, so a break that
 * crosses 31 Dec / 1 Jan is not joined across the year boundary.
 */
import { holidaysForYear } from '../holidays.js';

export const MAX_LEAVE_PER_SIDE = 2;
export const MIN_REST_DAYS = 3;
const MAX_RUN_SCAN = 10;
const DAY_MS = 86400000;

/** Statutory-only preferences: the reference calendars never influence time-off planning. */
export const TIME_OFF_PREFS = { US: true, BR: true, GCM: false, BRREF: false, DAVI: false };

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(iso) {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
}

/** Map of ISO date → statutory holiday names for one year. */
export function statutoryHolidays(year, prefs = TIME_OFF_PREFS) {
  const map = new Map();
  for (const h of holidaysForYear(year, prefs)) {
    if (h.kind !== 'statutory') continue;
    if (!map.has(h.date)) map.set(h.date, []);
    map.get(h.date).push(h.name);
  }
  return map;
}

/** Best rest run that a single statutory holiday can produce, or null. */
function bestRunForHoliday(date, holidays) {
  const rest = (d) => isWeekend(d) || holidays.has(d);

  // Workdays between the holiday and the nearest rest day on one side.
  const sideBridge = (step) => {
    const bridge = [];
    let d = addDays(date, step);
    while (!rest(d)) {
      bridge.push(d);
      if (bridge.length > MAX_LEAVE_PER_SIDE) return null;
      d = addDays(d, step);
    }
    return bridge;
  };

  const left = sideBridge(-1);
  const right = sideBridge(1);
  const options = [new Set()];
  if (left && left.length) options.push(new Set(left));
  if (right && right.length) options.push(new Set(right));
  if (left && right && left.length && right.length) options.push(new Set([...left, ...right]));

  let best = null;
  for (const bridge of options) {
    const open = (d) => rest(d) || bridge.has(d);
    let start = date;
    let end = date;
    for (let i = 0; i < MAX_RUN_SCAN && open(addDays(start, -1)); i += 1) start = addDays(start, -1);
    for (let i = 0; i < MAX_RUN_SCAN && open(addDays(end, 1)); i += 1) end = addDays(end, 1);
    const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
    const candidate = { start, end, days, leaveDates: [...bridge].sort() };
    if (
      !best ||
      candidate.days > best.days ||
      (candidate.days === best.days && candidate.leaveDates.length < best.leaveDates.length)
    ) {
      best = candidate;
    }
  }
  return best && best.days >= MIN_REST_DAYS ? best : null;
}

/** Type label for an opportunity. */
export function opportunityType(opp) {
  if (opp.days >= 5) return 'extended-break';
  if (opp.leaveDates.length > 0) return 'bridge';
  return 'long-weekend';
}

/**
 * Time-off opportunities for one year, best first.
 * Each item: { id, start, end, days, leaveDates, holidays, type, confidence }.
 */
export function findTimeOff(year, prefs = TIME_OFF_PREFS) {
  const holidays = statutoryHolidays(year, prefs);
  const groups = new Map();

  for (const date of [...holidays.keys()].sort()) {
    if (isWeekend(date)) continue;
    const run = bestRunForHoliday(date, holidays);
    if (!run) continue;
    const key = `${run.start}|${run.end}`;
    if (!groups.has(key)) {
      groups.set(key, { start: run.start, end: run.end, days: run.days, leaveDates: new Set() });
    }
    for (const d of run.leaveDates) groups.get(key).leaveDates.add(d);
  }

  const out = [...groups.values()].map((g) => {
    const names = [];
    for (let d = g.start; d <= g.end; d = addDays(d, 1)) {
      for (const n of holidays.get(d) || []) names.push(n);
    }
    const opp = {
      id: `${g.start}_${g.end}`,
      start: g.start,
      end: g.end,
      days: g.days,
      leaveDates: [...g.leaveDates].sort(),
      holidays: [...new Set(names)],
      confidence: 'rule-based',
    };
    return { ...opp, type: opportunityType(opp) };
  });

  return out.sort(
    (a, b) => b.days - a.days || a.leaveDates.length - b.leaveDates.length || a.start.localeCompare(b.start)
  );
}

function icsEscape(text) {
  return String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

function icsDate(iso) {
  return iso.replaceAll('-', '');
}

function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build an iCalendar (.ics) document. Events are all-day with DTEND exclusive,
 * so each event covers exactly start..end inclusive.
 */
export function toIcs(opportunities, { calendarName = 'Calendra time off', stamp = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendra//Time off//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];
  const dtstamp = icsStamp(stamp);
  for (const opp of opportunities) {
    const summary = `Time off (${opp.days} days): ${opp.holidays.join(', ')}`;
    const leave = opp.leaveDates.length
      ? `Leave to request: ${opp.leaveDates.join(', ')}`
      : 'No leave needed';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${opp.id}@calendra`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDate(opp.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(opp.end, 1))}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(leave + '. Rule-based from statutory holidays; confirm your employer policy.')}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Labels, summaries and reminders
// ---------------------------------------------------------------------------

/**
 * Transparent label, based only on rest days gained versus leave days spent:
 *   0 leave days : 4+ days Excellent, 3 days Great
 *   1 leave day  : 5+ days Excellent, 4 days Good, otherwise Fair
 *   2+ leave days: 6+ days Good, otherwise Fair
 * It does not model travel demand, prices or personal policy (no data for those),
 * and it is a label, not a numeric score.
 */
export function travelLabel(opp) {
  const leave = opp.leaveDates.length;
  const days = opp.days;
  let label;
  if (leave === 0) label = days >= 4 ? 'Excellent' : 'Great';
  else if (leave === 1) label = days >= 5 ? 'Excellent' : days === 4 ? 'Good' : 'Fair';
  else label = days >= 6 ? 'Good' : 'Fair';
  const reason =
    leave === 0
      ? `${days} days off with no leave needed`
      : `${days} days off for ${leave} leave day${leave === 1 ? '' : 's'}`;
  return { label, reason, requiresLeave: leave > 0 };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function describeDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAY_NAMES[weekdayOf(iso)]}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** Plain-text summary for copy/share. Never states anything the rules did not produce. */
export function summaryText(opp) {
  const { label, reason } = travelLabel(opp);
  const lines = [
    `${describeDate(opp.start)} to ${describeDate(opp.end)}`,
    `${opp.days} consecutive days off (${label}: ${reason})`,
    `Holidays: ${opp.holidays.join(', ') || 'none'}`,
    opp.leaveDates.length
      ? `Request leave on: ${opp.leaveDates.map(describeDate).join('; ')}`
      : 'No leave needed',
    'Based on statutory holidays only. Confirm with your employer; optional observances are not counted.',
  ];
  return lines.join('\n');
}

/** Reminder (for the existing alert system): a prompt to request leave ~2 weeks ahead, never in the past. */
export function reminderFor(opp, today) {
  const target = addDays(opp.start, -14);
  const date = target < today ? today : target;
  const needsLeave = opp.leaveDates.length > 0;
  return {
    title: needsLeave
      ? `Request leave: ${opp.leaveDates.join(', ')} (${opp.holidays.join(', ')})`
      : `Plan ahead: ${opp.days}-day break (${opp.holidays.join(', ')})`,
    date,
    time: '09:00',
    leadMinutes: 0,
    notes: summaryText(opp),
  };
}

/** The first opportunity that has not ended yet, or null. */
export function nextOpportunity(list, today) {
  return [...list].sort((a, b) => a.start.localeCompare(b.start)).find((o) => o.end >= today) || null;
}

/** Filter by type ('all' | 'long-weekend' | 'bridge' | 'extended-break') and sort. */
export function filterAndSort(list, { type = 'all', sort = 'days' } = {}) {
  const out = type === 'all' ? [...list] : list.filter((o) => o.type === type);
  const by = {
    days: (a, b) => b.days - a.days || a.leaveDates.length - b.leaveDates.length || a.start.localeCompare(b.start),
    leave: (a, b) => a.leaveDates.length - b.leaveDates.length || b.days - a.days || a.start.localeCompare(b.start),
    date: (a, b) => a.start.localeCompare(b.start),
  };
  return out.sort(by[sort] || by.days);
}
