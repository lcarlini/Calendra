/** Tiny SVG chart helpers. Pure functions: they only draw points they are given. */

/** Normalised polyline points for a sparkline; returns '' when there is not enough real data. */
export function sparklinePoints(values, width = 120, height = 32, pad = 2) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return '';
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = (width - pad * 2) / (clean.length - 1);
  return clean
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
}

/** Inline SVG sparkline with a text alternative. Empty string when there are fewer than 2 points. */
export function sparklineSvg(values, { width = 120, height = 32, label = 'Price history' } = {}) {
  const points = sparklinePoints(values, width, height);
  if (!points) return '';
  const first = values.find(Number.isFinite);
  const last = [...values].reverse().find(Number.isFinite);
  const up = last >= first;
  return `<svg class="sparkline ${up ? 'up' : 'down'}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}: ${up ? 'up' : 'down'} over the period"><polyline fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${points}"/></svg>`;
}
