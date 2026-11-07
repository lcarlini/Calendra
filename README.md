# Calendra

A personal portal built as a static site (HTML, CSS, vanilla JavaScript ES modules): a clock-first dashboard, a synchronized calendar with
travel planning, a news reader, markets, and a price-and-deals tracker. No build step and no backend is required for the core features.

## Live site (GitHub Pages)

**[https://lcarlini.github.io/Calendra/](https://lcarlini.github.io/Calendra/)**

| Page | File | What it does |
|------|------|--------------|
| Home (portal, GitHub Pages) | [index.html](https://lcarlini.github.io/Calendra/index.html) | Five launch cards. The root URL opens the same page. |
| Calendar | [dashboard.html](https://lcarlini.github.io/Calendra/dashboard.html) | Three world clocks per row, compact calendar, markets, weather, policy-rate strip, TV mode |
| Calendário | [calendario.html](https://lcarlini.github.io/Calendra/calendario.html) | Opens on the year view modelled on `UI/Calendar.html` (12 full months, D/B/G badges, combo colours, tooltips), plus month/week/day, US + Brazil + GCM/Brasil/Davi calendars, **Travel & Holiday Intelligence** (2026–2030, `.ics` export) |
| News | [news.html](https://lcarlini.github.io/Calendra/news.html) | Stories grouped across outlets, explainable ranking, optional AI summaries. Loads with no server |
| Markets | [markets.html](https://lcarlini.github.io/Calendra/markets.html) | Policy rates, currencies, B3 watchlist. US assets are shown as unavailable |
| Deals | [deals.html](https://lcarlini.github.io/Calendra/deals.html) | Community deals feed, your own price tracking, coupons, US price comparison |
| Settings | [settings.html](https://lcarlini.github.io/Calendra/settings.html) | Theme, TV mode, AI provider, export/import/reset |

Legacy: `calendar.html` redirects to `calendario.html` and keeps the query string (for example `?date=2026-09-07`).

Status of every integration, what is not done, and the test results are in [docs/implementation-note.md](docs/implementation-note.md).
Screenshots (small phone, Full HD, TV/4K) are in [docs/screenshots](docs/screenshots).

## Everything runs from static files (no server)

Open the site and every page works from HTML, CSS and JavaScript alone. **News** and the **Deals** community feed read the publishers' own public RSS
feeds through [rss2json.com](https://rss2json.com), a public feed converter that browsers may call (the publishers' feeds send no CORS headers, so a page
cannot read them directly). Its free tier returns the newest 10 items per feed, so News loads several feeds per outlet (g1 has Economia, Política and Mundo too).
It is rate limited: if a feed is throttled, that source shows its status and the others still load; saved copies are shown as stale.

Optional ways to get more headlines (News page, "Optional: get more headlines"):
* a free rss2json API key (up to 50 items per feed), kept in this browser only;
* or your own proxy: `ALLOWED_ORIGINS=https://lcarlini.github.io node backend/news-proxy/server.mjs` (or deploy it as a Cloudflare Worker with `npx wrangler deploy`).
  A proxy, when configured, takes priority. See `.env.example` (placeholders only).

## AI summaries (optional, off by default)

Settings offers **Anthropic** (your own API key) or **Ollama** (a running local server). Summaries are generated only when you press a button on a story,
show that they are AI-generated, list the headlines/excerpts they were based on, and say when the input was only headlines.
* The API key is kept **for the session only** unless you opt in to remembering it. Browser storage is readable by any script on the page, so use a key with a low spending limit. Keys are never exported or logged.
* Anthropic summaries send headlines and short excerpts to Anthropic; you must confirm this first. Ollama stays on your machine, but the browser can only call it if Ollama allows the site's origin (`OLLAMA_ORIGINS`).

## Your data

Everything is stored in this browser (`localStorage`, keys start with `calendra.`). Nothing syncs between devices. Settings has export, validated import and reset; exports never include API keys or caches.

## Tests

```bash
node --test tests/*.test.mjs                      # 188 unit tests, no dependencies (Node 18+)

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
