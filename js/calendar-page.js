import {
  monthLabel,
  renderDayView,
  renderMonthView,
  renderWeekView,
  renderYearView,
  weekLabel,
} from './calendar.js';
import {
  addReminder,
  ensureNotificationPermission,
  formatLead,
  remindersForDate,
  todayISO,
} from './reminders.js';
import {
  holidaysForYear,
  holidaysOnDate,
  loadHolidayPrefs,
  saveHolidayPrefs,
} from './holidays.js';
import { initTheme, THEMES, applyTheme, getTheme } from './themes.js';
import { $, toast } from './ui.js';

initTheme();

const state = {
  view: localStorage.getItem('calendra.calView.v1') || 'month',
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  anchor: new Date(),
  selectedDate: todayISO(),
};

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function syncViewButtons() {
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  });
}

function setView(view) {
  state.view = view;
  localStorage.setItem('calendra.calView.v1', view);
  syncViewButtons();
  refresh();
}

function titleText() {
  if (state.view === 'year') return String(state.year);
  if (state.view === 'week') return weekLabel(state.anchor);
  if (state.view === 'day') {
    return new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return monthLabel(state.year, state.month);
}

function navigate(delta) {
  if (state.view === 'year') {
    state.year += delta;
  } else if (state.view === 'week') {
    state.anchor = new Date(state.anchor);
    state.anchor.setDate(state.anchor.getDate() + delta * 7);
    state.year = state.anchor.getFullYear();
    state.month = state.anchor.getMonth();
  } else if (state.view === 'day') {
    const d = new Date(`${state.selectedDate}T12:00:00`);
    d.setDate(d.getDate() + delta);
    state.selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    state.year = d.getFullYear();
    state.month = d.getMonth();
    state.anchor = d;
  } else {
    state.month += delta;
    if (state.month < 0) {
      state.month = 11;
      state.year -= 1;
    } else if (state.month > 11) {
      state.month = 0;
      state.year += 1;
    }
  }
  refresh();
}

function goToday() {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth();
  state.anchor = now;
  state.selectedDate = todayISO();
  refresh();
}

function selectDay(iso) {
  state.selectedDate = iso;
  const d = new Date(`${iso}T12:00:00`);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  state.anchor = d;
  const dateInput = $('#quick-date');
  if (dateInput) dateInput.value = iso;
  renderSelectedDay();
  openDayModal(iso);
}

function refresh() {
  const title = $('#cal-title');
  if (title) title.textContent = titleText();

  const host = $('#full-calendar');
  if (!host) return;

  if (state.view === 'year') {
    renderYearView(host, state.year, new Date(), selectDay, (month) => {
      state.month = month;
      setView('month');
    });
  } else if (state.view === 'week') {
    renderWeekView(host, state.anchor, new Date(), selectDay);
  } else if (state.view === 'day') {
    renderDayView(host, state.selectedDate);
  } else {
    renderMonthView(host, state.year, state.month, new Date(), selectDay);
  }

  renderSelectedDay();
  renderHolidayList();
}

function renderSelectedDay() {
  const panel = $('#day-panel');
  if (!panel) return;
  const items = remindersForDate(state.selectedDate);
  const holidays = holidaysOnDate(state.selectedDate);
  const label = new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const labelEl = $('#selected-day-label');
  if (labelEl) labelEl.textContent = label;

  const holidayHtml = holidays
    .map(
      (h) => `
      <article class="agenda-item">
        <div class="agenda-bar rose"></div>
        <div>
          <div class="agenda-time">${h.country === 'US' ? 'USA' : 'Brazil'} holiday</div>
          <div class="agenda-title">${h.name}</div>
        </div>
      </article>`
    )
    .join('');

  if (!items.length && !holidays.length) {
    panel.innerHTML = `
      <div class="empty-state">
        <strong>Nothing scheduled</strong>
        Pick a day on the calendar or add an alert below.
      </div>
    `;
    return;
  }

  panel.innerHTML =
    holidayHtml +
    items
      .map(
        (r) => `
      <article class="agenda-item">
        <div class="agenda-bar"></div>
        <div>
          <div class="agenda-time">${r.time} · ${formatLead(r.leadMinutes)}${r.done ? ' · done' : ''}</div>
          <div class="agenda-title">${escapeHtml(r.title)}</div>
          ${r.notes ? `<div class="reminder-meta">${escapeHtml(r.notes)}</div>` : ''}
        </div>
      </article>`
      )
      .join('');
}

function renderHolidayList() {
  const list = $('#holiday-upcoming');
  if (!list) return;
  const prefs = loadHolidayPrefs();
  const start = state.selectedDate;
  const all = [state.year, state.year + 1]
    .flatMap((y) => holidaysForYear(y, prefs))
    .filter((h) => h.date >= start)
    .slice(0, 14);

  if (!all.length) {
    list.innerHTML = '<p class="status-line">No upcoming holidays for selected countries.</p>';
    return;
  }

  list.innerHTML = all
    .map(
      (h) => `
    <button type="button" class="holiday-row" data-date="${h.date}">
      <span class="holiday-flag">${h.country}</span>
      <span>
        <strong>${escapeHtml(h.name)}</strong>
        <small>${h.date}</small>
      </span>
    </button>`
    )
    .join('');

  list.querySelectorAll('[data-date]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = new Date(`${btn.dataset.date}T12:00:00`);
      state.selectedDate = btn.dataset.date;
      state.year = d.getFullYear();
      state.month = d.getMonth();
      state.anchor = d;
      if (state.view === 'year') {
        state.view = 'month';
        localStorage.setItem('calendra.calView.v1', state.view);
      }
      syncViewButtons();
      refresh();
      openDayModal(btn.dataset.date);
    });
  });
}

function openDayModal(iso) {
  const backdrop = $('#day-modal');
  if (!backdrop) return;
  const holidays = holidaysOnDate(iso);
  const existing = remindersForDate(iso);
  const label = new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  $('#modal-day-label').textContent = label;
  const bits = [];
  if (holidays.length) bits.push(holidays.map((h) => h.name).join(', '));
  bits.push(existing.length ? `${existing.length} alert${existing.length === 1 ? '' : 's'}` : 'No alerts yet');
  $('#modal-day-summary').textContent = bits.join(' · ');
  backdrop.classList.add('open');
}

function closeModal() {
  $('#day-modal')?.classList.remove('open');
}

function bindTheme() {
  const select = $('#theme-select');
  if (!select) return;
  select.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
  select.value = getTheme();
  select.addEventListener('change', () => applyTheme(select.value));
}

function bindHolidays() {
  const prefs = loadHolidayPrefs();
  const us = $('#holiday-us');
  const br = $('#holiday-br');
  if (us) us.checked = !!prefs.US;
  if (br) br.checked = !!prefs.BR;

  const save = () => {
    saveHolidayPrefs({ US: !!us?.checked, BR: !!br?.checked });
    refresh();
    toast('Holiday calendars updated');
  };
  us?.addEventListener('change', save);
  br?.addEventListener('change', save);
}

function bind() {
  const dateInput = $('#quick-date');
  const timeInput = $('#quick-time');
  if (dateInput && !dateInput.value) dateInput.value = state.selectedDate;
  if (timeInput && !timeInput.value) {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    timeInput.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  bindTheme();
  bindHolidays();
  syncViewButtons();

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  $('#cal-prev')?.addEventListener('click', () => navigate(-1));
  $('#cal-next')?.addEventListener('click', () => navigate(1));
  $('#cal-today')?.addEventListener('click', goToday);

  $('#day-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'day-modal' || e.target.closest('[data-close]')) closeModal();
  });

  $('#quick-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#quick-title').value.trim();
    const date = $('#quick-date').value || state.selectedDate;
    const time = $('#quick-time').value;
    const leadMinutes = $('#quick-lead').value;

    if (!title || !date || !time) {
      toast('Missing details', 'Title, date, and time are required.');
      return;
    }

    addReminder({ title, date, time, leadMinutes, notes: '' });
    await ensureNotificationPermission();
    e.target.reset();
    $('#quick-date').value = date;
    state.selectedDate = date;
    refresh();
    closeModal();
    toast('Alert added', `${title} on ${date}`);
  });
}

bind();
refresh();
