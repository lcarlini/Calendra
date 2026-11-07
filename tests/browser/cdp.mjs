// Minimal Chrome DevTools Protocol helper shared by the browser tests.
// Needs Chrome; set CHROME_PATH if it is not in the default Windows location.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_CODES = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Tab: 9, Enter: 13 };

export async function launch({ port = 9340 + Math.floor(Math.random() * 400) } = {}) {
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const profile = path.join(os.tmpdir(), `calendra-cdp-${Date.now()}-${port}`);
  const chrome = spawn(
    chromePath,
    ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
    { stdio: 'ignore' }
  );
  let target;
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      /* not ready yet */
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Chrome DevTools not reachable');
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
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  for (const m of ['Runtime.enable', 'Log.enable', 'Page.enable', 'Network.enable']) await send(m);
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  const api = {
    send,
    async visit(url, { width = 1366, height = 768, wait = 3000 } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
      events = [];
      await send('Page.navigate', { url });
      await sleep(wait);
    },
    problems({ ignore = [] } = {}) {
      const out = [];
      for (const e of events) {
        if (e.method === 'Runtime.exceptionThrown') {
          const d = e.params.exceptionDetails;
          out.push('EXCEPTION ' + (d.exception?.description || d.text).split('\n')[0]);
        }
        if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
          out.push('console.error ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
        }
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
          out.push('LOG ' + e.params.entry.text.slice(0, 160) + ' ' + (e.params.entry.url || '').slice(0, 100));
        }
      }
      return [...new Set(out)].filter((p) => !ignore.some((i) => p.includes(i)));
    },
    async ev(expression) {
      const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression });
      if (r.result.exceptionDetails) {
        throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation failed');
      }
      return r.result.result.value;
    },
    async shot(file) {
      const jpeg = /\.jpe?g$/i.test(file);
      const r = await send('Page.captureScreenshot', jpeg ? { format: 'jpeg', quality: 70 } : { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    },
    async key(key) {
      const code = KEY_CODES[key] || 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      chrome.kill();
    },
  };
  return api;
}

export function checker() {
  let failed = 0;
  return {
    check(ok, what) {
      console.log((ok ? 'PASS ' : 'FAIL ') + what);
      if (!ok) failed += 1;
    },
    get failed() {
      return failed;
    },
  };
}
