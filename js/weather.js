const WEATHER_CODES = {
  0: { label: 'Clear sky', icon: '☀' },
  1: { label: 'Mainly clear', icon: '🌤' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁' },
  45: { label: 'Foggy', icon: '🌫' },
  48: { label: 'Rime fog', icon: '🌫' },
  51: { label: 'Light drizzle', icon: '🌦' },
  53: { label: 'Drizzle', icon: '🌦' },
  55: { label: 'Heavy drizzle', icon: '🌧' },
  61: { label: 'Light rain', icon: '🌧' },
  63: { label: 'Rain', icon: '🌧' },
  65: { label: 'Heavy rain', icon: '⛈' },
  71: { label: 'Light snow', icon: '🌨' },
  73: { label: 'Snow', icon: '❄' },
  75: { label: 'Heavy snow', icon: '❄' },
  80: { label: 'Rain showers', icon: '🌦' },
  81: { label: 'Showers', icon: '🌧' },
  82: { label: 'Violent showers', icon: '⛈' },
  95: { label: 'Thunderstorm', icon: '⚡' },
  96: { label: 'Storm with hail', icon: '⛈' },
  99: { label: 'Severe hail storm', icon: '⛈' },
};

export function describeWeather(code) {
  return WEATHER_CODES[code] || { label: 'Conditions unknown', icon: '◎' };
}

export async function reverseGeocode(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocode failed');
  const data = await res.json();
  const city = data.city || data.locality || data.principalSubdivision || 'Your location';
  const region = data.principalSubdivisionCode || data.countryCode || '';
  return region ? `${city}, ${region}` : city;
}

/** IP-based location when GPS is denied (no browser permission needed). */
export async function locateByIp() {
  const res = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en');
  if (!res.ok) throw new Error('IP locate failed');
  const data = await res.json();
  if (data.latitude == null || data.longitude == null) throw new Error('No IP coords');
  const city = data.city || data.locality || data.principalSubdivision || 'Approximate location';
  const region = data.principalSubdivisionCode || data.countryCode || '';
  return {
    latitude: data.latitude,
    longitude: data.longitude,
    label: region ? `${city}, ${region}` : city,
    source: 'ip',
  };
}

const weatherCache = new Map();
const WEATHER_TTL_MS = 45_000;

async function fetchOpenMeteo(url, { force = false } = {}) {
  const href = force ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}` : url;
  const res = await fetch(href, { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Forecast failed (${res.status}) ${text}`);
  }
  return res.json();
}

async function fetchForecast16(lat, lon, { force = false } = {}) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,apparent_temperature,precipitation,cloud_cover,surface_pressure,is_day',
    hourly:
      'temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,apparent_temperature',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max',
    forecast_days: '16',
    timezone: 'auto',
  });
  return fetchOpenMeteo(`https://api.open-meteo.com/v1/forecast?${params}`, { force });
}

async function fetchSeasonalExtend(lat, lon, { force = false } = {}) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '35',
    timezone: 'auto',
  });
  return fetchOpenMeteo(`https://seasonal-api.open-meteo.com/v1/seasonal?${params}`, { force });
}

/** Detailed 16-day forecast + seasonal extension through day 30. */
export async function fetchWeather(lat, lon, { force = false } = {}) {
  const cacheKey = `${lat},${lon}`;
  const cached = weatherCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < WEATHER_TTL_MS) return cached.data;

  const base = await fetchForecast16(lat, lon, { force });
  const daily = {
    time: [...base.daily.time],
    weather_code: [...base.daily.weather_code],
    temperature_2m_max: [...base.daily.temperature_2m_max],
    temperature_2m_min: [...base.daily.temperature_2m_min],
    precipitation_probability_max: [...base.daily.precipitation_probability_max],
    precipitation_sum: [...(base.daily.precipitation_sum || [])],
    sunrise: [...(base.daily.sunrise || [])],
    sunset: [...(base.daily.sunset || [])],
    uv_index_max: [...(base.daily.uv_index_max || [])],
    wind_speed_10m_max: [...(base.daily.wind_speed_10m_max || [])],
    source: base.daily.time.map(() => 'forecast'),
  };

  try {
    const seasonal = await fetchSeasonalExtend(lat, lon, { force });
    const have = new Set(daily.time);
    for (let i = 0; i < seasonal.daily.time.length && daily.time.length < 30; i += 1) {
      const day = seasonal.daily.time[i];
      if (have.has(day)) continue;
      daily.time.push(day);
      daily.weather_code.push(null);
      daily.temperature_2m_max.push(seasonal.daily.temperature_2m_max[i]);
      daily.temperature_2m_min.push(seasonal.daily.temperature_2m_min[i]);
      daily.precipitation_probability_max.push(null);
      daily.precipitation_sum.push(null);
      daily.sunrise.push(null);
      daily.sunset.push(null);
      daily.uv_index_max.push(null);
      daily.wind_speed_10m_max.push(null);
      daily.source.push('seasonal');
      have.add(day);
    }
  } catch {
    /* 16-day still useful */
  }

  const data = { ...base, daily };
  weatherCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

export function windDirLabel(deg) {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const dirs = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

/** Next N hours from hourly payload (from "now"). */
export function sliceHourly(hourly, hours = 24) {
  if (!hourly?.time?.length) return [];
  const now = Date.now();
  const start = hourly.time.findIndex((t) => new Date(t).getTime() >= now - 60 * 60 * 1000);
  const from = start < 0 ? 0 : start;
  const out = [];
  for (let i = from; i < hourly.time.length && out.length < hours; i += 1) {
    out.push({
      time: hourly.time[i],
      temp: hourly.temperature_2m?.[i],
      feels: hourly.apparent_temperature?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      rain: hourly.precipitation_probability?.[i],
      code: hourly.weather_code?.[i],
      wind: hourly.wind_speed_10m?.[i],
    });
  }
  return out;
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 10 * 60 * 1000,
    });
  });
}

export async function resolveLocation() {
  try {
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;
    let label = `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;
    try {
      label = await reverseGeocode(latitude, longitude);
    } catch {
      /* coords label ok */
    }
    return { latitude, longitude, label, source: 'gps' };
  } catch {
    const ip = await locateByIp();
    return ip;
  }
}

export const CITY_PRESETS = [
  { id: 'auto', label: 'Auto (my location)', lat: null, lon: null },
  { id: 'pocos', label: 'Poços de Caldas', lat: -21.7876, lon: -46.5614 },
  { id: 'sorocaba', label: 'Sorocaba', lat: -23.5015, lon: -47.4526 },
  { id: 'chicago', label: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { id: 'newyork', label: 'New York', lat: 40.7128, lon: -74.006 },
  { id: 'london', label: 'London', lat: 51.5074, lon: -0.1278 },
  { id: 'amsterdam', label: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { id: 'saopaulo', label: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { id: 'riodejaneiro', label: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { id: 'brasilia', label: 'Brasília', lat: -15.8267, lon: -47.9218 },
];

/** Fixed dual weather bars on the dashboard. */
export const WEATHER_BARS = [
  { id: 'pocos', label: 'Poços de Caldas', short: 'Poços de Caldas', lat: -21.7876, lon: -46.5614, tone: 'emerald' },
  { id: 'sorocaba', label: 'Sorocaba', short: 'Sorocaba', lat: -23.5015, lon: -47.4526, tone: 'amber' },
];
