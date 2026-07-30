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
  CITY_PRESETS,
  describeWeather,
  fetchWeather,
  resolveLocation,
} from './weather.js';
import { initTheme, THEMES, applyTheme, getTheme } from './themes.js';
import { initLayoutEditor } from './layout.js';
import { $, toast } from './ui.js';

initTheme();

const state = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  localCity: 'Local',
  clocks: buildClockList('Local'),
  locationLabel: 'Detecting location…',
  weatherCity: localStorage.getItem('calendra.weatherCity.v1') || 'auto',
};

let layoutApi = null;

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

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
  if (zoneEl) {
    const tz = localTimeZone();
    const abbr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
      hour: '2-digit',
    })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    zoneEl.textContent = `${abbr || ''} · ${tz.replace(/_/g, ' ')}`.replace(/^ · /, '');
  }
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
      </article>`
    )
    .join('');
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
  if (!current) throw new Error('No current weather');
  const meta = describeWeather(current.weather_code);

  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  set('#weather-icon', meta.icon);
  set('#weather-temp', `${Math.round(current.temperature_2m)}°`);
  set('#weather-desc', meta.label);
  set('#weather-loc', locationLabel);
  set('#weather-feels', `${Math.round(current.apparent_temperature)}°`);
  set('#weather-humidity', `${current.relative_humidity_2m}%`);
  set('#weather-wind', `${Math.round(current.wind_speed_10m)} km/h`);

  const scroll = $('#forecast-scroll');
  if (!scroll) return;

  const { daily } = data;
  scroll.innerHTML = daily.time
    .map((date, i) => {
      const d = new Date(`${date}T12:00:00`);
      const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      const code = daily.weather_code[i];
      const w = code == null ? { label: 'Extended outlook', icon: '◌' } : describeWeather(code);
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const rain = daily.precipitation_probability_max[i];
      const rainLabel = rain == null ? 'outlook' : `${rain}% rain`;
      const ext = daily.source?.[i] === 'seasonal' ? ' extended' : '';
      return `
        <article class="forecast-day${ext}" title="${w.label}">
          <div class="d">${day}</div>
          <div class="ico">${w.icon}</div>
          <div class="t">${max}° / ${min}°</div>
          <div class="rain">${rainLabel}</div>
        </article>
      `;
    })
    .join('');
}

async function loadWeatherFor(lat, lon, label, note) {
  const status = $('#weather-status');
  if (status) {
    status.classList.add('loading-dots');
    status.textContent = 'Loading forecast';
  }
  const weather = await fetchWeather(lat, lon);
  renderWeather(weather, label);
  if (status) {
    status.classList.remove('loading-dots');
    status.textContent = note || `Updated · ${weather.daily.time.length}-day outlook`;
  }
  const heroLoc = $('#hero-location');
  if (heroLoc) heroLoc.textContent = label;
}

async function initWeather() {
  const status = $('#weather-status');
  const citySelect = $('#weather-city');
  if (citySelect) {
    citySelect.innerHTML = CITY_PRESETS.map(
      (c) => `<option value="${c.id}">${c.label}</option>`
    ).join('');
    citySelect.value = state.weatherCity;
  }

  try {
    const preset = CITY_PRESETS.find((c) => c.id === state.weatherCity);

    if (preset && preset.lat != null) {
      await loadWeatherFor(preset.lat, preset.lon, preset.label, `Updated · ${preset.label}`);
      return;
    }

    if (status) status.textContent = 'Locating…';
    const loc = await resolveLocation();
    state.locationLabel = loc.label;
    state.localCity = loc.label.split(',')[0] || 'Local';
    state.clocks = buildClockList(state.localCity);
    renderClockGadgets();

    const note =
      loc.source === 'gps'
        ? 'Updated · GPS · 30-day outlook'
        : 'Updated · IP approx · 30-day outlook';
    await loadWeatherFor(loc.latitude, loc.longitude, loc.label, note);
  } catch (err) {
    console.warn('Weather error', err);
    try {
      await loadWeatherFor(41.8781, -87.6298, 'Chicago, IL (fallback)', 'Fallback · Chicago');
      toast('Weather fallback', 'Could not resolve your location — showing Chicago.');
    } catch (err2) {
      console.warn(err2);
      if (status) {
        status.classList.remove('loading-dots');
        status.textContent = 'Weather unavailable — try another city';
      }
      toast('Weather failed', 'Check your network and try a city preset.');
    }
  }
}

function bindThemeAndLayout() {
  const select = $('#theme-select');
  if (select) {
    select.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
    select.value = getTheme();
    select.addEventListener('change', () => applyTheme(select.value));
  }

  layoutApi = initLayoutEditor('#gadget-grid');

  const editBtn = $('#edit-layout');
  let editing = false;
  editBtn?.addEventListener('click', () => {
    editing = !editing;
    layoutApi?.setEditMode(editing);
    if (editBtn) editBtn.textContent = editing ? 'Done arranging' : 'Arrange gadgets';
    if (editing) toast('Arrange mode', 'Drag ⠿ to reorder · tap S–Full to resize');
  });

  $('#reset-layout')?.addEventListener('click', () => layoutApi?.reset());

  $('#weather-city')?.addEventListener('change', async (e) => {
    state.weatherCity = e.target.value;
    localStorage.setItem('calendra.weatherCity.v1', state.weatherCity);
    await initWeather();
  });

  $('#weather-refresh')?.addEventListener('click', () => initWeather());
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
  bindThemeAndLayout();
  initWeather();

  $('#enable-alerts')?.addEventListener('click', async () => {
    const ok = await ensureNotificationPermission();
    toast(
      ok ? 'Desktop alerts enabled' : 'Alerts not available',
      ok ? 'We’ll notify you before meetings.' : 'Check browser notification settings.'
    );
  });

  tick();
  setInterval(tick, 1000);
}

init();
