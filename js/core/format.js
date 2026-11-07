/** Shared formatting helpers. Pure functions, safe in Node and the browser. */

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Money with an explicit currency. Returns '—' for missing or non-finite values (never 0). */
export function formatMoney(value, currency = 'BRL', locale = 'pt-BR') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
}

export function formatPercent(value, digits = 2, locale = 'en-US') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatWhen(iso, locale) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "18 minutes ago", "2 hours ago", "3 days ago"; '—' if the date is missing or invalid. */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const seconds = Math.round((now - t) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const units = [
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** Trigger a browser download of text content. */
export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
