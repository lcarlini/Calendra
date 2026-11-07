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

      const hiddenHolidays = holidays.slice(2);
      const holidayExtra = hiddenHolidays.length
        ? `<div class="event-pill holiday-pill" title="${escapeHtml(hiddenHolidays.map((h) => `${h.country} ${h.name}`).join(' · '))}">+${hiddenHolidays.length} holidays</div>`
        : '';
      const extra = more > 0 ? `<div class="event-pill">+${more} more</div>` : '';

      return `
        <div class="${classes}" data-date="${cell.iso}" role="button" tabindex="0">
          <div class="full-day-num">${cell.day}</div>
          <div class="full-day-events">${holidayPills}${holidayExtra}${pills}${extra}</div>
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

/* ---- Year view, modelled on UI/Calendar.html: 12 full-size months, letter badges, combo colours, tooltip ---- */
const GROUPS = {
  davi: { key: 'Davi', letter: 'D', order: 0 },
  brasil: { key: 'Brasil', letter: 'B', order: 1 },
  gcm: { key: 'GCM', letter: 'G', order: 2 },
  us: { key: 'US', letter: 'U', order: 3 },
};
const COMBOS = { 'Davi+GCM': 'dg', 'Davi+Brasil': 'db', 'GCM+Brasil': 'gb', 'Davi+GCM+Brasil': 'dgb' };
const MONTHS_PT_CAP = MESES_PT.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
const WEEKDAYS_PT_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function groupOf(h) {
  if (h.category === 'gcm') return GROUPS.gcm;
  if (h.category === 'davi') return GROUPS.davi;
  if (h.category === 'brasil-ref' || h.country !== 'US') return GROUPS.brasil;
  return GROUPS.us;
}

/** Holidays of one day collapsed to one entry per (group, name): the UI calendar's three categories plus US. */
function groupedDay(list, weekday) {
  const seen = new Set();
  const out = [];
  for (const h of list) {
    const g = groupOf(h);
    if (g.key === 'Davi' && (weekday === 0 || weekday === 6)) continue; // the source says: no Davi events on weekends
    const key = `${g.key}|${h.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ g, name: h.name });
  }
  return out.sort((x, y) => x.g.order - y.g.order);
}

function ensureTipLayer() {
  let tip = document.getElementById('cal-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'cal-tip';
    tip.className = 'cal-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function placeTip(tip, html, x, y) {
  tip.innerHTML = html;
  tip.style.left = '0px';
  tip.style.top = '0px';
  tip.classList.add('show');
  const r = tip.getBoundingClientRect();
  const m = 12;
  let px = x + 12;
  let py = y + 12;
  if (px + r.width + m > window.innerWidth) px = window.innerWidth - r.width - m;
  if (py + r.height + m > window.innerHeight) py = window.innerHeight - r.height - m;
  tip.style.left = `${Math.max(m, px)}px`;
  tip.style.top = `${Math.max(m, py)}px`;
}

const prettyPt = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function renderYearView(container, year, today = new Date(), onDayClick, onMonthClick) {
  if (!container) return;
  const prefs = loadHolidayPrefs();
  const holidayMap = holidayMapForYears([year], prefs);

  const months = MONTHS.map((_, month) => {
    const cells = buildMonthMatrix(year, month);
    const days = cells
      .map((cell, index) => {
        const weekday = cell.date.getDay();
        const events = cell.other ? [] : remindersForDate(cell.iso);
        const entries = cell.other ? [] : groupedDay(holidayMap.get(cell.iso) || [], weekday);
        const involved = new Set(entries.map((e) => e.g.key));
        const combo = involved.size > 1 ? COMBOS[['Davi', 'GCM', 'Brasil'].filter((k) => involved.has(k)).join('+')] || '' : '';
        const classes = [
          'cell',
          cell.other ? 'outside' : '',
          weekday === 0 || weekday === 6 ? 'weekend' : '',
          Math.floor(index / 7) % 2 ? 'stripe' : '',
          sameDay(cell.date, today) && !cell.other ? 'today' : '',
          entries.length ? 'has-holiday' : '',
          events.length ? 'has-event' : '',
        ].filter(Boolean).join(' ');
        const badges = entries.slice(0, 4).map((e) => `<span class="badge ${combo || e.g.key.toLowerCase()}" aria-hidden="true">${e.g.letter}</span>`).join('');
        const more = entries.length > 4 ? `<span class="badge-more">+${entries.length - 4}</span>` : '';
        const label = entries.map((e) => `${e.g.key}: ${e.name}`).join('; ');
        const attrs = cell.other
          ? ' aria-hidden="true"'
          : ` data-date="${cell.iso}" tabindex="0" role="button" aria-label="${escapeHtml(prettyPt(cell.iso))}${label ? ` — ${escapeHtml(label)}` : ''}"`;
        return `<div class="${classes}"${attrs}><span class="daynum">${cell.day}</span><div class="markers">${badges}${more}</div></div>`;
      })
      .join('');
    const count = cells.filter((c) => !c.other && groupedDay(holidayMap.get(c.iso) || [], c.date.getDay()).length).length;
    return `
      <section class="ref-month" id="ref-m${month + 1}" data-month="${month}">
        <div class="ref-month-header">
          <button type="button" class="year-month-btn" data-month="${month}">${MONTHS_PT_CAP[month]}</button>
          <span class="ref-year">${year}${count ? ` · ${count} dias` : ''}</span>
        </div>
        <div class="ref-dow">${WEEKDAYS_PT_SHORT.map((d, i) => `<div class="${i === 0 || i === 6 ? 'weekend' : ''}">${d}</div>`).join('')}</div>
        <div class="ref-grid">${days}</div>
      </section>`;
  }).join('');

  container.innerHTML = `
    <div class="ref-controls">
      <label class="ref-jump">Ir para <select id="ref-jump" aria-label="Ir para o mês">${MONTHS_PT_CAP.map((m, i) => `<option value="${i + 1}">${i + 1} - ${m}</option>`).join('')}</select></label>
      <button type="button" class="btn btn-ghost btn-sm" id="ref-today">Mês atual</button>
      <div class="ref-legend" aria-label="Legenda">
        <span class="tag"><span class="dot davi"></span>Davi</span>
        <span class="tag"><span class="dot gcm"></span>GCM</span>
        <span class="tag"><span class="dot brasil"></span>Brasil</span>
        <span class="tag"><span class="dot us"></span>EUA</span>
        <span class="tag"><span class="dot dg"></span>Davi + GCM</span>
        <span class="tag"><span class="dot db"></span>Davi + Brasil</span>
        <span class="tag"><span class="dot gb"></span>GCM + Brasil</span>
        <span class="tag"><span class="dot dgb"></span>Davi + GCM + Brasil</span>
      </div>
    </div>
    <div class="ref-calendar">${months}</div>`;

  const tip = ensureTipLayer();
  const hide = () => tip.classList.remove('show');
  const tipHtml = (cell) => {
    const iso = cell.dataset.date;
    const list = groupedDay(holidayMap.get(iso) || [], new Date(`${iso}T12:00:00`).getDay());
    const events = remindersForDate(iso);
    if (!list.length && !events.length) return '';
    const involved = new Set(list.map((e) => e.g.key));
    const pill = involved.size > 1 ? `<div class="pill">${['Davi', 'GCM', 'Brasil'].filter((k) => involved.has(k)).join(' + ')}</div>` : '';
    return `<div><strong>${escapeHtml(prettyPt(iso))}</strong></div>${pill}${list.map((e) => `<div class="line"><b>${e.g.key}:</b> ${escapeHtml(e.name)}</div>`).join('')}${events.map((e) => `<div class="line"><b>Lembrete:</b> ${escapeHtml(e.title)}</div>`).join('')}`;
  };
  container.querySelectorAll('.cell[data-date]').forEach((cell) => {
    const html = tipHtml(cell);
    const open = () => { hide(); onDayClick?.(cell.dataset.date); };
    cell.addEventListener('click', open);
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    if (!html) return;
    cell.addEventListener('mouseenter', (e) => placeTip(tip, html, e.clientX, e.clientY));
    cell.addEventListener('mousemove', (e) => { if (tip.classList.contains('show')) placeTip(tip, html, e.clientX, e.clientY); });
    cell.addEventListener('mouseleave', hide);
    cell.addEventListener('focus', () => { const r = cell.getBoundingClientRect(); placeTip(tip, html, r.left + 10, r.top + 10); });
    cell.addEventListener('blur', hide);
  });
  container.querySelectorAll('.year-month-btn').forEach((el) => {
    el.addEventListener('click', () => onMonthClick?.(Number(el.dataset.month)));
  });
  const jump = container.querySelector('#ref-jump');
  const goto = (m) => {
    jump.value = String(m);
    container.querySelector(`#ref-m${m}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const nowMonth = today.getFullYear() === year ? today.getMonth() + 1 : 1;
  jump.value = String(nowMonth);
  jump.addEventListener('change', () => goto(jump.value));
  container.querySelector('#ref-today').addEventListener('click', () => goto(nowMonth));
  if (!window.__calTipBound) {
    window.__calTipBound = true;
    window.addEventListener('scroll', () => document.getElementById('cal-tip')?.classList.remove('show'), { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('cal-tip')?.classList.remove('show'); });
  }
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
            ? holidays.map((h) => `<div class="agenda-item"><div class="agenda-bar rose"></div><div><div class="agenda-title">${h.name}</div><div class="agenda-time">${escapeHtml(h.categoryLabel || (h.country === 'US' ? 'United States' : 'Brazil'))}</div></div></div>`).join('')
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
