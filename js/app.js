import { buildClockList, renderClocks, localTimeZone } from './clocks.js';
import {
  addReminder,
  checkDueReminders,
  deleteReminder,
  ensureNotificationPermission,
  formatLead,
  getReminders,
  remindersForDate,
  todayISO,
  updateReminder,
} from './reminders.js';
import { monthLabel, renderMiniCalendar } from './calendar.js';
import {
  describeWeather,
  fetchWeather,
  getPosition,
  reverseGeocode,
} from './weather.js';
import { $, toast } from './ui.js';

const state = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  localCity: 'Local',
  clocks: buildClockList('Local'),
  locationLabel: 'Detecting location…',
};

function syncHeroDate() {
  const now = new Date();
  const dateEl = $('#hero-date');
  const timeEl = $('#hero-time');
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

function renderClockGadgets() {
  renderClocks($('#clock-grid'), state.clocks);
  const zoneEl = $('#local-zone');
  if (zoneEl) zoneEl.textContent = localTimeZone().replace(/_/g, ' ');
}

function renderMini() {
  const label = $('#mini-cal-label');
  if (label) label.textContent = monthLabel(state.viewYear, state.viewMonth);
  renderMiniCalendar($('#mini-cal'), state.viewYear, state.viewMonth);
}

function renderAgenda() {
  const list = $('#agenda-list');
  if (!list) return;
  const today = todayISO();
  const items = remindersForDate(today).filter((r) => !r.done);

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>Clear day ahead</strong>
        No meetings or reminders scheduled for today.
      </div>
    `;
    return;
  }

  list.innerHTML = items
    .map((item, i) => {
      const tone = i % 3 === 1 ? 'warm' : i % 3 === 2 ? 'rose' : '';
      return `
        <article class="agenda-item">
          <div class="agenda-bar ${tone}"></div>
          <div>
            <div class="agenda-time">${item.time} · ${formatLead(item.leadMinutes)}</div>
            <div class="agenda-title">${escapeHtml(item.title)}</div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderReminderList() {
  const list = $('#reminder-list');
  if (!list) return;
  const today = todayISO();
  const items = getReminders().filter((r) => r.date >= today).slice(0, 20);

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>No alerts yet</strong>
        Add a meeting or reminder — we’ll nudge you before it starts.
      </div>
    `;
    return;
  }

  list.innerHTML = items
    .map(
      (r) => `
      <article class="reminder-item ${r.done ? 'done' : ''}" data-id="${r.id}">
        <div class="reminder-time">${r.time}</div>
        <div>
          <h4 class="reminder-title">${escapeHtml(r.title)}</h4>
          <div class="reminder-meta">${r.date} · ${formatLead(r.leadMinutes)}${r.notes ? ` · ${escapeHtml(r.notes)}` : ''}</div>
        </div>
        <div class="reminder-actions">
          <button type="button" class="btn-icon" data-action="toggle" title="Toggle done">✓</button>
          <button type="button" class="btn-icon" data-action="delete" title="Delete">✕</button>
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

function bindReminderForm() {
  const form = $('#reminder-form');
  if (!form) return;

  const dateInput = $('#reminder-date');
  const timeInput = $('#reminder-time');
  if (dateInput && !dateInput.value) dateInput.value = todayISO();
  if (timeInput && !timeInput.value) {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    timeInput.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#reminder-title').value.trim();
    const date = $('#reminder-date').value;
    const time = $('#reminder-time').value;
    const leadMinutes = $('#reminder-lead').value;
    const notes = $('#reminder-notes').value;

    if (!title || !date || !time) {
      toast('Missing details', 'Add a title, date, and time.');
      return;
    }

    addReminder({ title, date, time, leadMinutes, notes });
    form.reset();
    if (dateInput) dateInput.value = todayISO();
    renderReminderList();
    renderAgenda();
    renderMini();
    await ensureNotificationPermission();
    toast('Alert saved', `${title} · ${formatLead(Number(leadMinutes))}`);
  });

  $('#reminder-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const item = btn.closest('[data-id]');
    if (!item) return;
    const { id } = item.dataset;
    const action = btn.dataset.action;

    if (action === 'delete') {
      deleteReminder(id);
      toast('Reminder removed');
    }
    if (action === 'toggle') {
      const current = getReminders().find((r) => r.id === id);
      if (current) updateReminder(id, { done: !current.done });
    }
    renderReminderList();
    renderAgenda();
    renderMini();
  });
}

function bindMiniCal() {
  $('#mini-prev')?.addEventListener('click', () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    }
    renderMini();
  });

  $('#mini-next')?.addEventListener('click', () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    renderMini();
  });

  $('#mini-today')?.addEventListener('click', () => {
    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    renderMini();
  });
}

function renderWeather(data, locationLabel) {
  const current = data.current;
  const meta = describeWeather(current.weather_code);

  $('#weather-icon').textContent = meta.icon;
  $('#weather-temp').textContent = `${Math.round(current.temperature_2m)}°`;
  $('#weather-desc').textContent = meta.label;
  $('#weather-loc').textContent = locationLabel;
  $('#weather-feels').textContent = `${Math.round(current.apparent_temperature)}°`;
  $('#weather-humidity').textContent = `${current.relative_humidity_2m}%`;
  $('#weather-wind').textContent = `${Math.round(current.wind_speed_10m)} km/h`;

  const scroll = $('#forecast-scroll');
  if (!scroll) return;

  const { daily } = data;
  scroll.innerHTML = daily.time
    .map((date, i) => {
      const d = new Date(`${date}T12:00:00`);
      const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      const w = describeWeather(daily.weather_code[i]);
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const rain = daily.precipitation_probability_max[i] ?? 0;
      return `
        <article class="forecast-day" title="${w.label}">
          <div class="d">${day}</div>
          <div class="ico">${w.icon}</div>
          <div class="t">${max}° / ${min}°</div>
          <div class="rain">${rain}% rain</div>
        </article>
      `;
    })
    .join('');
}

async function initWeather() {
  const status = $('#weather-status');
  try {
    if (status) status.textContent = 'Locating…';
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;

    let label = `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;
    try {
      label = await reverseGeocode(latitude, longitude);
    } catch {
      /* keep coords */
    }

    state.locationLabel = label;
    state.localCity = label.split(',')[0] || 'Local';
    state.clocks = buildClockList(state.localCity);
    renderClockGadgets();

    if (status) status.textContent = 'Loading 30-day forecast…';
    const weather = await fetchWeather(latitude, longitude);
    renderWeather(weather, label);
    if (status) status.textContent = 'Updated just now · Open-Meteo';
    const heroLoc = $('#hero-location');
    if (heroLoc) heroLoc.textContent = label;
  } catch (err) {
    console.warn(err);
    if (status) {
      status.textContent =
        'Location unavailable — allow location access, or we can show a sample city.';
    }
    // Fallback: Chicago
    try {
      const weather = await fetchWeather(41.8781, -87.6298);
      renderWeather(weather, 'Chicago, IL (fallback)');
      state.localCity = 'Local';
      state.clocks = buildClockList('Local');
      renderClockGadgets();
      if (status) status.textContent = 'Using Chicago fallback · enable location for local forecast';
      toast('Location blocked', 'Showing Chicago weather until permission is granted.');
    } catch {
      if (status) status.textContent = 'Weather unavailable right now.';
    }
  }
}

function tick() {
  syncHeroDate();
  renderClockGadgets();
  checkDueReminders((reminder) => {
    toast(`Upcoming: ${reminder.title}`, `${reminder.time} · ${formatLead(reminder.leadMinutes)}`);
  });
}

function init() {
  syncHeroDate();
  renderClockGadgets();
  renderMini();
  renderAgenda();
  renderReminderList();
  bindReminderForm();
  bindMiniCal();
  initWeather();

  $('#enable-alerts')?.addEventListener('click', async () => {
    const ok = await ensureNotificationPermission();
    toast(ok ? 'Desktop alerts enabled' : 'Alerts not available', ok ? 'We’ll notify you before meetings.' : 'Check browser notification settings.');
  });

  tick();
  setInterval(tick, 1000);
}

init();
