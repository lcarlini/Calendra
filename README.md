# Calendra

A personal portal built as a static site (HTML, CSS, vanilla JavaScript ES modules): a clock-first dashboard, a synchronized calendar with
travel planning, a news reader, markets, and a price-and-deals tracker. No build step and no backend is required for the core features.

## Live site (GitHub Pages)

**[https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)**

| Page | File | What it does |
|------|------|--------------|
| Home (portal, GitHub Pages) | [index.html](https://lcarlini.github.io/Calendra/index.html) | Five launch cards. The root URL opens the same page. |
| Calendar | [dashboard.html](https://lcarlini.github.io/Calendra/dashboard.html) | Three world clocks per row, compact calendar, markets, weather, policy-rate strip, TV mode |
| Calendário | [calendario.html](https://lcarlini.github.io/Calendra/calendario.html) | Year/month/week/day, US + Brazil + GCM/Brasil/Davi calendars, **Travel & Holiday Intelligence** (2026–2030, `.ics` export) |
| News | [news.html](https://lcarlini.github.io/Calendra/news.html) | Stories grouped across outlets, explainable ranking, optional AI summaries. **Needs the news proxy** |
| Markets | [markets.html](https://lcarlini.github.io/Calendra/markets.html) | Policy rates, currencies, B3 watchlist. US assets are shown as unavailable |
| Deals | [deals.html](https://lcarlini.github.io/Calendra/deals.html) | Community deals feed (needs the proxy), your own price tracking, coupons, US price comparison |
| Settings | [settings.html](https://lcarlini.github.io/Calendra/settings.html) | Theme, TV mode, AI provider, export/import/reset |

Legacy: `calendar.html` redirects to `calendario.html` and keeps the query string (for example `?date=2026-09-07`).

Status of every integration, what is not done, and the test results are in [docs/implementation-note.md](docs/implementation-note.md).
Screenshots (small phone, Full HD, TV/4K) are in [docs/screenshots](docs/screenshots).

## What needs a companion service

GitHub Pages serves static files only. The publishers' RSS feeds send no CORS headers, so a browser cannot read them directly. The small
proxy in `backend/news-proxy` fetches **only** the feeds listed in `js/news/sources.js` and `js/deals/feeds.js` (chosen by id, never by URL),
answers only the origins you list, and limits size, time and request rate.

```bash
# on your computer (binds to 127.0.0.1 only)
ALLOWED_ORIGINS=http://localhost:8080,https://lcarlini.github.io node backend/news-proxy/server.mjs
# then paste http://127.0.0.1:8791 on the News page
```

Browser note: Chrome asks you to allow "local network access" before an **https** page (this site) may call a server on your own computer; the proxy answers the
required preflight, but the permission is yours to grant. If it is declined or unavailable, deploy the proxy over https (the Cloudflare Worker below).

Or deploy `backend/news-proxy` as a Cloudflare Worker (`npx wrangler deploy`, edit `ALLOWED_ORIGINS` in `wrangler.toml`).
See `.env.example` (placeholders only). Without a proxy, Calendar, Calendário, Markets and Settings work fully; News and the Deals feed show a clear setup state and no invented headlines.

## AI summaries (optional, off by default)

Settings offers **Anthropic** (your own API key) or **Ollama** (a running local server). Summaries are generated only when you press a button on a story,
show that they are AI-generated, list the headlines/excerpts they were based on, and say when the input was only headlines.
* The API key is kept **for the session only** unless you opt in to remembering it. Browser storage is readable by any script on the page, so use a key with a low spending limit. Keys are never exported or logged.
* Anthropic summaries send headlines and short excerpts to Anthropic; you must confirm this first. Ollama stays on your machine, but the browser can only call it if Ollama allows the site's origin (`OLLAMA_ORIGINS`).

## Your data

Everything is stored in this browser (`localStorage`, keys start with `calendra.`). Nothing syncs between devices. Settings has export, validated import and reset; exports never include API keys or caches.

## Tests

```bash
node --test tests/*.test.mjs                      # 186 unit tests, no dependencies (Node 18+)

# Real-browser tests need Chrome (set CHROME_PATH if it is not in the default Windows location)
python -m http.server 8770 &
ALLOWED_ORIGINS=http://localhost:8770 node backend/news-proxy/server.mjs &
node tests/browser/layout.mjs   http://localhost:8770            # 9 viewports x 7 pages, clocks, TV mode
node tests/browser/travel.mjs   http://localhost:8770
node tests/browser/markets.mjs  http://localhost:8770            # uses the real public APIs
node tests/browser/news.mjs     http://localhost:8770 http://127.0.0.1:8791
node tests/browser/deals.mjs    http://localhost:8770 http://127.0.0.1:8791
node tests/browser/keyboard.mjs http://localhost:8770
node tests/browser/screenshots.mjs http://localhost:8770 http://127.0.0.1:8791
```
Tests that call public APIs can hit their rate limits if repeated in quick succession.

## Calendar data

Reference calendars (`js/calendar/specialized.js`) are transcribed from `UI/Holidays.png` (GCM 2025–2027) and `UI/Calendar.html` (Brasil and Davi, **2026 only**).
Nothing is extrapolated to other years. Travel planning counts **statutory** holidays only; optional observances (Carnaval, Corpus Christi) and the reference calendars are never treated as days off.

## Deploy

1. Settings → Pages → *Deploy from a branch* → `main` / `/(root)`.
2. Open `https://lcarlini.github.io/Calendra/`.

## Local preview

```bash
python -m http.server 8080   # or: npx serve .
```

## Stack

Static HTML / CSS / vanilla JS (ES modules). Public APIs used from the browser: Open-Meteo, Banco Central do Brasil, ECB, NY Fed, brapi.dev. Optional Node/Cloudflare Worker proxy for RSS feeds.
