import { remindersForDate } from './reminders.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
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

export function renderMiniCalendar(container, year, month, today = new Date()) {
  if (!container) return;
  const cells = buildMonthMatrix(year, month);

  const weekdays = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');
  const days = cells
    .map((cell) => {
      const events = remindersForDate(cell.iso);
      const classes = [
        'day-cell',
        cell.other ? 'other-month' : '',
        sameDay(cell.date, today) ? 'today' : '',
        events.length ? 'has-event' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<button type="button" class="${classes}" data-date="${cell.iso}" aria-label="${cell.iso}">${cell.day}</button>`;
    })
    .join('');

  container.innerHTML = `
    <div class="weekday-row">${weekdays}</div>
    <div class="days-grid">${days}</div>
  `;
}

export function renderFullCalendar(container, year, month, today = new Date(), onDayClick) {
  if (!container) return;
  const cells = buildMonthMatrix(year, month);

  const weekdays = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');
  const days = cells
    .map((cell) => {
      const events = remindersForDate(cell.iso).slice(0, 3);
      const more = remindersForDate(cell.iso).length - events.length;
      const classes = [
        'full-day',
        cell.other ? 'other' : '',
        sameDay(cell.date, today) ? 'today' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const pills = events
        .map((e, i) => {
          const tone = i % 3 === 1 ? 'warn' : i % 3 === 2 ? 'alert' : '';
          return `<div class="event-pill ${tone}" title="${e.title}">${e.time} ${e.title}</div>`;
        })
        .join('');

      const extra = more > 0 ? `<div class="event-pill">+${more} more</div>` : '';

      return `
        <div class="${classes}" data-date="${cell.iso}" role="button" tabindex="0">
          <div class="full-day-num">${cell.day}</div>
          <div class="full-day-events">${pills}${extra}</div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="full-cal-weekdays">${weekdays}</div>
    <div class="full-cal-days">${days}</div>
  `;

  container.querySelectorAll('.full-day').forEach((el) => {
    el.addEventListener('click', () => onDayClick?.(el.dataset.date));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onDayClick?.(el.dataset.date);
      }
    });
  });
}

export { WEEKDAYS, MONTHS };
