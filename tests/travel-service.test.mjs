// Run with: node --test tests/travel-service.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  findTimeOff,
  isWeekend,
  opportunityType,
  statutoryHolidays,
  toIcs,
  MIN_REST_DAYS,
  MAX_LEAVE_PER_SIDE,
} from '../js/calendar/travel-service.js';

const YEARS = [2026, 2027, 2028, 2029, 2030];

function find(year, start) {
  return findTimeOff(year).find((o) => o.start === start);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
}

// --- Hand-checked cases -------------------------------------------------------

test('2027 Independence (Tue 7 Sep) joins US Labor Day (Mon 6 Sep): 4 days, no leave', () => {
  const opp = find(2027, '2027-09-04');
  assert.ok(opp, 'opportunity 4–7 Sep 2027 exists');
  assert.equal(opp.end, '2027-09-07');
  assert.equal(opp.days, 4);
  assert.deepEqual(opp.leaveDates, []);
  assert.ok(opp.holidays.includes('Independência do Brasil'));
  assert.ok(opp.holidays.includes('Labor Day'));
});

test('2026 Tiradentes (Tue 21 Apr) needs Monday 20 Apr as a bridge: 4 days, 1 leave day', () => {
  const opp = find(2026, '2026-04-18');
  assert.ok(opp);
  assert.equal(opp.end, '2026-04-21');
  assert.deepEqual(opp.leaveDates, ['2026-04-20']);
  assert.equal(opp.type, 'bridge');
});

test('2026 Thanksgiving (Thu 26 Nov) uses Friday 27 Nov as the bridge: 26–29 Nov', () => {
  const opp = find(2026, '2026-11-26');
  assert.ok(opp);
  assert.equal(opp.end, '2026-11-29');
  assert.deepEqual(opp.leaveDates, ['2026-11-27']);
});

test('2028 Tiradentes on a Friday is a plain 3-day weekend with no leave', () => {
  const opp = find(2028, '2028-04-21');
  assert.ok(opp);
  assert.equal(opp.days, 3);
  assert.deepEqual(opp.leaveDates, []);
});

test('2028 leap year: Presidents’ Day (Mon 21 Feb) gives Sat–Mon, and 29 Feb is not a holiday', () => {
  assert.ok(find(2028, '2028-02-19'));
  assert.equal(statutoryHolidays(2028).has('2028-02-29'), false);
});

test('optional observances never create or extend time off (Carnaval is not a holiday here)', () => {
  const names = [...statutoryHolidays(2026).values()].flat();
  assert.ok(!names.includes('Carnaval'), 'Carnaval is not statutory');
  assert.ok(!names.includes('Corpus Christi'), 'Corpus Christi is not statutory');
  for (const opp of findTimeOff(2026)) {
    assert.ok(!opp.holidays.includes('Carnaval'), `${opp.id} must not list Carnaval`);
    assert.ok(!opp.holidays.includes('Corpus Christi'), `${opp.id} must not list Corpus Christi`);
  }
});

test('a holiday on a Monday or Friday needs no leave', () => {
  // 2026 Labor Day (Mon 7 Sep) and Thanksgiving-era checks use this rule.
  const labor = find(2026, '2026-09-05');
  assert.ok(labor, '5–7 Sep 2026 exists (Sat–Mon)');
  assert.deepEqual(labor.leaveDates, []);
});

// --- Rules and invariants across 2026–2030 -----------------------------------

for (const year of YEARS) {
  test(`${year}: every opportunity is contiguous and covered by rest days or listed leave`, () => {
    const holidays = statutoryHolidays(year);
    for (const opp of findTimeOff(year)) {
      assert.equal(opp.days, daysBetween(opp.start, opp.end), `${opp.id} day count`);
      assert.ok(opp.days >= MIN_REST_DAYS, `${opp.id} has at least ${MIN_REST_DAYS} days`);
      assert.ok(opp.leaveDates.length <= 2 * MAX_LEAVE_PER_SIDE, `${opp.id} leave bounded`);
      for (let d = opp.start; d <= opp.end; d = addDays(d, 1)) {
        const covered = isWeekend(d) || holidays.has(d) || opp.leaveDates.includes(d);
        assert.ok(covered, `${opp.id}: ${d} is neither rest nor listed leave`);
      }
      for (const d of opp.leaveDates) {
        assert.ok(!isWeekend(d) && !holidays.has(d), `${opp.id}: leave ${d} is a workday`);
      }
    }
  });

  test(`${year}: holidays shown in opportunities come only from statutory rules`, () => {
    const names = new Set(
      [...statutoryHolidays(year).values()].flat()
    );
    for (const opp of findTimeOff(year)) {
      for (const n of opp.holidays) assert.ok(names.has(n), `${n} in ${opp.id}`);
    }
  });

  test(`${year}: results are ranked by rest days, then leave`, () => {
    const list = findTimeOff(year);
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      assert.ok(a.days >= b.days, 'days descending');
      if (a.days === b.days) assert.ok(a.leaveDates.length <= b.leaveDates.length, 'leave ascending');
    }
  });
}

test('2027 and 2028 generate opportunities without any reference-calendar input', () => {
  assert.ok(findTimeOff(2027).length > 5);
  assert.ok(findTimeOff(2028).length > 5);
});

test('opportunityType labels', () => {
  assert.equal(opportunityType({ days: 5, leaveDates: [] }), 'extended-break');
  assert.equal(opportunityType({ days: 4, leaveDates: ['x'] }), 'bridge');
  assert.equal(opportunityType({ days: 3, leaveDates: [] }), 'long-weekend');
});

// --- .ics export --------------------------------------------------------------

test('.ics: valid structure, CRLF endings, one event per opportunity', () => {
  const opps = findTimeOff(2027);
  const ics = toIcs(opps, { stamp: new Date('2026-11-07T12:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, opps.length);
  assert.equal(ics.split('END:VEVENT').length - 1, opps.length);
});

test('.ics: all-day dates with exclusive DTEND cover exactly start..end', () => {
  const opp = find(2027, '2027-09-04');
  const ics = toIcs([opp], { stamp: new Date('2026-11-07T12:00:00Z') });
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20270904'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20270908'));
  assert.ok(ics.includes('DTSTAMP:20261107T120000Z'));
});

test('.ics: text escaping for commas, semicolons and backslashes', () => {
  const fake = {
    id: 'x_1',
    start: '2027-01-01',
    end: '2027-01-03',
    days: 3,
    leaveDates: [],
    holidays: ['A, B; C\\D'],
  };
  const ics = toIcs([fake]);
  assert.ok(ics.includes('SUMMARY:Time off (3 days): A\\, B\\; C\\\\D'));
});

test('.ics: empty list still yields a valid calendar', () => {
  const ics = toIcs([]);
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});
