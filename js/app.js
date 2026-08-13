import {
  buildPrimaryClocks,
  buildExtraClocks,
  renderClocks,
  CLOCK_CITIES,
  loadClockAssignments,
  setClockAssignment,
  cityById,
} from './clocks.js';
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
import {
  monthLabelPt,
  renderMiniCalendar,
  todayLongPt,
  todayWithWeekdayPt,
} from './calendar.js';
import {
  WEATHER_BARS,
  describeWeather,
  fetchWeather,
  resolveLocation,
  windDirLabel,
  sliceHourly,
} from './weather.js';
import {
  MARKET_TICKERS,
  fetchMarketQuotes,
  getQuotesFetchedAt,
  fetchMarketDetails,
  rangesForTicker,
  formatTickerValue,
  formatChange,
  formatSigned,
  formatMoney,
  digitsFor,
  mountInteractiveChart,
} from './markets.js';
import { initTheme, THEMES, applyTheme, getTheme } from './themes.js';
import { initLayoutEditor } from './layout.js';
import { $, toast, openModal } from './ui.js';

initTheme();

const ACCENT_BY_TICKER = {
  usd: '#38bdf8',
  eur: '#a78bfa',
  btc: '#f59e0b',
  selic: '#34d399',
};

const state = {
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  localCity: 'Brasil',
  clocks: buildPrimaryClocks('Brasil'),
  extraClocks: buildExtraClocks('Brasil'),
  locationLabel: 'Detectando…',
  markets: null,
  weatherByCity: {},
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
  if (dateEl) dateEl.textContent = todayLongPt(now);
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const dayHero = $('#day-hero-date');
  if (dayHero) dayHero.textContent = todayWithWeekdayPt(now);
}

function renderClockGadgets() {
  renderClocks($('#clock-grid'), state.clocks, new Date(), { editable: true });
}

function rebuildClocks() {
  state.clocks = buildPrimaryClocks(state.localCity);
  state.extraClocks = buildExtraClocks(state.localCity);
  renderClockGadgets();
}

function openClockCityPicker(slotId) {
  const assignments = loadClockAssignments();
  const currentId = assignments[slotId];
  const current = cityById(currentId);
  const usedElsewhere = new Set(
    Object.entries(assignments)
      .filter(([slot]) => slot !== slotId)
      .map(([, cityId]) => cityId)
  );

  const modal = openModal({
    title: 'Trocar cidade',
    subtitle: current ? `Slot atual · ${current.city}` : 'Escolha o relógio deste card',
    bodyHtml: `
      <div class="clock-city-picker" role="listbox" aria-label="Cidades">
        ${CLOCK_CITIES.map((city) => {
          const active = city.id === currentId;
          const taken = usedElsewhere.has(city.id);
          return `
            <button type="button" class="clock-city-option ${active ? 'active' : ''}" data-city-id="${city.id}" ${active ? 'aria-current="true"' : ''}>
              <strong>${city.city}</strong>
              <span>${city.timeZone.replace(/_/g, ' ')}${taken ? ' · no outro relógio' : ''}</span>
            </button>`;
        }).join('')}
      </div>
    `,
  });

  modal.el.querySelectorAll('[data-city-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cityId = btn.dataset.cityId;
      setClockAssignment(slotId, cityId);
      rebuildClocks();
      const picked = cityById(cityId);
      toast('Cidade atualizada', picked?.city || cityId);
      modal.close();
    });
  });
}

function renderMini() {
  const label = $('#mini-cal-label');
  if (label) label.textContent = monthLabelPt(state.viewYear, state.viewMonth);
  renderMiniCalendar($('#mini-cal'), state.viewYear, state.viewMonth);
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

  $('#day-hero')?.addEventListener('click', openCalendarModal);
}

function openExtraClocksModal() {
  let tickId = null;
  const modal = openModal({
    title: 'Outras cidades',
    subtitle: 'Relógios extras · atualizam ao vivo',
    wide: true,
    bodyHtml: `<div class="clock-grid" id="extra-clock-grid"></div>`,
    onClose: () => {
      if (tickId) clearInterval(tickId);
    },
  });

  const grid = modal.el.querySelector('#extra-clock-grid');
  const tickExtra = () => renderClocks(grid, state.extraClocks);
  tickExtra();
  tickId = setInterval(tickExtra, 1000);
}

function openCalendarModal() {
  const now = new Date();
  state.viewYear = now.getFullYear();
  state.viewMonth = now.getMonth();

  const modal = openModal({
    title: 'Calendário',
    subtitle: 'Navegue pelo mês',
    wide: true,
    bodyHtml: `
      <div class="mini-cal-nav modal-cal-nav">
        <button type="button" class="btn-icon" id="modal-cal-prev" aria-label="Mês anterior">‹</button>
        <div class="mini-cal-label" id="modal-cal-label">—</div>
        <button type="button" class="btn-icon" id="modal-cal-next" aria-label="Próximo mês">›</button>
      </div>
      <div id="modal-cal"></div>
      <div class="modal-actions" style="justify-content: space-between; margin-top: 1rem">
        <button type="button" class="btn btn-ghost btn-sm" id="modal-cal-today">Hoje</button>
        <a class="btn btn-primary btn-sm" href="calendar.html">Calendário completo</a>
      </div>
    `,
  });

  const paint = () => {
    const label = modal.el.querySelector('#modal-cal-label');
    if (label) label.textContent = monthLabelPt(state.viewYear, state.viewMonth);
    renderMiniCalendar(modal.el.querySelector('#modal-cal'), state.viewYear, state.viewMonth);
  };

  paint();

  modal.el.querySelector('#modal-cal-prev')?.addEventListener('click', () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    }
    paint();
  });
  modal.el.querySelector('#modal-cal-next')?.addEventListener('click', () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    paint();
  });
  modal.el.querySelector('#modal-cal-today')?.addEventListener('click', () => {
    const d = new Date();
    state.viewYear = d.getFullYear();
    state.viewMonth = d.getMonth();
    paint();
  });
}

function renderAgenda() {
  const list = $('#agenda-list');
  if (!list) return;
  const today = todayISO();
  const items = remindersForDate(today).filter((r) => !r.done);

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>Dia livre</strong>
        Nenhum lembrete para hoje.
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
        <strong>Sem alertas</strong>
        Adicione uma reunião — avisamos antes.
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
      toast('Dados incompletos', 'Informe título, data e hora.');
      return;
    }

    addReminder({ title, date, time, leadMinutes, notes });
    form.reset();
    if (dateInput) dateInput.value = todayISO();
    renderReminderList();
    renderAgenda();
    await ensureNotificationPermission();
    toast('Alerta salvo', `${title} · ${formatLead(Number(leadMinutes))}`);
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
      toast('Lembrete removido');
    }
    if (action === 'toggle') {
      const current = getReminders().find((r) => r.id === id);
      if (current) updateReminder(id, { done: !current.done });
    }
    renderReminderList();
    renderAgenda();
  });
}

function forecastHtml(daily, { compact = true } = {}) {
  if (!daily?.time?.length) return '';
  return daily.time
    .map((date, i) => {
      const d = new Date(`${date}T12:00:00`);
      const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });
      const code = daily.weather_code[i];
      const w = code == null ? { label: 'Outlook', icon: '◌' } : describeWeather(code);
      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const rain = daily.precipitation_probability_max[i];
      const rainLabel = rain == null ? '—' : `${rain}%`;
      const ext = daily.source?.[i] === 'seasonal' ? ' extended' : '';
      const uv = daily.uv_index_max?.[i];
      const precip = daily.precipitation_sum?.[i];
      const wind = daily.wind_speed_10m_max?.[i];
      const extra = compact
        ? ''
        : `
          <div class="wx-day-extra">
            ${uv != null ? `<span>UV ${Math.round(uv)}</span>` : ''}
            ${precip != null ? `<span>${precip.toFixed(1)} mm</span>` : ''}
            ${wind != null ? `<span>${Math.round(wind)} km/h</span>` : ''}
          </div>`;
      return `
        <article class="forecast-day${ext}" title="${w.label}">
          <div class="d">${day}</div>
          <div class="ico">${w.icon}</div>
          <div class="t">${max}° / ${min}°</div>
          <div class="rain">${rainLabel}</div>
          ${extra}
        </article>
      `;
    })
    .join('');
}

function hourlyHtml(hours) {
  if (!hours?.length) return '<p class="status-line">Sem dados horários</p>';
  return hours
    .map((h) => {
      const d = new Date(h.time);
      const label = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const w = h.code == null ? { icon: '◌', label: '—' } : describeWeather(h.code);
      return `
        <article class="wx-hour" title="${w.label}">
          <div class="wx-hour-time">${label}</div>
          <div class="wx-hour-ico">${w.icon}</div>
          <div class="wx-hour-temp">${h.temp != null ? `${Math.round(h.temp)}°` : '—'}</div>
          <div class="wx-hour-rain">${h.rain != null ? `${h.rain}%` : '—'}</div>
        </article>
      `;
    })
    .join('');
}

function weatherMetric(label, value) {
  return `
    <div class="mkt-metric">
      <span class="mkt-metric-label">${label}</span>
      <strong class="mkt-metric-value">${value}</strong>
    </div>
  `;
}

function renderWeatherModalBody(city, data) {
  const current = data.current || {};
  const meta = describeWeather(current.weather_code);
  const hours = sliceHourly(data.hourly, 24);
  const sunrise = data.daily?.sunrise?.[0]
    ? new Date(data.daily.sunrise[0]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const sunset = data.daily?.sunset?.[0]
    ? new Date(data.daily.sunset[0]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const uvToday = data.daily?.uv_index_max?.[0];
  const tone = city.tone === 'amber' ? 'tone-amber' : 'tone-emerald';

  return `
    <div class="wx-modal ${tone}">
      <div class="wx-hero">
        <div class="wx-hero-icon">${meta.icon}</div>
        <div>
          <div class="wx-hero-city">${city.label}</div>
          <div class="wx-hero-temp">${current.temperature_2m != null ? `${Math.round(current.temperature_2m)}°` : '—'}</div>
          <div class="wx-hero-desc">${meta.label}</div>
        </div>
        <div class="wx-hero-side status-line">
          Sensação ${current.apparent_temperature != null ? `${Math.round(current.apparent_temperature)}°` : '—'}<br/>
          Atualizado agora · Open-Meteo
        </div>
      </div>

      <div class="mkt-metrics-block">
        <h4>Condições atuais</h4>
        <div class="mkt-metrics-grid">
          ${weatherMetric('Umidade', current.relative_humidity_2m != null ? `${current.relative_humidity_2m}%` : '—')}
          ${weatherMetric('Vento', current.wind_speed_10m != null ? `${Math.round(current.wind_speed_10m)} km/h` : '—')}
          ${weatherMetric('Direção', windDirLabel(current.wind_direction_10m))}
          ${weatherMetric('Nuvens', current.cloud_cover != null ? `${current.cloud_cover}%` : '—')}
          ${weatherMetric('Pressão', current.surface_pressure != null ? `${Math.round(current.surface_pressure)} hPa` : '—')}
          ${weatherMetric('Precipitação', current.precipitation != null ? `${current.precipitation} mm` : '—')}
          ${weatherMetric('UV máx. hoje', uvToday != null ? String(Math.round(uvToday)) : '—')}
          ${weatherMetric('Nascer', sunrise)}
          ${weatherMetric('Pôr do sol', sunset)}
        </div>
      </div>

      <div class="mkt-metrics-block">
        <h4>Próximas 24 horas</h4>
        <div class="wx-hourly-scroll">${hourlyHtml(hours)}</div>
      </div>

      <div class="mkt-metrics-block">
        <h4>Previsão · ~30 dias</h4>
        <div class="forecast-scroll wx-modal-forecast">${forecastHtml(data.daily, { compact: false })}</div>
      </div>
    </div>
  `;
}

async function openWeatherModal(cityId) {
  const city = WEATHER_BARS.find((c) => c.id === cityId);
  if (!city) return;

  const modal = openModal({
    title: `Tempo · ${city.label}`,
    subtitle: 'Condições, horário e previsão completa',
    xl: true,
    bodyHtml: `<div class="market-chart-wrap loading-dots">Carregando clima</div>`,
  });

  try {
    let data = state.weatherByCity[cityId];
    if (!data) {
      data = await fetchWeather(city.lat, city.lon);
      state.weatherByCity[cityId] = data;
    }
    modal.setBody(renderWeatherModalBody(city, data));
  } catch (err) {
    console.warn(err);
    modal.setBody(`<p class="status-line">Não foi possível carregar o clima de ${city.label}.</p>`);
  }
}

function fillWeatherBar(root, data, cityLabel) {
  const current = data.current;
  if (!current) return;
  const meta = describeWeather(current.weather_code);
  const set = (role, value) => {
    const el = root.querySelector(`[data-role="${role}"]`);
    if (el) el.textContent = value;
  };
  set('icon', meta.icon);
  set('temp', `${Math.round(current.temperature_2m)}°`);
  set('desc', meta.label);
  set('feels', `${Math.round(current.apparent_temperature)}°`);
  set('humidity', `${current.relative_humidity_2m}%`);
  set('wind', `${Math.round(current.wind_speed_10m)} km/h`);
  const city = root.querySelector('.weather-bar-city');
  if (city) city.textContent = cityLabel;
  const forecast = root.querySelector('[data-role="forecast"]');
  if (forecast) forecast.innerHTML = forecastHtml(data.daily);
}

let weatherInflight = null;

async function loadWeatherBars({ force = false } = {}) {
  if (weatherInflight && !force) return weatherInflight;
  const btn = $('#weather-refresh');
  if (force) {
    btn?.classList.add('is-busy');
    if (btn) btn.disabled = true;
  }
  const run = (async () => {
    try {
      await Promise.all(
        WEATHER_BARS.map(async (city) => {
          const root = document.querySelector(`[data-weather-bar="${city.id}"]`);
          if (!root) return;
          try {
            const weather = await fetchWeather(city.lat, city.lon, { force });
            state.weatherByCity[city.id] = weather;
            fillWeatherBar(root, weather, city.label);
          } catch (err) {
            console.warn('Weather bar failed', city.id, err);
            const desc = root.querySelector('[data-role="desc"]');
            if (desc) desc.textContent = 'Indisponível';
          }
        })
      );
    } finally {
      if (force) {
        btn?.classList.remove('is-busy');
        if (btn) btn.disabled = false;
      }
    }
  })();
  weatherInflight = run;
  try {
    await run;
  } finally {
    if (weatherInflight === run) weatherInflight = null;
  }
}

async function resolveLocalLabel() {
  try {
    const loc = await resolveLocation();
    state.locationLabel = loc.label;
    state.localCity = loc.label.split(',')[0] || 'Brasil';
    rebuildClocks();
    const heroLoc = $('#hero-location');
    if (heroLoc) heroLoc.textContent = loc.label;
  } catch (err) {
    console.warn(err);
    const heroLoc = $('#hero-location');
    if (heroLoc) heroLoc.textContent = 'Local aproximado';
  }
}

function marketOhlcHtml(ticker, quote) {
  if (ticker.id === 'selic') return '';
  const dig = digitsFor(ticker, quote?.value);
  const cell = (label, value) => `
    <div class="market-ohlc-row">
      <span>${label}</span>
      <strong>${value != null ? `R$ ${formatMoney(value, dig)}` : '—'}</strong>
    </div>`;
  return `
    <div class="market-ohlc">
      ${cell('Abertura', quote?.open)}
      ${cell('Máxima', quote?.high)}
      ${cell('Fechamento', quote?.close ?? quote?.value)}
    </div>`;
}

function renderMarkets(quotes) {
  const grid = $('#market-grid');
  if (!grid) return;
  state.markets = quotes;

  grid.innerHTML = MARKET_TICKERS.map((ticker) => {
    const q = quotes?.[ticker.id];
    const change = formatChange(q?.changePct);
    const up = (q?.changePct ?? 0) > 0;
    const down = (q?.changePct ?? 0) < 0;
    const changeClass = up ? 'up' : down ? 'down' : '';
    return `
      <button type="button" class="market-card accent-${ticker.accent}" data-ticker="${ticker.id}">
        <div class="market-card-top">
          <span class="market-symbol">${ticker.symbol}</span>
          ${change ? `<span class="market-change ${changeClass}">${change}</span>` : '<span class="market-change">—</span>'}
        </div>
        <div class="market-value">${formatTickerValue(ticker, q)}</div>
        <div class="market-label">${ticker.label}</div>
        ${marketOhlcHtml(ticker, q)}
        <div class="market-hint">Gráfico →</div>
      </button>
    `;
  }).join('');
}

let marketsInflight = null;

async function refreshMarkets({ force = false } = {}) {
  if (marketsInflight && !force) return marketsInflight;
  const status = $('#markets-status');
  const btn = $('#markets-refresh');
  if (force) {
    btn?.classList.add('is-busy');
    if (btn) btn.disabled = true;
  }
  const run = (async () => {
    try {
      const fetchedBefore = getQuotesFetchedAt();
      const quotes = await fetchMarketQuotes({ force });
      const fetchedAfter = getQuotesFetchedAt();
      if (force || fetchedBefore !== fetchedAfter || !$('#market-grid')?.children.length) {
        renderMarkets(quotes);
      }
      if (status) {
        const fetchedAt = getQuotesFetchedAt() || Date.now();
        const t = new Date(fetchedAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        status.textContent = `Atualizado ${t}`;
      }
    } catch (err) {
      console.warn('Markets error', err);
      if (status) status.textContent = 'Falha ao atualizar';
      if (!$('#market-grid')?.children.length) {
        renderMarkets({});
      }
    } finally {
      if (force) {
        btn?.classList.remove('is-busy');
        if (btn) btn.disabled = false;
      }
    }
  })();
  marketsInflight = run;
  try {
    await run;
  } finally {
    if (marketsInflight === run) marketsInflight = null;
  }
}

function metricCell(label, value, tone = '') {
  return `
    <div class="mkt-metric ${tone}">
      <span class="mkt-metric-label">${label}</span>
      <strong class="mkt-metric-value">${value}</strong>
    </div>
  `;
}

function renderMarketModalBody(ticker, rangeId, details, accent) {
  const { quote, history, stats, extras } = details;
  const dig = digitsFor(ticker, stats.close ?? quote?.value);
  const unit = ticker.id === 'selic' ? '%' : 'R$';
  const fmt = (v, d = dig) => {
    if (v == null) return '—';
    if (ticker.id === 'selic') return `${formatMoney(v, 2)}%`;
    return `${unit} ${formatMoney(v, d)}`;
  };
  const rangeChange = formatChange(stats.changePct);
  const dayChange = formatChange(stats.dayPct);
  const up = (stats.changePct ?? 0) >= 0;
  const ranges = rangesForTicker(ticker.id);

  const extrasHtml =
    ticker.id === 'btc' && extras
      ? `
      <div class="mkt-metrics-block">
        <h4>Mercado cripto</h4>
        <div class="mkt-metrics-grid">
          ${metricCell('Preço USD', extras.priceUsd != null ? `$ ${formatMoney(extras.priceUsd, 0)}` : '—')}
          ${metricCell('Market cap BRL', extras.marketCapBrl != null ? `R$ ${formatMoney(extras.marketCapBrl / 1e9, 2)} bi` : '—')}
          ${metricCell('Volume 24h', extras.volume24hBrl != null ? `R$ ${formatMoney(extras.volume24hBrl / 1e9, 2)} bi` : '—')}
          ${metricCell('Var. 24h (CG)', formatChange(extras.change24hCg) || '—', (extras.change24hCg ?? 0) >= 0 ? 'up' : 'down')}
        </div>
      </div>`
      : '';

  return `
    <div class="mkt-modal" data-mkt-ticker="${ticker.id}">
      <div class="mkt-hero">
        <div>
          <div class="mkt-hero-symbol accent-${ticker.accent}">${ticker.symbol}</div>
          <div class="mkt-hero-price">${formatTickerValue(ticker, { value: stats.close ?? quote?.value })}</div>
          <div class="mkt-hero-changes">
            ${
              rangeChange
                ? `<span class="market-change ${up ? 'up' : 'down'}">${rangeChange} no período</span>`
                : ''
            }
            ${
              dayChange
                ? `<span class="market-change ${(stats.dayPct ?? 0) >= 0 ? 'up' : 'down'}">${dayChange} no dia</span>`
                : ''
            }
          </div>
        </div>
        <div class="mkt-hero-side">
          <div class="status-line">${stats.samples} pontos · ${history[0]?.date || '—'} → ${history.at(-1)?.date || '—'}</div>
          <div class="status-line">${quote?.name || ticker.label}</div>
          <div class="status-line mkt-hover-hint">Passe o mouse no gráfico para ver o preço</div>
        </div>
      </div>

      <div class="mkt-ranges" role="tablist" aria-label="Período">
        ${ranges
          .map(
            (r) => `
          <button type="button" class="mkt-range-btn ${r.id === rangeId ? 'active' : ''}" data-range="${r.id}">
            ${r.label}
          </button>`
          )
          .join('')}
      </div>

      <div class="market-chart-wrap mkt-chart-panel" data-mkt-chart></div>

      <div class="mkt-metrics-block">
        <h4>Resultado do período</h4>
        <div class="mkt-metrics-grid">
          ${metricCell('Abertura', fmt(stats.open))}
          ${metricCell('Fechamento', fmt(stats.close))}
          ${metricCell('Máxima', fmt(stats.high), 'up')}
          ${metricCell('Mínima', fmt(stats.low), 'down')}
          ${metricCell('Variação', formatSigned(stats.change, dig), up ? 'up' : 'down')}
          ${metricCell('Variação %', rangeChange || '—', up ? 'up' : 'down')}
          ${metricCell('Média', fmt(stats.avg))}
          ${metricCell('Amplitude', fmt(stats.amplitude))}
          ${metricCell('Amplitude %', formatChange(stats.amplitudePct) || '—')}
          ${metricCell('Amostras', String(stats.samples))}
        </div>
      </div>

      ${
        ticker.id !== 'selic'
          ? `
      <div class="mkt-metrics-block">
        <h4>Cotação ao vivo</h4>
        <div class="mkt-metrics-grid">
          ${metricCell('Compra (bid)', fmt(stats.bid))}
          ${metricCell('Venda (ask)', fmt(stats.ask))}
          ${metricCell('Spread', stats.spread != null ? formatMoney(stats.spread, dig) : '—')}
          ${metricCell('Var. bid', formatSigned(stats.varBid, dig), (stats.varBid ?? 0) >= 0 ? 'up' : 'down')}
          ${metricCell('Abertura', fmt(quote?.open ?? stats.open))}
          ${metricCell('Máx. do dia', fmt(stats.quoteHigh))}
          ${metricCell('Mín. do dia', fmt(stats.quoteLow))}
          ${metricCell('Var. do dia', dayChange || '—', (stats.dayPct ?? 0) >= 0 ? 'up' : 'down')}
          ${metricCell('Atualizado', quote?.timestamp ? String(quote.timestamp).slice(0, 19) : '—')}
        </div>
      </div>`
          : `
      <div class="mkt-metrics-block">
        <h4>Taxa Selic</h4>
        <div class="mkt-metrics-grid">
          ${metricCell('Taxa atual', fmt(quote?.value ?? stats.close))}
          ${metricCell('No período', fmt(stats.close))}
          ${metricCell('Máx. período', fmt(stats.high))}
          ${metricCell('Mín. período', fmt(stats.low))}
          ${metricCell('Fonte', 'BCB · série 432')}
        </div>
      </div>`
      }

      ${extrasHtml}
    </div>
  `;
}

async function openMarketChart(tickerId, rangeId) {
  const ticker = MARKET_TICKERS.find((t) => t.id === tickerId);
  if (!ticker) return;
  const accent = ACCENT_BY_TICKER[tickerId] || '#2dd4bf';
  const ranges = rangesForTicker(tickerId);
  const initialRange = rangeId || ranges[3]?.id || ranges[0]?.id || '30d';

  const modal = openModal({
    title: `${ticker.label} · ${ticker.symbol}`,
    subtitle: 'Análise completa · períodos e métricas',
    xl: true,
    bodyHtml: `<div class="market-chart-wrap loading-dots">Carregando análise</div>`,
  });

  const paint = async (rid) => {
    try {
      modal.setBody(`<div class="market-chart-wrap loading-dots">Carregando ${rid.toUpperCase()}</div>`);
      const details = await fetchMarketDetails(tickerId, rid);
      if (details.quote) {
        state.markets = { ...(state.markets || {}), [tickerId]: details.quote };
      }
      modal.setBody(renderMarketModalBody(ticker, rid, details, accent));
      const chartHost = modal.el.querySelector('[data-mkt-chart]');
      mountInteractiveChart(chartHost, details.history, { accent, ticker });
      modal.el.querySelectorAll('[data-range]').forEach((btn) => {
        btn.addEventListener('click', () => paint(btn.dataset.range));
      });
    } catch (err) {
      console.warn(err);
      modal.setBody(`<p class="status-line">Não foi possível carregar a análise de ${ticker.label}.</p>`);
    }
  };

  await paint(initialRange);
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
    if (editBtn) editBtn.textContent = editing ? 'Concluir' : 'Organizar';
    if (editing) toast('Modo organizar', 'Arraste ⠿ · toque S–Full para redimensionar');
  });

  $('#reset-layout')?.addEventListener('click', () => layoutApi?.reset());
  $('#weather-refresh')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    loadWeatherBars({ force: true });
  });
  $('#markets-refresh')?.addEventListener('click', () => refreshMarkets({ force: true }));
}

function bindModals() {
  $('#open-extra-clocks')?.addEventListener('click', openExtraClocksModal);
  $('#clock-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clock-slot]');
    if (btn) openClockCityPicker(btn.dataset.clockSlot);
  });
  $('#open-cal-modal')?.addEventListener('click', openCalendarModal);

  $('#market-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-ticker]');
    if (card) openMarketChart(card.dataset.ticker);
  });

  $('#weather-bars')?.addEventListener('click', (e) => {
    const panel = e.target.closest('[data-weather-bar]');
    if (panel) openWeatherModal(panel.dataset.weatherBar);
  });

  $('#weather-bars')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const panel = e.target.closest('[data-weather-bar]');
    if (!panel) return;
    e.preventDefault();
    openWeatherModal(panel.dataset.weatherBar);
  });
}

function tick() {
  syncHeroDate();
  renderClockGadgets();
  checkDueReminders((reminder) => {
    toast(`Em breve: ${reminder.title}`, `${reminder.time} · ${formatLead(reminder.leadMinutes)}`);
  });
}

async function refreshSlow() {
  await Promise.all([loadWeatherBars(), resolveLocalLabel()]);
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
  bindModals();
  resolveLocalLabel();
  loadWeatherBars();
  refreshMarkets();

  $('#enable-alerts')?.addEventListener('click', async () => {
    const ok = await ensureNotificationPermission();
    toast(
      ok ? 'Alertas ativados' : 'Alertas indisponíveis',
      ok ? 'Avisamos antes das reuniões.' : 'Verifique as permissões do navegador.'
    );
  });

  tick();
  setInterval(tick, 1000);
  setInterval(refreshMarkets, 5000);
  setInterval(refreshSlow, 60_000);
}

init();
