import { remindersForDate } from './reminders.js';
import { holidayMapForYears, holidaysOnDate, loadHolidayPrefs } from './holidays.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const WEEKDAYS_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** e.g. "06 de agosto 2026" */
export function todayLongPt(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} de ${MESES_PT[date.getMonth()]} ${date.getFullYear()}`;
}

/** e.g. "06 de agosto — quarta-feira" */
export function todayWithWeekdayPt(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} de ${MESES_PT[date.getMonth()]} — ${WEEKDAYS_PT[date.getDay()]}`;
}

export function monthLabelPt(year, month) {
  const name = MESES_PT[month];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function buildMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells = [];

  for (let i = startOffset - 1; i >= 0; i -= 1) {
    const day = prevDays - i;
    const date = new Date(year, month - 1, day);
    cells.push({ date, day, other: true, iso: toISODate(date) });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({ date, day, other: false, iso: toISODate(date) });
  }

  while (cells.length % 7 !== 0 || cells.length < 42) {
    const day = cells.length - (startOffset + daysInMonth) + 1;
    const date = new Date(year, month + 1, day);
    cells.push({ date, day: date.getDate(), other: true, iso: toISODate(date) });
  }

  return cells;
}

function dayMarks(iso, holidayMap) {
  const events = remindersForDate(iso);
  const holidays = holidayMap?.get(iso) || holidaysOnDate(iso);
  return { events, holidays };
}

export function renderMiniCalendar(container, year, month, today = new Date()) {
  if (!container) return;
  const prefs = loadHolidayPrefs();
  const holidayMap = holidayMapForYears([year, year - 1, year + 1], prefs);
  const cells = buildMonthMatrix(year, month);

  const weekdays = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');
  const days = cells
    .map((cell) => {
      const { events, holidays } = dayMarks(cell.iso, holidayMap);
      const classes = [
        'day-cell',
        cell.other ? 'other-month' : '',
        sameDay(cell.date, today) ? 'today' : '',
        events.length ? 'has-event' : '',
        holidays.length ? 'has-holiday' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const title = [...holidays.map((h) => h.name), ...events.map((e) => e.title)].join(' · ');
      return `<button type="button" class="${classes}" data-date="${cell.iso}" title="${title}" aria-label="${cell.iso}">${cell.day}</button>`;
    })
    .join('');

  container.innerHTML = `
    <div class="weekday-row">${weekdays}</div>
    <div class="days-grid">${days}</div>
  `;
}

export function renderMonthView(container, year, month, today = new Date(), onDayClick) {
  if (!container) return;
  const prefs = loadHolidayPrefs();
  const holidayMap = holidayMapForYears([year, year - 1, year + 1], prefs);
  const cells = buildMonthMatrix(year, month);

  const weekdays = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');
  const days = cells
    .map((cell) => {
      const { events, holidays } = dayMarks(cell.iso, holidayMap);
      const shown = events.slice(0, 2);
      const more = events.length - shown.length;
      const classes = [
        'full-day',
        cell.other ? 'other' : '',
        sameDay(cell.date, today) ? 'today' : '',
        holidays.length ? 'holiday' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const holidayPills = holidays
        .slice(0, 2)
        .map((h) => `<div class="event-pill holiday-pill" title="${h.name}">${h.country} ${h.name}</div>`)
        .join('');

      const pills = shown
        .map((e, i) => {
          const tone = i % 3 === 1 ? 'warn' : i % 3 === 2 ? 'alert' : '';
          return `<div class="event-pill ${tone}" title="${e.title}">${e.time} ${e.title}</div>`;
        })
        .join('');

      const extra = more > 0 ? `<div class="event-pill">+${more} more</div>` : '';

      return `
        <div class="${classes}" data-date="${cell.iso}" role="button" tabindex="0">
          <div class="full-day-num">${cell.day}</div>
          <div class="full-day-events">${holidayPills}${pills}${extra}</div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="full-cal month-view">
      <div class="full-cal-weekdays">${weekdays}</div>
      <div class="full-cal-days">${days}</div>
    </div>
  `;

  bindDayClicks(container, onDayClick);
}

export function renderYearView(container, year, today = new Date(), onDayClick, onMonthClick) {
  if (!container) return;
  const prefs = loadHolidayPrefs();
  const holidayMap = holidayMapForYears([year], prefs);

  const months = MONTHS.map((_, month) => {
    const cells = buildMonthMatrix(year, month).filter((c) => !c.other);
    const days = buildMonthMatrix(year, month)
      .map((cell) => {
        const { events, holidays } = dayMarks(cell.iso, holidayMap);
        const classes = [
          'year-day',
          cell.other ? 'other' : '',
          sameDay(cell.date, today) ? 'today' : '',
          events.length ? 'has-event' : '',
          holidays.length ? 'has-holiday' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<button type="button" class="${classes}" data-date="${cell.iso}">${cell.other ? '' : cell.day}</button>`;
      })
      .join('');

    const holidayCount = cells.filter((c) => (holidayMap.get(c.iso) || []).length).length;

    return `
      <article class="year-month" data-month="${month}">
        <header class="year-month-head">
          <button type="button" class="year-month-btn" data-month="${month}">${MONTHS[month]}</button>
          <span class="year-month-meta">${holidayCount ? `${holidayCount} holidays` : ''}</span>
        </header>
        <div class="year-weekdays">${WEEKDAYS.map((d) => `<span>${d[0]}</span>`).join('')}</div>
        <div class="year-days">${days}</div>
      </article>
    `;
  }).join('');

  container.innerHTML = `<div class="year-grid">${months}</div>`;

  container.querySelectorAll('.year-day[data-date]').forEach((el) => {
    if (el.classList.contains('other')) return;
    el.addEventListener('click', () => onDayClick?.(el.dataset.date));
  });
  container.querySelectorAll('.year-month-btn').forEach((el) => {
    el.addEventListener('click', () => onMonthClick?.(Number(el.dataset.month)));
  });
}

export function renderWeekView(container, anchorDate, today = new Date(), onDayClick) {
  if (!container) return;
  const start = startOfWeek(anchorDate);
  const prefs = loadHolidayPrefs();
  const year = start.getFullYear();
  const holidayMap = holidayMapForYears([year, year + 1], prefs);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const iso = toISODate(date);
    const { events, holidays } = dayMarks(iso, holidayMap);
    const isToday = sameDay(date, today);

    return `
      <article class="week-day ${isToday ? 'today' : ''} ${holidays.length ? 'holiday' : ''}" data-date="${iso}" role="button" tabindex="0">
        <header>
          <strong>${WEEKDAYS[i]}</strong>
          <span>${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}</span>
        </header>
        <div class="week-day-body">
          ${holidays.map((h) => `<div class="event-pill holiday-pill">${h.country} · ${h.name}</div>`).join('')}
          ${
            events.length
              ? events.map((e) => `<div class="event-pill">${e.time} ${e.title}</div>`).join('')
              : '<div class="week-empty">No alerts</div>'
          }
        </div>
      </article>
    `;
  }).join('');

  container.innerHTML = `<div class="week-grid">${days}</div>`;
  bindDayClicks(container, onDayClick);
}

export function renderDayView(container, isoDate, onRefresh) {
  if (!container) return;
  const date = new Date(`${isoDate}T12:00:00`);
  const prefs = loadHolidayPrefs();
  const holidays = holidaysOnDate(isoDate, prefs);
  const events = remindersForDate(isoDate);

  container.innerHTML = `
    <div class="day-view">
      <div class="day-view-hero">
        <div class="day-view-kicker">${date.toLocaleDateString(undefined, { weekday: 'long' })}</div>
        <h3>${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
      </div>
      <section class="day-view-section">
        <h4>Holidays</h4>
        ${
          holidays.length
            ? holidays.map((h) => `<div class="agenda-item"><div class="agenda-bar rose"></div><div><div class="agenda-title">${h.name}</div><div class="agenda-time">${h.country === 'US' ? 'United States' : 'Brazil'}</div></div></div>`).join('')
            : '<p class="status-line">No public holidays on this day for selected countries.</p>'
        }
      </section>
      <section class="day-view-section">
        <h4>Alerts & meetings</h4>
        ${
          events.length
            ? events
                .map(
                  (e) => `
            <div class="agenda-item">
              <div class="agenda-bar"></div>
              <div>
                <div class="agenda-time">${e.time}${e.done ? ' · done' : ''}</div>
                <div class="agenda-title">${escapeHtml(e.title)}</div>
                ${e.notes ? `<div class="reminder-meta">${escapeHtml(e.notes)}</div>` : ''}
              </div>
            </div>`
                )
                .join('')
            : '<p class="status-line">Nothing scheduled — use Quick add to create an alert.</p>'
        }
      </section>
    </div>
  `;
  onRefresh?.();
}

function bindDayClicks(container, onDayClick) {
  container.querySelectorAll('[data-date]').forEach((el) => {
    el.addEventListener('click', () => onDayClick?.(el.dataset.date));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onDayClick?.(el.dataset.date);
      }
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function weekLabel(anchorDate) {
  const start = startOfWeek(anchorDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}

export { WEEKDAYS, MONTHS, MONTHS_SHORT };

/** @deprecated use renderMonthView */
export const renderFullCalendar = renderMonthView;
