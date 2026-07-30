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

async function fetchForecast16(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '16',
    timezone: 'auto',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Forecast failed (${res.status}) ${text}`);
  }
  return res.json();
}

async function fetchSeasonalExtend(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '35',
    timezone: 'auto',
  });
  const res = await fetch(`https://seasonal-api.open-meteo.com/v1/seasonal?${params}`);
  if (!res.ok) throw new Error('Seasonal failed');
  return res.json();
}

/** Detailed 16-day forecast + seasonal extension through day 30. */
export async function fetchWeather(lat, lon) {
  const base = await fetchForecast16(lat, lon);
  const daily = {
    time: [...base.daily.time],
    weather_code: [...base.daily.weather_code],
    temperature_2m_max: [...base.daily.temperature_2m_max],
    temperature_2m_min: [...base.daily.temperature_2m_min],
    precipitation_probability_max: [...base.daily.precipitation_probability_max],
    source: base.daily.time.map(() => 'forecast'),
  };

  try {
    const seasonal = await fetchSeasonalExtend(lat, lon);
    const have = new Set(daily.time);
    for (let i = 0; i < seasonal.daily.time.length && daily.time.length < 30; i += 1) {
      const day = seasonal.daily.time[i];
      if (have.has(day)) continue;
      daily.time.push(day);
      daily.weather_code.push(null);
      daily.temperature_2m_max.push(seasonal.daily.temperature_2m_max[i]);
      daily.temperature_2m_min.push(seasonal.daily.temperature_2m_min[i]);
      daily.precipitation_probability_max.push(null);
      daily.source.push('seasonal');
      have.add(day);
    }
  } catch {
    /* 16-day still useful */
  }

  return { ...base, daily };
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
  { id: 'chicago', label: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { id: 'newyork', label: 'New York', lat: 40.7128, lon: -74.006 },
  { id: 'london', label: 'London', lat: 51.5074, lon: -0.1278 },
  { id: 'amsterdam', label: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { id: 'saopaulo', label: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { id: 'riodejaneiro', label: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { id: 'brasilia', label: 'Brasília', lat: -15.8267, lon: -47.9218 },
];
