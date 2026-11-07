# Calendra

A refined personal calendar dashboard with modular gadgets: world clocks, multi-view calendar, day alerts, themes, and a 30-day local weather outlook.

## Live site (GitHub Pages)

**[https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)**

| Page | File | Status |
|------|------|--------|
| Home (portal, GitHub Pages) | [index.html](https://lcarlini.github.io/Calendra/index.html) | Working; the root URL https://lcarlini.github.io/Calendra/ opens the same page |
| Calendar (clock-first dashboard) | [dashboard.html](https://lcarlini.github.io/Calendra/dashboard.html) | Working |
| Calendário (full calendar) | [calendario.html](https://lcarlini.github.io/Calendra/calendario.html) | Working |
| News | [news.html](https://lcarlini.github.io/Calendra/news.html) | Placeholder, not integrated |
| Markets | [markets.html](https://lcarlini.github.io/Calendra/markets.html) | Placeholder, not integrated |
| Deals | [deals.html](https://lcarlini.github.io/Calendra/deals.html) | Placeholder; search opens Google in a new tab |
| Settings | [settings.html](https://lcarlini.github.io/Calendra/settings.html) | Working (theme, holiday reset) |

Legacy: `calendar.html` redirects to `calendario.html` and keeps the query string (for example `?date=2026-09-07`).

## Calendar data

- Reference calendars are in `js/calendar/specialized.js`. They are transcribed from `UI/Holidays.png` (GCM, 2025–2027) and `UI/Calendar.html` (Brasil and Davi, 2026 only).
- Nothing is extrapolated beyond the years the sources cover.
- Run the tests with `node --test tests/*.test.mjs` (Node 18+; no dependencies).
- Real-browser checks (needs Chrome; set `CHROME_PATH` if it is not in the default Windows location):
  `node tests/browser/smoke.mjs <baseUrl>` loads every page and reports JS errors, failed requests and sideways overflow;
  `node tests/browser/interact.mjs <baseUrl>` checks the `?date=` link, the weekday columns and phone-width overflow, and exits non-zero on failure.
  Example: `python -m http.server 8080` then `node tests/browser/interact.mjs http://localhost:8080`.

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
