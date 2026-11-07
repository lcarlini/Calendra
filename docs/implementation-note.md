# Calendra personal portal: implementation note and completion report

Written 2026-11-07. It records what was inspected, what was built, what was tested and, just as important, what is **not**
done or not verified.

## 1. Discovery

### What was actually inspected
| Reference | Inspected? | Notes |
|---|---|---|
| Repository (HTML, JS, CSS, README) | Yes | Static HTML/CSS/vanilla ES modules, GitHub Pages from `main` (root), `.nojekyll`. No backend, no build step. |
| `UI/Calendar.html` | Yes, read fully | Specialized 2026 calendar: categories **GCM**, **Brasil**, **Davi**. |
| `UI/Holidays.png` | Yes, viewed | "GCM Grosvenor United States Holiday Schedule" for 2025, 2026, 2027 with `*` marking observed dates. |
| `UI/*.png` (5 screenshots) | Yes, viewed | Two GCM internal-tool mockups (dark navy, left icon rail, stat tiles, stepper), an Appearance panel (theme/accent/density/contrast/motion), a Text-size panel (90–150 %, autoscale), and the existing Calendra dashboard. |
| `C:\git\FinanceOps` | Partly | Read the AI layer (`app/backend/services/ai.py`) and grepped the rest. Not read end to end. |

### Current architecture (before this work)
`index.html` was the dashboard (clocks, markets, compact calendar, weather, reminders); `calendar.html` the full calendar. Shared
modules: `holidays.js` (US + Brazil rules, Easter-based movable dates), `reminders.js`/`storage.js` (reminders),
`calendar.js` (renderers), `themes.js`, `clocks.js`, `markets.js`, `weather.js`, `layout.js` (drag/resize gadgets).

### Existing local-storage keys (preserved)
`calendra.theme.v1`, `calendra.reminders.v1`, `calendra.holidays.v1` (now extended, old values still load),
`calendra.calView.v1`, `calendra.clocks.v1`, `calendra.layout.v1..v4` (the dashboard has always deleted the legacy layout keys on load).

### Findings from the specialized calendar
* Categories: **GCM** (US holiday list, matches `Holidays.png` for 2026), **Brasil** (13 Brazilian dates), **Davi** (25 dates).
* Colors in the source: GCM blue, Brasil orange, Davi green, plus combination colors for overlaps.
* The Davi list is explicitly "no events on Saturday/Sunday". Its labels (*Início das aulas*, *Recesso*, *Término do 1º semestre*) look like a school
  calendar, but the file does not say so; the app keeps the label **Davi** and claims no meaning.
* **No recurrence rule, rotation or anchor date exists in the files.** Brasil and Davi are therefore provided for **2026 only**; GCM
  for 2025–2027 (from the image). Nothing is extrapolated.
* Four trailing Davi "Recesso" rows were appended after the main block in the source; they are marked `needs-review`.
* Unresolved: what GCM and Davi stand for; whether the Davi dates will repeat in other years.

### Findings from FinanceOps (patterns reused)
Provider switch `off | claude | ollama`; Anthropic key from environment or settings; Ollama default `http://127.0.0.1:11434`, default model
`qwen3:8b`; model listing from Ollama; a cheap connection test; friendly errors for bad key / rate limit / network / missing model;
result cache keyed by content + model. **Differences:** Calendra is static, so requests come from the browser, the key is typed by the user
and kept for the session only unless they opt in, and there is no server-side token budget.

### Deployment constraints
GitHub Pages serves the **`main` branch**, static files only. Anything needing secrets or server-side fetching needs a companion service.

## 2. What was built

| Area | Delivered |
|---|---|
| **Portal** | `index.html` with five cards (Calendar, Calendário, News, Markets, Deals), shared nav and Home links on every page, theme kept across pages, legacy `calendar.html` redirects (query string kept). |
| **Calendar dashboard** | Clock-first layout: three clocks per row on wide screens (default Brazil, New York, Amsterdam; saved choices win), compact calendar high on the page with the market cards beside it, weather below, policy-rate strip. Photos fail gracefully. TV mode, fullscreen button, arrow-key focus movement. |
| **Calendário** | Opens on a year view modelled on `UI/Calendar.html` (12 full-size months, D/B/G badges with combo colours, tooltip, jump-to-month, legend, keyboard access). Same holiday/reminder modules as the dashboard; GCM / Brasil / Davi toggles; equal weekday columns at every width; overflow "+N holidays"; `?date=` carry-over; cross-tab refresh. **Travel & Holiday Intelligence**: 2026–2030, long weekends, bridge days, extended breaks, transparent labels, year map, filters/sort, per-break and whole-year `.ics`, copy summary, reminder through the existing alert store. |
| **News** | Works from static files, no server: each outlet's own RSS feed through rss2json.com (CORS-enabled, 10 items per feed; g1 also Economia/Política/Mundo) plus one GDELT index query set (up to 250 headlines per query, UTF-8, covers Globo.com too). Results appear as each source arrives; a throttled feed does not hide the rest. Dedupe, conservative clustering, coverage counting (UOL + UOL Economia = 1, g1 sections = 1), explainable ranking, tabs, source/date filters, search with an explicit scope, partial-failure and stale states. The optional proxy or an rss2json key gives more items. |
| **Proxy** | `backend/news-proxy`: allowlist-only (feeds by id, no URL parameter), origin allowlist (default deny), redirect/size/time limits, per-client rate limit, cache, charset decoding. Runs as a Cloudflare Worker or `node server.mjs`. |
| **AI** | Off / Anthropic (your key) / Ollama (local). Settings, connection test, session-only key by default, consent for cloud, on-demand short / bullet / cluster summaries with provenance, input limits, cache, cancel, actionable errors. |
| **Markets** | Policy rates (Selic target, Fed target range, EFFR, ECB deposit/MRO/MLF) with type, source, effective date, fetch time, stale labels; BCB end-of-day USD/EUR; editable B3 watchlist with real history, adjusted returns, sparklines. US stocks/ETFs/indices honestly unavailable. |
| **Deals** | Finding only (nothing to register): 14-source registry with honest status; Adrenaline Ofertas through rss2json (patient retry on 429, optional key, 24 h saved copy) or the proxy; filters, saved/hidden threads; a coupon finder (codes posted in the community threads plus Google searches on Cuponomia, Méliuz, Promobit, Pelando, Cupom Válido); Google search fallbacks. Manual product tracking, coupons and alerts were removed. |
| **Settings** | Theme (also a quick picker in every page header), accent, density, contrast, motion and text size (modelled on the UI folder's Appearance and Text-size panels), TV mode, AI configuration, export/import (validated, never includes keys), reset actions with confirmation. |

## 3. Tests run (all passing at the time of writing)

| Suite | Result |
|---|---|
| Unit (`node --test tests/*.test.mjs`) | **188 / 188** |
| Layout, 9 viewports × 7 pages + Full HD clocks + phone + TV + Calendário columns | **79 / 79** |
| Travel section (real browser) | 19 / 19 |
| Markets (real public APIs) | 25 / 25 |
| News (real feeds through the proxy, mock Ollama) | 37 / 37 (also 37 / 37 on the live site with the "local network access" permission simulated) |
| Deals (real feed, real BCB rate) | 43 / 43 (also 43 / 43 on the live site, same condition) |
| Keyboard and landmarks | 18 / 18 |
| Interaction (date link, columns, phone overflow) | 5 / 5 |

Notable defects the tests found and that were fixed: `?date=` ignored; uneven weekday columns (Saturday 43 px wide); the BCB `ultimos/N`
request rejected (cap of 20) and returning future-dated rows; sideways overflow from hidden screen-reader text and long `<option>` text;
broken city photos; TV-mode digits clipped at 4K.

## 4. External services

* Public, keyless APIs used from the browser: Banco Central do Brasil (SGS), ECB Data Portal, NY Fed Reference Rates, brapi.dev, Open-Meteo (existing), UOL/other quote sources (existing).
* The news proxy is **not deployed anywhere by this project**. Until you run or deploy it, News and the Deals feed show their setup state.

## 5. Not done, or not verified (read this)

* **Recurrence engine, recurring user events, timezone-sensitive timed events, event editing**: not implemented (the plan's "recurrence exceptions" and "timed events" tests therefore do not exist). User events are still the original reminders.
* **Calendar overlays on the month grid for travel items** (the plan's overlay toggles) and a "travel demand" score: not built. Labels use only days-off versus leave days.
* **Markets:** no US stocks/ETFs/indices, no company or ETF profiles, no currency conversion across watchlists, no non-adjusted chart toggle. Only 4 B3 tickers work without a key (PETR4, VALE3, ITUB4, MGLU3); the plan's BBDC4 and WEGE3 show "needs token".
* **News:** needs the proxy; RSS only exposes the newest items (no archive search); no embeddings; cross-language clustering deliberately off; publisher terms of use were **not** reviewed.
* **Deals:** only one live source. No automatic price checking, no product matching by GTIN/MPN, no multi-listing comparison view, no "latest eight pages" (the feed has no pages). Hardmob, Pelando, Gatry, Méliuz, Buscapé, Zoom, PCPartPicker, Amazon, Shopee, AliExpress, Mercado Livre, Google Shopping are links only, with reasons.
* **AI:** Anthropic was tested only against a mock server (no real key was available), and Ollama only against a mock (no local server was running). The default model id `claude-haiku-5-5` was not confirmed against the live API. Prompt-injection resistance is tested **structurally** (data block, sanitising, system rules); model behaviour cannot be unit-tested.
* **Design:** the Appearance and Text-size panels in `UI/` are reproduced in Settings (accent, density, contrast, motion, text size); a **Black** theme (pure black) was added next to the six existing themes.
* **News without a server depends on two public services** (rss2json.com and gdeltproject.org). Both rate-limit: rss2json throttled several feeds after heavy repeated testing and GDELT asks for one request per 5 seconds. UOL's feeds are ISO-8859-1 and rss2json garbles their accents; garbled copies are replaced by GDELT's UTF-8 copy when it has one, otherwise the headline is kept and the excerpt dropped. The wide, rarely-throttled path is your own proxy or an rss2json key.
* Tested in Chrome (headless) only; not Firefox or Safari, and not on real TV hardware. Dashboard drag/resize ("Organizar") with the new row layout was not exercised.
* Cross-device sync does not exist; "synchronization" is same-browser, same-origin only (storage events).

## 6. Remaining manual setup
1. News and the Deals feed work without any setup. For more headlines (and to avoid third-party rate limits): get a free rss2json key, or run `ALLOWED_ORIGINS=https://lcarlini.github.io node backend/news-proxy/server.mjs` (or deploy the Worker) and paste its address on the News page. Chrome asks the user to allow "local network access" before an https page may call a local server (the proxy answers the Private Network Access preflight, but only the user can grant the permission, and a headless browser cannot be asked). Deploy the proxy over https for everyday use.
2. For AI summaries: choose a provider in Settings; for Ollama start it with `OLLAMA_ORIGINS` including the site's origin.
3. Merge to `main` to publish (GitHub Pages serves `main`).

## Deals feed notes (2026-11-07)
* The forum feed is readable by `curl` but has **no CORS header**, and generic CORS relays (allorigins, codetabs, yacdn) cannot read it (they get the bot challenge or HTTP 522), so they are not used. Pelando and Hardmob answer 403 with a challenge, Gatry and Promobit have no feed.
* The only serverless route is rss2json.com, which throttles bursts per address (HTTP 429, "converting new feeds in a very short period"). Mitigations: patient retry, one automatic retry after a minute, a 24 h saved copy, and an optional free rss2json key (field on the Deals page, shared with News).
* **Primary route since 2026-11-07: a site snapshot.** `.github/workflows/snapshot-feeds.yml` fetches the RSS every 30 minutes
  (plain `curl`, which the forum answers) and commits it to `data/deals-adrenaline-ofertas.xml` plus a `.updated` time stamp. The page
  reads it from the same origin (no CORS, no rate limit). A snapshot older than 3 hours is refreshed through rss2json when possible,
  and is still shown if rss2json is throttled. (The forum answers 403 to GitHub's runners, so the job falls back to rss2json there.)
* Manual test guide: [manual-test-guide.md](manual-test-guide.md).

## Price watch (2026-11-07)
* `.github/workflows/snapshot-prices.yml` runs `scripts/snapshot-prices.mjs` every 3 hours for the products in
  `data/prices/watchlist.json` and commits `data/prices/latest.json` (offers, community deals, per-source status) and
  `data/prices/history.json` (one lowest price per product per day). The page only reads those files.
* Pages read (robots.txt checked 2026-11-07; search pages that it disallows are never read, and a Buscapé path that resolves
  to a search is refused by the parser): Buscapé and Zoom product/category pages (offers + their own 40-day price history),
  Pelando `/busca/<term>`, Promobit `/promocoes/recentes/`, Gatry `/promocoes/?q=`, Hardmob's Promoções list, and the Adrenaline feed.
  One request per host every 1.5 s, user agent `CalendraPriceCheck/1.0` with the site's address.
* Observed results: from GitHub's runners Buscapé, Zoom, Promobit, Gatry and Adrenaline answer; **Pelando answers 403 to cloud
  servers** (it works from a home connection; the last good results are kept and dated) and **Hardmob answers 403 to an honestly
  identified client** from anywhere. Neither is bypassed. Amazon, Mercado Livre, Magalu, Kabum, Shopee and AliExpress refuse direct
  automated requests, so their prices appear through the merchant offers Buscapé and Zoom list.
* Running `node scripts/snapshot-prices.mjs` from a home connection and committing the result refreshes Pelando too.
* Simulation (`js/deals/price-sim.js`): 2026 is the base (real daily lows where recorded); every other day is
  reference × category trend × the Brazilian retail calendar of that year (Black Friday = last Friday of November, Prime Day,
  Dia do Consumidor, Dia das Mães/Pais, Semana do Brasil, 11.11, Natal). 2027 and 2028 are projections with a widening band.

## News images (2026-11-07)
* Cards show the image each publisher puts in its own feed (media:content / media:thumbnail / enclosure / first `<img>`), loaded
  from the publisher with `referrerpolicy="no-referrer"`, credited with the outlet's name and linked to the article. Nothing is
  copied or stored. Known thumbnail addresses are swapped for the publisher's larger size (UOL, BBC, CNN Brasil, DutchNews).
