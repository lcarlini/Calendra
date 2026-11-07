# Calendra manual test guide

Open the live site (https://lcarlini.github.io/Calendra/) or a local copy (`python -m http.server 8000`, then http://localhost:8000/).
Each step has an **expected** result. Tick the box when it holds. Use a normal window **and** a phone-sized window (browser dev tools, 360 x 740).

Automated checks that cover the same ground: `node --test tests/*.test.mjs` (unit) and `node tests/browser/<suite>.mjs <baseUrl>` (real Chrome:
`layout`, `deals`, `ai-modal`, `news`, `interact`, `keyboard`, `travel`, `markets`). Public services (rss2json, GDELT, Open-Meteo, BCB) rate-limit
now and then: a step marked **(live)** depends on them. If one fails, wait a minute and retry before calling it a bug.

## 0. Before you start
- [ ] Open DevTools > Application > Local Storage > clear everything for the site, reload. The site starts in the default theme (Ink) with no errors in the console.
- [ ] Turn off any extension that rewrites pages. Use a recent Chrome, Edge or Firefox.

## 1. Every page (Home, Dashboard, Calendar, Calendário, News, Markets, Deals, Settings)
- [ ] The top navigation reaches every page, and the current page is highlighted. "Back to Home" works.
- [ ] **Theme picker:** a "Theme" selector is in the header (Settings has buttons instead). It lists **Mist, Midnight, Ocean, Sand, Ink, Black, Aurora**. Pick each: colours change at once, text stays readable, dropdowns and text fields follow the theme (no white boxes on dark themes).
- [ ] **Black:** the page background is pure black, cards are near-black with thin light borders, and there are no coloured glows.
- [ ] Reload: the chosen theme stays. Open a second tab of the site, change the theme in one tab: the other tab follows without a reload.
- [ ] **Widths:** at 360, 768, 1366, 1920 and 3840 px wide there is no sideways scroll, nothing is cut off and the nav is reachable (on phones it scrolls sideways inside its own bar).
- [ ] **Keyboard:** Tab reaches every link and button in order with a visible outline. Enter and Space activate buttons.
- [ ] **No server:** every page above works from static files. Nothing asks you to start a program (only the optional proxy and Ollama do, and they say so).

## 2. Home and Dashboard
- [ ] Clocks show the right time for each city, update every second and show no photos.
- [ ] The weather gadget shows temperatures **(live)**. If Open-Meteo fails, the gadget says so instead of showing fake numbers.
- [ ] The markets gadget and the compact calendar show data and link to their full pages.
- [ ] At 1920 x 1080 three clock cards sit on one row with the time dominant and no clipped digits.
- [ ] **TV mode** (Settings > Display): text and clocks get larger, hides secondary controls, arrow keys move focus. Reload: it stays on. Turn it off: back to normal. It is never switched on by itself.
- [ ] **Fullscreen** button enters and leaves fullscreen.

## 3. Calendar and Calendário
- [ ] **Calendário opens on the year view** with 12 full months and seven equal weekday columns (Saturday is not narrower).
- [ ] Holiday badges: letters D/B/G/U with their own colours. Overlaps use combined colours. Davi never appears on weekends.
- [ ] Hover or focus a day: a tooltip lists its holidays. Click a day opens its detail.
- [ ] "Ir para" jumps to the chosen month. "Mês atual" returns to now. The legend explains the colours.
- [ ] Switch **Month, Week, Day** views: each shows the right dates, previous/next work.
- [ ] Holiday category toggles show and hide categories. Settings > Data > "Restore the default holiday visibility" resets them.
- [ ] **Reminders:** add one, see it on its date, edit and delete it. Reload: it stays.
- [ ] **Time off planning:** long weekends and bridge days are suggested for the year. **.ics export** downloads a file that opens in a calendar app.

## 4. News
- [ ] Headlines appear progressively **(live)** as each source answers. The source list shows Live, Saved copy, Error, Unavailable or Loading for each one with a reason.
- [ ] No sample or fake headlines are ever shown. If nothing loads you get an explanation and a Refresh button.
- [ ] Tabs (Top, Latest, topics), the date filter, the search box and source toggles narrow the list. The summary line states counts and the search scope.
- [ ] Stories covered by several outlets show "Covered by N outlets", related coverage and a "Why this story is highlighted" explanation. Every headline opens the original in a new tab.
- [ ] **Optional: get more headlines:** saving an rss2json key or proxy address reloads the list. A bad proxy address (for example `javascript:...`) is rejected.
- [ ] **✨ AI button** (on every story): opens a modal with the headline and a link to the original.
  - [ ] With the default Ollama running: it reads the article text, then shows bullet topics. Footer says "Processado localmente".
  - [ ] Without Ollama running: a clear error with "Open Settings", not a blank modal.
  - [ ] If the article cannot be opened, an amber note says only the headline/excerpt was used.
  - [ ] **Copiar** copies the bullets. **Gerar de novo** asks again. **Fechar**, the X, the Escape key and a click on the dark backdrop all close it.
  - [ ] On a phone the modal is a bottom sheet that fits the screen.
  - [ ] With AI turned off in Settings: the modal says AI is off and links to Settings. Nothing is sent.
- [ ] Short summary, Bullets and Summarize coverage buttons show an "AI-generated" label, the sources used and the input limit, and can be cancelled.

## 5. Markets
- [ ] Quotes and exchange rates load **(live)** with their source and time. A failing source shows an error for that row only.
- [ ] Watchlist add and remove work and persist after a reload.

## 6. Deals (finding only: nothing to register)
- [ ] The page has **no** forms to add products, prices, coupons or alerts. Sections: Search, Community feed, Find coupons, Sources.
- [ ] **Search:** type "ssd 1tb" and press Search. The community feed matches appear **(live)**, then 13 store cards, each with "Open search on Google" (a prefilled `site:` query), "Copy search query" and "Open site". The text says these are links, not live results.
- [ ] Helper chips: Price history, Coupon, US price open Google searches in a new tab.
- [ ] "Save this search" puts a starred chip in the recent searches. It survives a reload and can be removed with ×.
- [ ] **Community feed (live):**
  - [ ] Threads load with the status "Updated … · source: Adrenaline Ofertas RSS feed · via rss2json.com".
  - [ ] Every thread says "Community-reported", links to the original forum thread, shows no images, and shows a price only when the title states one ("not verified").
  - [ ] Filters work: words, leave out, min/max price, age, saved only, show hidden. Save, Hide and Copy link work. Summarize follows the AI setting.
  - [ ] **When the converter is throttled:** the message reads "Live refresh is throttled or unreachable right now (…)" and, if you opened the page before, the saved copy stays on screen. It retries once after a minute. ↻ retries on demand. It never shows a bare "HTTP 429".
  - [ ] Opening "Feed throttled? Add a free rss2json key" and saving a key reloads the feed and the key shows up in News too.
- [ ] **Find coupons:**
  - [ ] Eight store chips (Amazon, Mercado Livre, Shopee, AliExpress, Kabum, Magalu, Pichau, Terabyte). Clicking one narrows the results.
  - [ ] Codes people posted in the community threads appear as copyable pills marked "Community-reported · unverified" with a link to the thread.
  - [ ] With no match: "No coupon thread among the N newest ones…" and the searches below still work.
  - [ ] "Search coupon sites" offers a Google search plus Cuponomia, Méliuz, Promobit, Pelando and Cupom Válido, described as searches and not results.
- [ ] **Sources and what they allow** lists 1 feed and 13 unavailable sources, each with its real reason and a link.

## 7. Settings
- [ ] **Appearance:** Theme buttons (7 themes), Accent swatches, Density (Comfortable/Compact), Contrast (Standard/More), Motion (On/Off) all apply at once and stay after a reload.
- [ ] **Text size:** − and + move in 5% steps between 80% and 200% (the buttons disable at the ends). Presets 90/100/115/130/150 work. The big percentage matches.
- [ ] **Autoscale On:** text grows a little on very large screens and shrinks slightly on very small ones. **Off:** the size is exactly what you chose.
- [ ] **Display:** TV mode and Fullscreen buttons work (see section 2).
- [ ] **AI summaries:**
  - [ ] The default provider is **Ollama (local endpoint)** at http://127.0.0.1:11434. "Test connection" reports connected or says exactly what is wrong (not running, `OLLAMA_ORIGINS`, model not installed).
  - [ ] Choose **Anthropic**: the model field disappears and the page says Claude Haiku 5.5 at the lowest effort. Paste a key, tick or untick "Remember the key in this browser", Save. "Test connection" answers with the model and effort.
  - [ ] Reload: the key is remembered (placeholder says a key is set) if you ticked remember, and forgotten after closing the tab if you did not.
  - [ ] "Remove configuration" asks to confirm, then clears the key and settings.
- [ ] **Your data:** Export downloads a JSON file with no API keys. Import shows a preview and rejects invalid files with reasons. "Reset all" asks to confirm and deletes everything for the site.

## 8. Edge cases
- [ ] Offline (DevTools > Network > Offline): pages still open. News and Deals show saved copies or explained errors, never a crash.
- [ ] Block `api.rss2json.com` in DevTools: News falls back to GDELT headlines, Deals shows the saved copy with an explanation.
- [ ] Private window or blocked storage: pages still render (settings just do not persist).
- [ ] Browser zoom 200% and a 320 px wide window: no clipped controls, no horizontal scroll.
- [ ] Console stays free of uncaught errors on every page (network errors from rate-limited services are expected and handled).

Record failures with the page, the step number, what you expected and what happened (screenshots help).
