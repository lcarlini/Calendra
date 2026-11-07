/**
 * Display preferences shared by every page: TV mode (larger type, stronger
 * focus, fewer controls), fullscreen, and arrow-key focus movement for remotes.
 * TV mode is opt-in. A 1920x1080 viewport is never assumed to be a television.
 */
import { onStoreChange, readJSON, writeJSON } from './store.js';

export const DISPLAY_KEY = 'calendra.display.v1';

export function getDisplay() {
  const saved = readJSON(DISPLAY_KEY, null);
  return { tv: Boolean(saved && saved.tv) };
}

export function applyDisplay(root = globalThis.document?.documentElement) {
  if (!root) return getDisplay();
  const display = getDisplay();
  root.dataset.tv = display.tv ? 'on' : 'off';
  return display;
}

export function setTvMode(on) {
  writeJSON(DISPLAY_KEY, { ...getDisplay(), tv: Boolean(on) });
  return applyDisplay();
}

export async function toggleFullscreen(doc = globalThis.document) {
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen();
    else await doc.documentElement.requestFullscreen();
    return true;
  } catch {
    return false; // not supported or blocked: the caller shows nothing misleading
  }
}

/**
 * Pick the focusable rect closest in `direction` ('left'|'right'|'up'|'down')
 * from rects[currentIndex]. Pure, so it can be unit-tested.
 * Candidates must lie in the half-plane of the direction; the nearest centre wins,
 * with misalignment on the other axis weighted double.
 */
export function pickNextFocus(rects, currentIndex, direction) {
  const cur = rects[currentIndex];
  if (!cur) return -1;
  const cx = cur.left + cur.width / 2;
  const cy = cur.top + cur.height / 2;
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    if (i === currentIndex) return;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const inDirection =
      (direction === 'right' && dx > 1) ||
      (direction === 'left' && dx < -1) ||
      (direction === 'down' && dy > 1) ||
      (direction === 'up' && dy < -1);
    if (!inDirection) return;
    const along = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]):not(#theme-quick), [tabindex]:not([tabindex="-1"])';
const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function installDirectionalFocus(doc) {
  doc.addEventListener('keydown', (event) => {
    if (doc.documentElement.dataset.tv !== 'on') return;
    const direction = ARROWS[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = doc.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return; // keep text/select editing
    const items = [...doc.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const index = items.indexOf(active);
    if (index < 0) {
      items[0]?.focus();
      event.preventDefault();
      return;
    }
    const rects = items.map((el) => el.getBoundingClientRect());
    const next = pickNextFocus(rects, index, direction);
    if (next >= 0) {
      items[next].focus();
      event.preventDefault();
    }
  });
}

/** Wire display preferences into a page. Safe to call once per page. */
export function initDisplay(doc = globalThis.document) {
  if (!doc) return;
  applyDisplay(doc.documentElement);
  installDirectionalFocus(doc);
  onStoreChange([DISPLAY_KEY], () => applyDisplay(doc.documentElement));
  doc.querySelectorAll('[data-tv-toggle]').forEach((btn) => {
    const sync = () => btn.setAttribute('aria-pressed', String(getDisplay().tv));
    sync();
    btn.addEventListener('click', () => {
      setTvMode(!getDisplay().tv);
      sync();
    });
  });
  doc.querySelectorAll('[data-fullscreen-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleFullscreen(doc));
  });
}
