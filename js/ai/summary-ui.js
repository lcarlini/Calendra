/** Shared rendering for AI summaries (News and Deals). Everything shown is escaped. */
import { esc } from '../core/format.js';
import { AiError } from './providers.js';

export function describeError(error) {
  if (error instanceof AiError) {
    const hint = ['disabled', 'no-key', 'no-consent', 'auth'].includes(error.code) ? ' <a href="settings.html">Open Settings</a>.' : '';
    return `${esc(error.message)}${hint}`;
  }
  return esc(error?.message || 'Something went wrong.');
}

/** An AI summary with its label, limits and sources. Never implies the full article was read. */
export function summaryHtml({ text, meta }) {
  const levelNote =
    meta.inputLevel === 'headline-only'
      ? 'Based on headlines only: this is not a summary of the full articles.'
      : meta.inputLevel === 'excerpt-only'
        ? 'Based on headlines and the short excerpts the feeds provide, not the full articles.'
        : 'Based on headlines and, where the feeds provide them, short excerpts, not the full articles.';
  return `<div class="summary-result">
    <p class="badge badge-warn">AI-generated summary</p>
    <div class="summary-text">${esc(text)}</div>
    <p class="status-line">${esc(levelNote)}${meta.truncated ? ' Some input was shortened to stay within limits.' : ''} Made by ${esc(meta.provider === 'anthropic' ? `Anthropic ${meta.model}` : `${meta.model} via Ollama`)} in ${esc(meta.language === 'pt' ? 'Portuguese' : 'English')}${meta.cached ? ' (saved result)' : ''}. It can contain mistakes: check the originals.</p>
    <details open><summary>Sources used (${meta.sources.length})</summary>
      <ul>${meta.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> <span class="muted">· ${esc(s.outlet)} · ${esc(s.availability)}</span></li>`).join('')}</ul>
    </details></div>`;
}
