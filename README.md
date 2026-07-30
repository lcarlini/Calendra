# Calendra

A refined personal calendar dashboard with modular gadgets: world clocks, multi-view calendar, day alerts, themes, and a 30-day local weather outlook.

## Live site (GitHub Pages)

**[https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)**

| Page | URL |
|------|-----|
| Dashboard | [index.html](https://lcarlini.github.io/Calendra/) |
| Full calendar | [calendar.html](https://lcarlini.github.io/Calendra/calendar.html) |

## Features

- **Themes** — Mist, Midnight (dark), Ocean, Sand, Ink, Aurora
- **Arrange gadgets** — drag to reorder, resize S / M / L / XL / Full (saved in the browser)
- **World clocks** — local time plus Chicago, New York, London, Amsterdam
- **Weather** — current conditions + ~30-day outlook (16-day detailed forecast + seasonal extension). Auto location (GPS → IP fallback) or city presets
- **Day alerts** — meetings/reminders with lead times and optional desktop notifications
- **Full calendar** — **Year / Month / Week / Day** views
- **Holidays** — United States and Brazil (toggle independently), including movable dates (Carnaval, Easter-related, etc.)

## Enable GitHub Pages

1. Open [lcarlini/Calendra](https://github.com/lcarlini/Calendra)
2. **Settings → Pages**
3. Source: **Deploy from a branch** → `main` / **`/(root)`**
4. Open [https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)

## Local preview

```bash
python -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. Allow location/notifications if you want GPS weather and desktop alerts.

## Stack

- Static HTML / CSS / vanilla JS (ES modules)
- [Open-Meteo](https://open-meteo.com/) forecast + seasonal APIs (no API key)
- Browser Geolocation, IP geolocation fallback, `localStorage` for layout/theme/reminders
