/**
 * Get the readable text of a news article from the browser, with no server of ours.
 *
 * Publishers do not allow cross-origin reads of their pages, so the text comes through the public
 * reader r.jina.ai (CORS enabled, returns the article as plain text). Only the article's PUBLIC address is
 * sent to it. If it is unreachable or returns too little, the headline and feed excerpt are used instead
 * and the result says so ("level"), so a summary of a headline is never presented as a summary of the article.
 */
export const READER = 'https://r.jina.ai/';
const MIN_ARTICLE_CHARS = 400;

/** Reader output -> plain text: drop its metadata header, images, link targets and markdown noise. */
export function cleanReaderText(raw) {
  let text = String(raw || '');
  const marker = text.indexOf('Markdown Content:');
  if (marker >= 0) text = text.slice(marker + 'Markdown Content:'.length);
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @returns {Promise<{ text: string, level: 'full'|'excerpt'|'headline', note: string }>}
 */
export async function getArticleText(article, { fetchImpl = globalThis.fetch, signal, timeoutMs = 20_000 } = {}) {
  const fallback = () => {
    const excerpt = String(article.excerpt || '').trim();
    return excerpt
      ? { text: excerpt, level: 'excerpt', note: 'Could not open the full article, so only the headline and the short excerpt from the feed were used.' }
      : { text: '', level: 'headline', note: 'Could not open the full article, so only the headline was used.' };
  };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(READER + article.originalUrl, { signal: controller.signal });
    if (!res.ok) return fallback();
    const text = cleanReaderText(await res.text());
    if (text.length < MIN_ARTICLE_CHARS) return fallback();
    return { text, level: 'full', note: 'Full article text.' };
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
    return fallback();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
