/**
 * Small RSS 2.0 reader (no DOM needed, so it also runs in Node tests and the proxy tests).
 * It only extracts what the news module may show: title, link, a short excerpt, date, categories.
 */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Remove tags and decode entities; collapse whitespace. Output is plain text. */
export function stripHtml(html) {
  const noTags = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First value of <tag>…</tag>, unwrapping CDATA. */
export function getTag(block, tag) {
  const re = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  const inner = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return cdata ? cdata[1] : decodeEntities(inner);
}

export function getAllTags(block, tag) {
  const re = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    const inner = m[1].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
    out.push(cdata ? cdata[1] : decodeEntities(inner));
  }
  return out;
}

const PT_MONTHS = { fev: 'feb', abr: 'apr', mai: 'may', ago: 'aug', set: 'sep', out: 'oct', dez: 'dec' };

/** RFC-822 style dates, including feeds that use Portuguese weekday/month names. ISO string or ''. */
export function parseFeedDate(text, now = Date.now()) {
  let s = String(text ?? '').trim();
  if (!s) return '';
  s = s.replace(/^[A-Za-zÀ-ÿ.]{2,10},\s*/, ''); // drop weekday ("Sáb, ", "Sat, ")
  s = s.replace(/\b([A-Za-zÀ-ÿ]{3})\b/g, (m) => PT_MONTHS[m.toLowerCase()] || m);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return '';
  if (t > now + 6 * 3600 * 1000) return ''; // far in the future: do not let it distort ranking
  return new Date(t).toISOString();
}

/** An https image address, or ''. Only addresses the publisher put in its own feed are used (hotlinked, never stored). */
export function safeImageUrl(url) {
  const u = decodeEntities(String(url ?? '').trim());
  if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return '';
  if (/\.(gif)(\?|$)/i.test(u) || /(pixel|tracking|feedburner|spacer|1x1)/i.test(u)) return '';
  return u;
}

/**
 * Feeds often announce a thumbnail. These publishers serve the same picture in larger sizes at a predictable
 * address (each rule checked on 2026-11-07), so cards and the viewer are sharp. Unknown addresses are left as they are.
 */
export function largerImage(url) {
  const u = String(url || '');
  if (!u) return '';
  return u
    .replace(/^(https:\/\/conteudo\.imguol\.com\.br\/.+_v\d+)_\d+x\d+(\.\w+)$/i, '$1_900x506$2')
    .replace(/^(https:\/\/ichef\.bbci\.co\.uk\/ace\/(?:ws|standard))\/\d+\//i, '$1/800/')
    .replace(/^(https:\/\/admin\.cnnbrasil\.com\.br\/.+\.(?:jpe?g|png|webp))\?w=\d+$/i, '$1?w=1200')
    .replace(/^(https:\/\/www\.dutchnews\.nl\/wpcms\/wp-content\/uploads\/.+)-\d+x\d+(\.(?:jpe?g|png|webp))$/i, '$1$2');
}

/** First <img src> in an HTML fragment. */
export function firstImage(html) {
  const m = String(html ?? '').match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? safeImageUrl(m[1]) : '';
}

/** The image a feed item announces: media:content / media:thumbnail / image enclosure / first <img> in the description. */
export function itemImage(block) {
  const attr = (re) => {
    const m = String(block).match(re);
    return m ? safeImageUrl(m[1]) : '';
  };
  return (
    attr(/<media:content[^>]*url=["']([^"']+)["'][^>]*(?:medium=["']image["']|type=["']image)/i) ||
    attr(/<media:content[^>]*(?:medium=["']image["']|type=["']image)[^>]*url=["']([^"']+)["']/i) ||
    attr(/<media:thumbnail[^>]*url=["']([^"']+)["']/i) ||
    attr(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i) ||
    attr(/<enclosure[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i) ||
    attr(/<media:content[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/i) ||
    firstImage(getTag(block, 'description')) ||
    firstImage(getTag(block, 'content:encoded'))
  );
}

/**
 * Parse an RSS 2.0 document into raw items (feed order is kept in `position`).
 * `excerptHtml` prefers <atom:subtitle> (used by g1), then <description>.
 */
export function parseFeed(xml, { now = Date.now() } = {}) {
  const text = String(xml ?? '');
  const blocks = text.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map((block, position) => ({
    position,
    title: stripHtml(getTag(block, 'title')),
    link: stripHtml(getTag(block, 'link')),
    guid: stripHtml(getTag(block, 'guid')),
    publishedAt: parseFeedDate(getTag(block, 'pubDate') || getTag(block, 'dc:date'), now),
    categories: getAllTags(block, 'category').map(stripHtml).filter(Boolean),
    excerptHtml: getTag(block, 'atom:subtitle') || getTag(block, 'description'),
    image: itemImage(block),
  }));
}
