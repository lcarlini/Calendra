import { monthLabel, renderFullCalendar } from './calendar.js';
import {
  addReminder,
  ensureNotificationPermission,
  formatLead,
  remindersForDate,
  todayISO,
} from './reminders.js';
import { $, toast } from './ui.js';

const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedDate: todayISO(),
};

function refresh() {
  $('#cal-title').textContent = monthLabel(state.year, state.month);
  renderFullCalendar($('#full-calendar'), state.year, state.month, new Date(), (iso) => {
    state.selectedDate = iso;
    openDayModal(iso);
  });
  renderSelectedDay();
}

function renderSelectedDay() {
  const panel = $('#day-panel');
  if (!panel) return;
  const items = remindersForDate(state.selectedDate);
  const label = new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  $('#selected-day-label').textContent = label;

  if (!items.length) {
    panel.innerHTML = `
      <div class="empty-state">
        <strong>Nothing scheduled</strong>
        Pick a day on the calendar or add an alert below.
      </div>
    `;
    return;
  }

  panel.innerHTML = items
    .map(
      (r) => `
      <article class="agenda-item">
        <div class="agenda-bar"></div>
        <div>
          <div class="agenda-time">${r.time} · ${formatLead(r.leadMinutes)}${r.done ? ' · done' : ''}</div>
          <div class="agenda-title">${escapeHtml(r.title)}</div>
          ${r.notes ? `<div class="reminder-meta">${escapeHtml(r.notes)}</div>` : ''}
        </div>
      </article>
    `
    )
    .join('');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function openDayModal(iso) {
  state.selectedDate = iso;
  renderSelectedDay();
  const dateInput = $('#quick-date');
  if (dateInput) dateInput.value = iso;

  const backdrop = $('#day-modal');
  if (!backdrop) return;
  const label = new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  $('#modal-day-label').textContent = label;
  const existing = remindersForDate(iso);
  $('#modal-day-summary').textContent = existing.length
    ? `${existing.length} alert${existing.length === 1 ? '' : 's'} on this day`
    : 'No alerts yet — create one for this day.';
  backdrop.classList.add('open');
}

function closeModal() {
  $('#day-modal')?.classList.remove('open');
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

  $('#cal-prev')?.addEventListener('click', () => {
    state.month -= 1;
    if (state.month < 0) {
      state.month = 11;
      state.year -= 1;
    }
    refresh();
  });

  $('#cal-next')?.addEventListener('click', () => {
    state.month += 1;
    if (state.month > 11) {
      state.month = 0;
      state.year += 1;
    }
    refresh();
  });

  $('#cal-today')?.addEventListener('click', () => {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.selectedDate = todayISO();
    refresh();
  });

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
