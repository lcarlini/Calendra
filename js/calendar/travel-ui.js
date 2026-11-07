/**
 * Travel & Holiday Intelligence section of Calendário.
 * Reads the same holiday data and country toggles as the calendar (holidays.js);
 * nothing is duplicated here. Preferences persist under calendra.travel.v1.
 */
import { holidaysForYear, loadHolidayPrefs } from '../holidays.js';
import { addReminder, todayISO } from '../reminders.js';
import { copyText, downloadText, esc } from '../core/format.js';
import { onStoreChange, readJSON, writeJSON } from '../core/store.js';
import { toast } from '../ui.js';
import {
  addDays,
  describeDate,
  filterAndSort,
  findTimeOff,
  isWeekend,
  nextOpportunity,
  reminderFor,
  statutoryHolidays,
  summaryText,
  toIcs,
  travelLabel,
} from './travel-service.js';

export const TRAVEL_KEY = 'calendra.travel.v1';
export const TRAVEL_YEARS = [2026, 2027, 2028, 2029, 2030];
const TYPE_LABEL = { 'long-weekend': 'Long weekend', bridge: 'Bridge', 'extended-break': 'Extended break' };
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function defaults() {
  const y = new Date().getFullYear();
  return { year: TRAVEL_YEARS.includes(y) ? y : TRAVEL_YEARS[0], type: 'all', sort: 'days', optional: false };
}

function loadPrefs() {
  const saved = readJSON(TRAVEL_KEY, {});
  const d = defaults();
  return {
    year: TRAVEL_YEARS.includes(saved.year) ? saved.year : d.year,
    type: ['all', 'long-weekend', 'bridge', 'extended-break'].includes(saved.type) ? saved.type : d.type,
    sort: ['days', 'leave', 'date'].includes(saved.sort) ? saved.sort : d.sort,
    optional: Boolean(saved.optional),
  };
}

/** Country toggles come from the calendar; reference calendars never count as days off. */
function travelPrefs() {
  return { ...loadHolidayPrefs(), GCM: false, BRREF: false, DAVI: false };
}

function oppCard(opp, { compact = false } = {}) {
  const { label, reason, requiresLeave } = travelLabel(opp);
  const leave = opp.leaveDates.length
    ? `<p class="opp-leave">Request leave: ${opp.leaveDates.map((d) => esc(describeDate(d))).join('; ')}</p>`
    : '<p class="opp-leave">No leave needed</p>';
  return `
    <li class="opp-card" data-id="${esc(opp.id)}">
      <div class="opp-top">
        <span class="badge badge-ok">${esc(TYPE_LABEL[opp.type])}</span>
        <span class="badge ${requiresLeave ? 'badge-warn' : 'badge-ok'}">${esc(label)}</span>
        ${requiresLeave ? '<span class="badge badge-warn">Requires leave</span>' : ''}
      </div>
      <h4>${esc(describeDate(opp.start))} <span aria-hidden="true">→</span> ${esc(describeDate(opp.end))}</h4>
      <p class="opp-days"><strong>${opp.days} days off</strong> · ${esc(reason)}</p>
      <p class="opp-holidays">${esc(opp.holidays.join(', '))}</p>
      ${leave}
      ${
        compact
          ? ''
          : `<details class="opp-details"><summary>Details</summary>
        <dl>
          <dt>Confidence</dt><dd>Rule-based: dates come from the statutory-holiday rules, not from an official calendar for that year.</dd>
          <dt>Holiday breakdown</dt><dd>${esc(opp.holidays.join(', '))}</dd>
          <dt>Leave dates</dt><dd>${esc(opp.leaveDates.join(', ') || 'none')}</dd>
          <dt>Data source</dt><dd>The Calendário holiday rules (US federal and Brazil national). Optional observances are not counted.</dd>
        </dl></details>`
      }
      <div class="opp-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="ics" data-id="${esc(opp.id)}">Export .ics</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="copy" data-id="${esc(opp.id)}">Copy summary</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="remind" data-id="${esc(opp.id)}">Add reminder</button>
      </div>
    </li>`;
}

/** Year map: one mini calendar per month. Fill and outline differ, and every cell has a text tooltip. */
function heatmapHtml(year, opps, prefs, showOptional) {
  const statutory = statutoryHolidays(year, prefs);
  const optional = new Map();
  for (const h of holidaysForYear(year, prefs)) {
    if (h.kind === 'optional') optional.set(h.date, (optional.get(h.date) || []).concat(h.name));
  }
  const leave = new Set(opps.flatMap((o) => o.leaveDates));
  const inOpp = new Set();
  for (const o of opps) for (let d = o.start; d <= o.end; d = addDays(d, 1)) inOpp.add(d);

  const months = MONTHS_SHORT.map((name, m) => {
    const first = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const lead = new Date(Date.UTC(year, m, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    const cells = Array.from({ length: lead }, () => '<span class="hm-day hm-empty"></span>');
    for (let day = 1; day <= count; day += 1) {
      const iso = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const classes = ['hm-day'];
      const notes = [describeDate(iso)];
      if (isWeekend(iso)) classes.push('hm-weekend');
      if (statutory.has(iso)) {
        classes.push('hm-holiday');
        notes.push(statutory.get(iso).join(', '));
      }
      if (showOptional && optional.has(iso)) {
        classes.push('hm-optional');
        notes.push(`Optional observance, not counted: ${optional.get(iso).join(', ')}`);
      }
      if (leave.has(iso)) {
        classes.push('hm-leave');
        notes.push('Leave day to request');
      }
      if (inOpp.has(iso)) {
        classes.push('hm-opp');
        notes.push('Part of a break');
      }
      cells.push(`<span class="${classes.join(' ')}" title="${esc(notes.join(' · '))}">${day}</span>`);
    }
    return `<div class="hm-month" data-month="${first}"><h5>${name}</h5>
      <div class="hm-days" aria-hidden="true">${cells.join('')}</div></div>`;
  }).join('');

  return `<div class="hm-grid" role="img" aria-label="${year} map: ${opps.length} break${opps.length === 1 ? '' : 's'}; the list below has the same information as text">${months}</div>
    <ul class="hm-legend" role="list">
      <li><span class="hm-day hm-weekend">·</span> Weekend</li>
      <li><span class="hm-day hm-holiday">·</span> Statutory holiday</li>
      <li><span class="hm-day hm-leave">·</span> Leave day</li>
      <li><span class="hm-day hm-opp">·</span> Part of a break (outline)</li>
      ${showOptional ? '<li><span class="hm-day hm-optional">·</span> Optional observance (dashed, not counted)</li>' : ''}
    </ul>`;
}

export function initTravel() {
  const root = document.getElementById('travel');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  let prefs = loadPrefs();
  let current = [];

  const save = () => writeJSON(TRAVEL_KEY, prefs);

  function render() {
    const hp = travelPrefs();
    const countriesOn = hp.US || hp.BR;
    current = countriesOn ? findTimeOff(prefs.year, hp) : [];
    const shown = filterAndSort(current, { type: prefs.type, sort: prefs.sort });

    $('travel-years').innerHTML = TRAVEL_YEARS.map(
      (y) => `<button type="button" class="chip${y === prefs.year ? ' active' : ''}" data-year="${y}" aria-pressed="${y === prefs.year}">${y}</button>`
    ).join('');
    for (const btn of document.querySelectorAll('#travel-filters [data-type]')) {
      const on = btn.dataset.type === prefs.type;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    $('travel-sort').value = prefs.sort;
    $('travel-optional').checked = prefs.optional;

    // Next opportunity
    const today = todayISO();
    const upcoming = prefs.year === Number(today.slice(0, 4)) ? nextOpportunity(current, today) : filterAndSort(current, { sort: 'date' })[0];
    $('travel-next').innerHTML = !countriesOn
      ? '<p class="status-line">Turn on United States or Brazil in “Holiday calendars” above to see opportunities.</p>'
      : upcoming
        ? `<div class="next-card"><p class="next-kicker">Next ${esc((TYPE_LABEL[upcoming.type] || 'break').toLowerCase())}${prefs.year === Number(today.slice(0, 4)) ? '' : ` in ${prefs.year}`}</p><ul class="opp-list" role="list">${oppCard(upcoming, { compact: true })}</ul></div>`
        : `<p class="status-line">No more breaks found in ${prefs.year}.</p>`;

    $('travel-heatmap').innerHTML = countriesOn ? heatmapHtml(prefs.year, current, hp, prefs.optional) : '';

    $('travel-list').innerHTML = !countriesOn
      ? ''
      : shown.length
        ? shown.map((o) => oppCard(o)).join('')
        : '<li class="status-line">No breaks match this filter.</li>';

    $('travel-export-year').disabled = !current.length;
    $('travel-count').textContent = countriesOn
      ? `${shown.length} of ${current.length} breaks in ${prefs.year}`
      : '';
    $('travel-provenance').textContent = countriesOn
      ? `Data: ${[hp.US && 'US federal holidays', hp.BR && 'Brazil national holidays'].filter(Boolean).join(' + ')} (rule-generated for ${prefs.year}). Optional observances such as Carnaval and Corpus Christi, regional holidays and company policies are not counted. Ranking: more consecutive days off first, then fewer leave days.`
      : '';
  }

  root.addEventListener('click', async (event) => {
    const year = event.target.closest('[data-year]');
    if (year) {
      prefs = { ...prefs, year: Number(year.dataset.year) };
      save();
      render();
      return;
    }
    const type = event.target.closest('[data-type]');
    if (type) {
      prefs = { ...prefs, type: type.dataset.type };
      save();
      render();
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const opp = current.find((o) => o.id === action.dataset.id);
    if (!opp) return;
    if (action.dataset.action === 'ics') {
      downloadText(`calendra-time-off-${opp.start}.ics`, toIcs([opp]), 'text/calendar');
      toast('Exported', `${opp.days} days off from ${opp.start}`);
    } else if (action.dataset.action === 'copy') {
      toast((await copyText(summaryText(opp))) ? 'Summary copied' : 'Copy failed', 'Select the text manually if your browser blocks clipboard access.');
    } else if (action.dataset.action === 'remind') {
      const r = reminderFor(opp, todayISO());
      addReminder({ title: r.title, date: r.date, time: r.time, leadMinutes: r.leadMinutes, notes: r.notes });
      toast('Reminder added', `${r.title} on ${r.date}`);
    }
  });

  $('travel-sort').addEventListener('change', (e) => {
    prefs = { ...prefs, sort: e.target.value };
    save();
    render();
  });
  $('travel-optional').addEventListener('change', (e) => {
    prefs = { ...prefs, optional: e.target.checked };
    save();
    render();
  });
  $('travel-export-year').addEventListener('click', () => {
    downloadText(`calendra-time-off-${prefs.year}.ics`, toIcs(current, { calendarName: `Calendra time off ${prefs.year}` }), 'text/calendar');
    toast('Exported', `${current.length} breaks for ${prefs.year}`);
  });

  // Same data as the calendar: re-render when holiday toggles or travel prefs change (this tab or another).
  onStoreChange(['calendra.holidays.v1', TRAVEL_KEY], () => {
    prefs = loadPrefs();
    render();
  });
  render();
}
