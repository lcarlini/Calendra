# Calendra

A refined personal calendar dashboard with modular gadgets: world clocks, a compact and full month calendar, day alerts, and a 30-day local weather forecast.

## Live site (GitHub Pages)

**[https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)**

| Page | URL |
|------|-----|
| Dashboard | [index.html](https://lcarlini.github.io/Calendra/) |
| Full calendar | [calendar.html](https://lcarlini.github.io/Calendra/calendar.html) |

## Features

- **Gadget dashboard** — widgets in multiple sizes (compact, medium, large, wide)
- **Full calendar** — dedicated month view with day selection
- **World clocks** — local time from your device/location, plus Chicago, New York, London, and Amsterdam
- **Day alerts** — meetings and reminders with lead times (5 min, 15 min, 1 hr, etc.) and optional browser notifications
- **Weather** — current conditions and a **30-day forecast** for your current location (Open-Meteo)

## Enable GitHub Pages

1. Open the repo on GitHub: [lcarlini/Calendra](https://github.com/lcarlini/Calendra)
2. Go to **Settings → Pages**
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**
4. Choose branch **`main`** and folder **`/ (root)`**, then save
5. After a minute or two, open [https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)

## Local preview

Serve the folder over HTTP (modules require a local server):

```bash
# Python
python -m http.server 8080

# or Node
npx serve .
```

Then open `http://localhost:8080`.

Allow **location** and **notification** permissions in the browser for local weather and desktop alerts.

## Stack

- Static HTML / CSS / vanilla JS (ES modules)
- [Open-Meteo](https://open-meteo.com/) for weather (no API key)
- Browser Geolocation + `localStorage` for reminders
