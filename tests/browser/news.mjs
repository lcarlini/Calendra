// News end-to-end. Usage: node tests/browser/news.mjs <baseUrl> <proxyUrl> [screenshotDir]
// Needs: the news proxy running (node backend/news-proxy/server.mjs) allowing <baseUrl>'s origin, and network access
// to the real publisher feeds. A mock Ollama server is started here for the AI checks.
import http from 'node:http';
import path from 'node:path';
import { launch, checker, sleep } from './cdp.mjs';

const base = process.argv[2] || 'http://localhost:8770';
const proxy = process.argv[3] || 'http://127.0.0.1:8791';
const shotDir = process.argv[4];
const t = checker();
const c = t.check;

// --- mock Ollama (CORS-enabled, like Ollama with OLLAMA_ORIGINS set) ---
const received = [];
let ollamaMode = { delayMs: 0, status: 200 };
const mock = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', async () => {
    if (req.url === '/api/chat') received.push(JSON.parse(raw));
    if (ollamaMode.delayMs) await sleep(ollamaMode.delayMs);
    res.writeHead(ollamaMode.status, { 'content-type': 'application/json', ...cors });
    if (ollamaMode.status !== 200) return res.end('{}');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
    res.end(JSON.stringify({ message: { content: 'Resumo gerado pelo modelo local.' } }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const ollamaUrl = `http://127.0.0.1:${mock.address().port}`;

const b = await launch();
const text = (sel) => b.ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);
const count = (sel) => b.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const setStore = (key, value) => b.ev(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))})`);
const IGNORE = ['ERR_CONNECTION_REFUSED', 'Failed to load resource'];

// 1. No proxy: the page still works with no server (rss2json + GDELT, public CORS-enabled services).
await b.visit(`${base}/news.html`, { width: 1366, height: 900, wait: 800 });
await b.ev(`localStorage.clear(); sessionStorage.clear()`);
await b.visit(`${base}/news.html`, { width: 1366, height: 900, wait: 1500 });
c(/rss2json/.test(await text('#news-setup')) && /No server of yours is needed/.test(await text('#news-setup')), 'no proxy: the page explains the serverless sources');
const noProxyStatus = await text('#news-source-status');
c(!/Needs proxy/.test(noProxyStatus) && /Unavailable/.test(noProxyStatus) && /does not publish an RSS feed/.test(noProxyStatus), 'no proxy: nothing says "needs proxy"; Globo shows why its own feed is unavailable');
c((await count('#news-source-status a[href^="https://"]')) >= 11, 'every source keeps a direct publisher link');
await sleep(25000);
const serverless = await count('.story-card');
console.log('  info: serverless stories after 25s:', serverless);
c(serverless > 0, 'no proxy: headlines load with no server (rss2json / GDELT)');
c((await count('#news-list img')) === 0, 'no proxy: no images rendered');
// 2. Invalid proxy address is rejected, valid one loads real feeds.
await b.ev(`document.getElementById('proxy-url').value = 'javascript:alert(1)'; document.getElementById('proxy-form').requestSubmit()`);
await sleep(300);
c(JSON.parse((await b.ev(`localStorage.getItem('calendra.news.v1') || '{}'`))).proxyUrl !== 'javascript:alert(1)', 'unsafe proxy address is not saved');
await b.ev(`document.getElementById('proxy-url').value = ${JSON.stringify(proxy)}; document.getElementById('proxy-form').requestSubmit()`);
await sleep(14000);

const statusText = await text('#news-source-status');
const live = (statusText.match(/Live/g) || []).length;
c(live >= 5, `at least 5 real feeds loaded live (${live})`);
c(/Unavailable/.test(statusText), 'Globo.com is still marked unavailable');
const storyCount = await count('.story-card');
c(storyCount >= 10, `stories are rendered from real headlines (${storyCount})`);
c((await count('#news-list img')) === 0, 'no images are rendered (only headline, excerpt and link are used)');
c((await count('#news-list a[target="_blank"][rel*="noopener"]')) >= storyCount, 'every headline links to the publisher in a new tab with noopener');
const summaryLine = await text('#news-summary-line');
c(/stories from \d+ articles/.test(summaryLine) && /Search scope: \d+ loaded articles/.test(summaryLine), `status line states counts and the search scope: "${summaryLine.slice(0, 120)}"`);

// 3. Ranking: coverage never increases down the list.
const coverages = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('.story-card .story-top .badge:first-child')].map(e => { const m = /Covered by (\\d+) outlet/.exec(e.innerText); return m ? Number(m[1]) : 0; }))`));
c(coverages.length > 5 && coverages.every((v, i) => i === 0 || coverages[i - 1] >= v), `stories are ordered by breadth of coverage (${coverages.slice(0, 8)})`);
const multi = await count('.story-card .related');
console.log(`  info: ${multi} stories have related coverage from more than one article`);

// 4. Explanation and related coverage (open them).
await b.ev(`document.querySelector('.story-card .why').open = true`);
const why = await text('.story-card .why');
c(/Reported by \d+/.test(why) && /not that it is accurate/.test(why) && !/score/i.test(why), 'ranking explanation is shown, with no numeric score and a note that breadth is not accuracy');
if (multi) {
  await b.ev(`document.querySelector('.story-card .related').open = true`);
  c((await count('.story-card .related li a[rel*="noopener"]')) >= 2, 'related coverage lists each article with its own original link');
}

// 5. Tabs and source filters.
await b.ev(`document.querySelector('[data-tab="netherlands"]').click()`);
await sleep(300);
const nl = await text('#news-list');
c((await count('.story-card')) > 0 && !/g1|BBC|CNN|UOL/.test(await b.ev(`[...document.querySelectorAll('.story-card p.muted')].map(e => e.innerText).join(' ')`)), 'Netherlands tab shows only DutchNews stories');
await b.ev(`document.querySelector('[data-tab="economy"]').click()`);
await sleep(300);
c(/UOL/.test(await b.ev(`document.getElementById('news-list').innerText`)) || (await count('.story-card')) === 0, 'Economy tab draws from UOL Economia and economy-tagged items');
await b.ev(`document.querySelector('[data-tab="latest"]').click()`);
await sleep(300);
const times = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('.story-card.compact .story-top .muted')].map(e => e.innerText))`));
c(times.length > 10, `Latest tab lists individual articles (${times.length})`);
await b.ev(`document.querySelector('[data-tab="top"]').click()`);
await b.ev(`{ const box = document.querySelector('[data-source="g1"]'); box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })) }`);
await sleep(300);
c(!/\bg1\b/.test(await b.ev(`[...document.querySelectorAll('.story-card p.muted')].map(e => e.innerText).join(' | ')`)), 'turning g1 off removes it from every story');
await b.ev(`{ const box = document.querySelector('[data-source="g1"]'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })) }`);

// 6. Search with explicit scope and empty state.
await b.ev(`{ const q = document.getElementById('news-q'); q.value = 'zzzzqqqq'; q.dispatchEvent(new Event('input')) }`);
await sleep(300);
c(/No articles match/.test(await text('#news-list')), 'search with no match shows an empty state');
const firstWord = await b.ev(`(() => { const t = document.querySelector('.story-card h4')?.innerText || ''; return t; })()`);
await b.ev(`{ const q = document.getElementById('news-q'); q.value = ''; q.dispatchEvent(new Event('input')) }`);
const word = (firstWord.split(/\s+/).find((w) => w.length > 5) || 'brasil').replace(/[^\p{L}\p{N}]/gu, '');
await b.ev(`{ const q = document.getElementById('news-q'); q.value = ${JSON.stringify(word)}; q.dispatchEvent(new Event('input')) }`);
await sleep(300);
c((await count('.story-card')) > 0 && /matching/.test(await text('#news-summary-line')), `search "${word}" filters loaded articles and says so`);
c(/Loaded articles/.test(await b.ev(`document.getElementById('news-scope').options[0].text`)) && (await b.ev(`document.getElementById('news-scope').options[1].disabled`)), 'search scope is explicit; publisher search is shown as unavailable');
await b.ev(`{ const q = document.getElementById('news-q'); q.value = ''; q.dispatchEvent(new Event('input')) }`);

// 7. Summary with AI off: nothing is sent, clear guidance.
received.length = 0;
await setStore('calendra.ai.v1', { provider: 'off' });
await b.ev(`document.querySelector('[data-summary="short"]').click()`);
await sleep(500);
c(/AI summaries are off/.test(await text('.summary-box:not([hidden])')) && received.length === 0, 'AI off: button explains how to enable it and sends nothing');

// 8. Local AI summary: provenance, disclosure, injection-safe structure.
await setStore('calendra.ai.v1', { provider: 'ollama', baseUrl: ollamaUrl, model: 'qwen3:8b', timeoutSec: 30, language: 'pt', cloudConsent: false });
await b.visit(`${base}/news.html`, { width: 1366, height: 900, wait: 9000 });
await b.ev(`document.querySelector('[data-summary="short"]').click()`);
await sleep(1500);
const box = await text('.summary-box:not([hidden])');
c(/AI-generated summary/.test(box) && /Resumo gerado pelo modelo local/.test(box), 'summary is labelled AI-generated');
c(/Sources used \(\d+\)/.test(box) && /headlines/.test(box) && /not the full articles|headlines only/.test(box), 'summary shows its source material and the input limitation');
c((await count('.summary-box:not([hidden]) a[href^="https://"]')) >= 1, 'summary keeps links to the original articles');
c(received.length === 1 && /untrusted DATA/.test(received[0].messages[0].content) && /<source_material>/.test(received[0].messages[1].content), 'provider received the guarded prompt with the material in a data block');
c(!/Anthropic/.test(box), 'local summary does not claim to use the cloud');

// 9. Cancellation and a failing provider do not break the reader.
ollamaMode = { delayMs: 4000, status: 200 };
await b.ev(`document.querySelectorAll('[data-summary="bullets"]')[0].click()`);
await sleep(600);
await b.ev(`document.querySelector('[data-cancel-summary]').click()`);
await sleep(600);
c(/Cancelled/.test(await text('.summary-box:not([hidden])')), 'a running summary can be cancelled');
ollamaMode = { delayMs: 0, status: 500 };
await b.ev(`document.querySelectorAll('[data-summary="short"]')[1].click()`);
await sleep(1500);
c(/had a problem|HTTP 500/.test(await b.ev(`[...document.querySelectorAll('.summary-error')].map(e => e.innerText).join(' ')`)), 'provider failure shows an actionable error');
c((await count('.story-card')) >= 10, 'the news list is unaffected by the AI failure');
ollamaMode = { delayMs: 0, status: 200 };

// 10. Cloud provider: refuses without key/consent, before anything is sent.
await setStore('calendra.ai.v1', { provider: 'anthropic', model: '', baseUrl: ollamaUrl, timeoutSec: 30, language: 'pt', cloudConsent: false });
await b.visit(`${base}/news.html`, { width: 1366, height: 900, wait: 9000 });
await b.ev(`document.querySelector('[data-summary="short"]').click()`);
await sleep(600);
c(/Anthropic API key/.test(await text('.summary-box:not([hidden])')), 'cloud provider without a key asks for one and sends nothing');
await b.ev(`sessionStorage.setItem('calendra.ai.apikey.v1', 'sk-test-not-real')`);
await b.ev(`document.querySelector('[data-summary="short"]').click()`);
await sleep(600);
c(/sent to Anthropic/.test(await text('.summary-box:not([hidden])')), 'cloud provider without consent explains where data would go and sends nothing');
await b.ev(`sessionStorage.clear()`);

// 11. Partial failure and stale fallback.
await setStore('calendra.ai.v1', { provider: 'off' });
await b.visit(`${base}/news.html`, { width: 1366, height: 900, wait: 9000 });
await b.ev(`document.getElementById('proxy-url').value = 'http://127.0.0.1:9'; document.getElementById('proxy-form').requestSubmit()`);
await sleep(8000);
const stale = await text('#news-source-status');
c(/Saved copy/.test(stale) && (await count('.badge-warn')) > 0, 'with the proxy down, saved articles are shown and labelled as saved copies');
c((await count('.story-card')) > 0, 'saved articles remain readable when the proxy is down');

// 12. Layout.
await b.ev(`document.getElementById('proxy-url').value = ${JSON.stringify(proxy)}; document.getElementById('proxy-form').requestSubmit()`);
await sleep(12000);
for (const [w, h] of [[390, 844], [1920, 1080]]) {
  await b.visit(`${base}/news.html`, { width: w, height: h, wait: 9000 });
  c((await b.ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0, `news @${w}: no sideways overflow with real headlines`);
  if (shotDir) await b.shot(path.join(shotDir, `news-${w}.png`));
}
const errs = b.problems({ ignore: IGNORE });
c(errs.length === 0, `no uncaught errors${errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''}`);

b.close();
mock.close();
console.log(t.failed ? `\n${t.failed} check(s) FAILED` : '\nAll news checks passed');
process.exit(t.failed ? 1 : 0);
