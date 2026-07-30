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
  return WEATHER_CODES[code] || { label: 'Conditions unknown', icon: '🌡' };
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

export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '30',
    timezone: 'auto',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('Weather request failed');
  return res.json();
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 10 * 60 * 1000,
    });
  });
}
