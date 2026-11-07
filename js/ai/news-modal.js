/** The "AI" modal on a news story: gets the article text, asks the configured AI for bullet topics, shows them. */
import { esc } from '../core/format.js';
import { getApiKey, loadAiSettings } from './settings.js';
import { AiError, sendsToCloud, summarizeArticle } from './providers.js';
import { getArticleText } from './article-text.js';
import { describeError } from './summary-ui.js';

/** Bullet lines -> list. Everything is escaped first; only **bold** is turned back into markup. */
export function bulletsHtml(text) {
  const inline = (line) => esc(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const items = [];
  const paras = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) items.push(`<li>${inline(m[1])}</li>`);
    else paras.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`);
  }
  return `${paras.join('')}${items.length ? `<ul>${items.join('')}</ul>` : ''}`;
}

let current = null;

function closeModal() {
  current?.controller.abort();
  current?.dialog.close?.();
  current?.dialog.remove();
  current = null;
}

export async function openNewsAi(article, { fetchImpl = globalThis.fetch } = {}) {
  if (current) closeModal();
  const dialog = document.createElement('dialog');
  dialog.className = 'ai-modal';
  dialog.setAttribute('aria-labelledby', 'ai-modal-title');
  dialog.innerHTML = `
    <div class="ai-modal-card">
      <header class="ai-modal-head">
        <span class="ai-spark" aria-hidden="true">✨</span>
        <div>
          <p class="ai-modal-kicker">Resumo por IA</p>
          <h3 id="ai-modal-title">${esc(article.title)}</h3>
          <p class="muted">${esc(article.sourceName || '')} · <a href="${esc(article.originalUrl)}" target="_blank" rel="noopener noreferrer">Abrir original</a></p>
        </div>
        <button type="button" class="ai-close" data-ai-close aria-label="Fechar">×</button>
      </header>
      <div class="ai-modal-body" aria-live="polite"></div>
      <footer class="ai-modal-foot">
        <span class="ai-meta"></span>
        <span class="ai-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-ai-copy hidden>Copiar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-ai-again hidden>Gerar de novo</button>
          <button type="button" class="btn btn-primary btn-sm" data-ai-close>Fechar</button>
        </span>
      </footer>
    </div>`;
  document.body.appendChild(dialog);
  const body = dialog.querySelector('.ai-modal-body');
  const meta = dialog.querySelector('.ai-meta');
  const copyBtn = dialog.querySelector('[data-ai-copy]');
  const againBtn = dialog.querySelector('[data-ai-again]');
  const controller = new AbortController();
  current = { dialog, controller };
  let lastText = '';
  let fetched = null;

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-ai-close]')) closeModal();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeModal();
  });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastText);
      copyBtn.textContent = 'Copiado';
    } catch {
      copyBtn.textContent = 'Nao foi possivel copiar';
    }
  });

  const step = (label) => {
    body.innerHTML = `<div class="ai-loading" role="status"><span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(label)}</span></div><div class="ai-skeleton" aria-hidden="true"><b></b><b></b><b></b></div>`;
  };

  async function run({ fresh = false } = {}) {
    const settings = loadAiSettings();
    copyBtn.hidden = true;
    againBtn.hidden = true;
    copyBtn.textContent = 'Copiar';
    if (settings.provider === 'off') {
      body.innerHTML = '<p class="status-line">A IA esta desligada. <a href="settings.html">Escolha um provedor nas Configuracoes</a>.</p>';
      return;
    }
    const where = sendsToCloud(settings) ? 'Claude Haiku 5.5 (esforco baixo)' : `${settings.model || 'Ollama'} (local)`;
    meta.textContent = '';
    try {
      if (!fetched) {
        step('Lendo o texto da noticia…');
        fetched = await getArticleText(article, { fetchImpl, signal: controller.signal });
      }
      step(`Resumindo com ${where}…`);
      const result = await summarizeArticle({ settings, apiKey: getApiKey(), article, text: fetched.text, level: fetched.level, fresh, signal: controller.signal, fetchImpl });
      lastText = result.text;
      const note = fetched.level === 'full' ? '' : `<p class="ai-note" role="note">${esc(fetched.note)}</p>`;
      body.innerHTML = `${note}<div class="ai-bullets">${bulletsHtml(result.text)}</div>`;
      meta.textContent = `${sendsToCloud(settings) ? 'Enviado a Anthropic' : 'Processado localmente'} · ${result.meta.model}${result.meta.cached ? ' · resultado salvo' : ''} · pode conter erros`;
      copyBtn.hidden = false;
      againBtn.hidden = false;
    } catch (error) {
      if (error?.code === 'cancelled' || controller.signal.aborted) return;
      body.innerHTML = `<p class="status-line summary-error" role="alert">${error instanceof AiError ? describeError(error) : esc(error?.message || 'Algo deu errado.')}</p>`;
      againBtn.hidden = false;
    }
  }
  againBtn.addEventListener('click', () => run({ fresh: true }));

  dialog.showModal();
  dialog.querySelector('[data-ai-close]').focus();
  await run();
}
