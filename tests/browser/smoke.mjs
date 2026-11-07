// Real-browser smoke test (Chrome DevTools Protocol). Usage: node tests/browser/smoke.mjs <baseUrl>
// Needs Chrome; set CHROME_PATH if it is not in the default Windows location.
// Usage: node cdp-test.mjs <baseUrl>
import { spawn } from 'node:child_process';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333;
const profile = (process.env.TEMP || '/tmp') + '/cdp-prof-' + Date.now();

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools not reachable');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
let events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) events.push(msg);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

async function visit(url, { width = 1366, height = 768, wait = 4000 } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  events = [];
  await send('Page.navigate', { url });
  await sleep(wait);
  const problems = [];
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      problems.push('EXCEPTION ' + (d.exception?.description || d.text).split('\n')[0]);
    }
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      problems.push('console.error ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    }
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      problems.push('LOG ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
    }
    if (e.method === 'Network.loadingFailed' && !e.params.canceled) {
      problems.push('NET-FAILED ' + e.params.errorText);
    }
    if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) {
      problems.push(`HTTP ${e.params.response.status} ${e.params.response.url}`);
    }
  }
  const info = (await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyChildren: document.body.children.length,
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
    })`,
  })).result.result.value;
  return { problems: [...new Set(problems)], ...JSON.parse(info) };
}

const pages = ['index.html', 'dashboard.html', 'calendario.html', 'news.html', 'markets.html', 'deals.html', 'settings.html'];
const results = [];
for (const p of pages) {
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    const r = await visit(`${base}/${p}`, { width: w, height: h });
    results.push({ page: p, w, ...r });
    console.log(`${p} @${w}: overflow=${r.overflow}px problems=${r.problems.length}`);
    for (const pr of r.problems) console.log('   -', pr);
  }
}

// Follow every link on the home page and confirm it lands on the right page.
const home = await visit(`${base}/index.html`);
const internal = [...new Set(home.links.filter((l) => l.endsWith('.html')))];
console.log('\nHome links:', internal.join(', '));
for (const l of internal) {
  const r = await visit(`${base}/${l}`, { wait: 2500 });
  console.log(`  ${l} -> ${r.url.replace(base, '')} "${r.title}" problems=${r.problems.length}`);
}

// Legacy redirect.
const legacy = await visit(`${base}/calendar.html?date=2026-09-07`, { wait: 3000 });
console.log('\nlegacy calendar.html ->', legacy.url.replace(base, ''));

ws.close();
chrome.kill();
process.exit(0);
