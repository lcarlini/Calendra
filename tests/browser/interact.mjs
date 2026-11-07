// Real-browser interaction test (Chrome DevTools Protocol). Writes screenshots to the current directory.
// Usage: node tests/browser/interact.mjs <baseUrl>. Set CHROME_PATH if Chrome is not in the default Windows location.
// Real-browser smoke test over the Chrome DevTools Protocol.
// Usage: node cdp-test.mjs <baseUrl>
import { spawn } from 'node:child_process';
import fs from 'node:fs';

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


const ev = async (expr) => (await send("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: expr })).result.result.value;
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(name, Buffer.from(r.result.data, "base64"));
};

await visit(base + "/dashboard.html", { width: 1920, height: 1080, wait: 9000 });
await shot("dash-1920.png");
console.log("DASH text sample:", (await ev("document.body.innerText.replace(/\s+/g,\" \").slice(0,900)")));
console.log("clock cards:", await ev("document.querySelectorAll(\"[class*=clock]\").length"));

// click a day in the compact calendar, check the Open Calendário link
const href = await ev(`(() => { const c=[...document.querySelectorAll(".day-cell[data-date]")].find(x=>x.dataset.date.endsWith("-15")); if(!c) return "no day cell"; c.click(); const a=[...document.querySelectorAll("a[href^=calendario]")].map(a=>a.getAttribute("href")); return c.dataset.date+" -> "+a.join(", "); })()`);
console.log("mini-cal click:", href);

// theme switch persists
const theme = await ev(`(() => { const sel=document.querySelector("#theme-select"); if(!sel) return "no select"; sel.value="mist"; sel.dispatchEvent(new Event("change")); return localStorage.getItem("calendra.theme.v1")+" "+document.documentElement.dataset.theme; })()`);
console.log("theme:", theme);
await visit(base + "/index.html", { wait: 2000 });
console.log("theme on home after switch:", await ev("document.documentElement.dataset.theme"));

// Calendario: date param, toggles, add reminder
await visit(base + "/calendario.html?date=2026-09-07", { width: 1366, height: 900, wait: 4000 });
console.log("selected label:", await ev("document.querySelector(\"#selected-day-label\")?.textContent"));
console.log("title:", await ev("document.querySelector(\"#cal-title\")?.textContent"));
const toggles = await ev(`(() => { const ids=["holiday-us","holiday-br","holiday-gcm","holiday-brref","holiday-davi"]; return ids.map(i=>i+"="+document.getElementById(i)?.checked).join(" "); })()`);
console.log("toggles:", toggles);
const before = await ev("document.querySelectorAll(\".holiday-pill\").length");
await ev("document.getElementById(\"holiday-davi\").click()");
await sleep(500);
const after = await ev("document.querySelectorAll(\".holiday-pill\").length");
console.log("pills before/after toggling Davi:", before, after);
await shot("cal-1366.png");
for (const v of ["year","week","day","month"]) {
  await ev(`document.querySelector("[data-view=${v}]").click()`);
  await sleep(400);
  console.log("view", v, "ok:", await ev("document.querySelector(\"#full-calendar\").innerHTML.length>200"), "overflow:", await ev("document.documentElement.scrollWidth-innerWidth"));
}
await visit(base + "/calendario.html?date=2026-09-07", { width: 390, height: 844, wait: 3000 });
await shot("cal-390.png");
console.log("phone overflow:", await ev("document.documentElement.scrollWidth-innerWidth"));

// ---- assertions: any failure makes the process exit non-zero ----
let failed = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) failed += 1; };
await visit(base + "/calendario.html?date=2026-09-07", { width: 1366, height: 900, wait: 3500 });
check((await ev("document.querySelector(\"#selected-day-label\")?.textContent")).includes("September 7"), "?date=2026-09-07 selects 7 September");
check((await ev("document.querySelector(\"#cal-title\")?.textContent")) === "September 2026", "?date=2026-09-07 opens September 2026");
const widths = await ev("JSON.stringify([...document.querySelectorAll(\".full-cal-days > .full-day\")].slice(0,7).map(c => Math.round(c.getBoundingClientRect().width)))");
const w = JSON.parse(widths);
check(w.length === 7 && Math.max(...w) - Math.min(...w) <= 1, "seven equal weekday columns " + widths);
check((await ev("document.querySelectorAll(\".full-day\").length")) >= 35, "month grid has all day cells");
await visit(base + "/calendario.html?date=2026-09-07", { width: 390, height: 844, wait: 3000 });
const phone = await ev("document.documentElement.scrollWidth-innerWidth");
check(phone <= 0, "no sideways scroll at 390px");
ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);


