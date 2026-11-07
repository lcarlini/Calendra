// The "AI" modal on a news story, with fetch stubbed (no real key, article site or AI service is used).
// Usage: node tests/browser/ai-modal.mjs <baseUrl> [screenshotDir]
import path from 'node:path';
import { launch, checker } from './cdp.mjs';

const base = process.argv[2] || 'https://lcarlini.github.io/Calendra';
const shotDir = process.argv[3];
const t = checker();
const c = t.check;
const b = await launch();

for (const [w, h] of [[390, 844], [1280, 800]]) {
  await b.visit(`${base}/news.html`, { width: w, height: h, wait: 1500 });
  const r = JSON.parse(await b.ev(`(async () => {
    Object.keys(localStorage).filter((k) => k.includes('summaries')).forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('calendra.ai.v1', JSON.stringify({ provider: 'anthropic', cloudConsent: true }));
    sessionStorage.setItem('calendra.ai.apikey.v1', 'sk-test');
    const { openNewsAi } = await import('./js/ai/news-modal.js');
    const calls = [];
    const long = 'Texto da materia. '.repeat(60);
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      if (String(url).startsWith('https://r.jina.ai/')) return { ok: true, status: 200, text: async () => 'Title: x\\nMarkdown Content:\\n' + long };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ content: [{ type: 'text', text: '- Primeiro topico **forte**\\n- Segundo topico <img src=x onerror=alert(1)>' }] }) };
    };
    await openNewsAi({ id: 'a1', title: 'Titulo de teste', sourceName: 'G1', originalUrl: 'https://example.com/n', excerpt: 'trecho' }, { fetchImpl });
    const d = document.querySelector('dialog.ai-modal');
    const card = d.querySelector('.ai-modal-card').getBoundingClientRect();
    const out = { open: d.open, items: d.querySelectorAll('.ai-bullets li').length, strong: d.querySelectorAll('.ai-bullets strong').length, injected: d.querySelectorAll('.ai-bullets img').length, urls: calls.map((x) => x.url), body: calls[1] && calls[1].body, left: Math.round(card.left), right: Math.round(card.right), top: Math.round(card.top), bottom: Math.round(card.bottom), vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    localStorage.removeItem('calendra.ai.v1'); sessionStorage.removeItem('calendra.ai.apikey.v1');
    return JSON.stringify(out);
  })()`));
  c(r.open && r.items === 2 && r.strong === 1 && r.injected === 0, `AI modal @${w}: shows escaped bullet topics ${JSON.stringify({ items: r.items, strong: r.strong, injected: r.injected })}`);
  c(r.urls[0] === 'https://r.jina.ai/https://example.com/n' && r.urls[1] === 'https://api.anthropic.com/v1/messages', `AI modal @${w}: reads the article text, then calls Anthropic`);
  c(r.body && r.body.model === 'claude-haiku-5-5' && r.body.output_config.effort === 'low' && /^Resuma essa noticia em topicos/.test(r.body.messages[0].content) && r.body.messages[0].content.includes('Texto da materia'), `AI modal @${w}: Haiku 5.5, effort low, the requested prompt, article text included`);
  c(r.left >= 0 && r.right <= r.vw && r.top >= 0 && r.bottom <= r.vh && r.over <= 0, `AI modal @${w}: fits the screen ${JSON.stringify({ l: r.left, r: r.right, t: r.top, b: r.bottom })}`);
  if (shotDir) await b.shot(path.join(shotDir, `news-ai-modal-${w}.png`));
}


b.close();
console.log(t.failed ? `${t.failed} check(s) FAILED` : 'All AI modal checks passed');
process.exit(t.failed ? 1 : 0);
