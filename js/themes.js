export const THEMES = [
  { id: 'mist', label: 'Mist', mode: 'light' },
  { id: 'midnight', label: 'Midnight', mode: 'dark' },
  { id: 'ocean', label: 'Ocean', mode: 'dark' },
  { id: 'sand', label: 'Sand', mode: 'light' },
  { id: 'ink', label: 'Ink', mode: 'dark' },
  { id: 'black', label: 'Black', mode: 'dark' },
  { id: 'aurora', label: 'Aurora', mode: 'dark' },
];

const KEY = 'calendra.theme.v1';

export function getTheme() {
  return localStorage.getItem(KEY) || 'ink';
}

export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.mode = theme.mode;
  localStorage.setItem(KEY, theme.id);
  return theme;
}

export function initTheme() {
  return applyTheme(getTheme());
}

// ---- Appearance (modelled on the UI folder's "Appearance" and "Text size" panels) -----------------
export const ACCENTS = [
  { id: 'default', label: 'Theme', color: '' },
  { id: 'blue', label: 'Blue', color: '#3b82f6' },
  { id: 'teal', label: 'Teal', color: '#14b8a6' },
  { id: 'purple', label: 'Purple', color: '#a855f7' },
  { id: 'orange', label: 'Orange', color: '#f59e0b' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
];
export const TEXT_SIZES = [90, 100, 115, 130, 150];
export const TEXT_MIN = 80;
export const TEXT_MAX = 200;
export const TEXT_STEP = 5;

/** Autoscale: nudges the text size with the screen so phones and TVs both stay readable. */
export function autoscaleFactor(width) {
  if (!Number.isFinite(width)) return 1;
  if (width < 340) return 0.92;
  if (width >= 3400) return 1.5;
  if (width >= 2560) return 1.25;
  if (width >= 1920) return 1.1;
  return 1;
}
const APPEARANCE_KEY = 'calendra.appearance.v1';
const APPEARANCE_DEFAULTS = { accent: 'default', density: 'comfortable', contrast: 'standard', motion: 'on', textSize: 100, autoscale: 'on' };

export function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
    const a = { ...APPEARANCE_DEFAULTS };
    if (ACCENTS.some((x) => x.id === saved.accent)) a.accent = saved.accent;
    if (['comfortable', 'compact'].includes(saved.density)) a.density = saved.density;
    if (['standard', 'more'].includes(saved.contrast)) a.contrast = saved.contrast;
    if (['on', 'off'].includes(saved.motion)) a.motion = saved.motion;
    if (Number.isFinite(saved.textSize)) a.textSize = Math.min(TEXT_MAX, Math.max(TEXT_MIN, Math.round(saved.textSize)));
    if (['on', 'off'].includes(saved.autoscale)) a.autoscale = saved.autoscale;
    return a;
  } catch {
    return { ...APPEARANCE_DEFAULTS };
  }
}

export function applyAppearance(a = loadAppearance()) {
  const root = document.documentElement;
  const accent = ACCENTS.find((x) => x.id === a.accent);
  if (accent?.color) {
    root.style.setProperty('--accent', accent.color);
    root.style.setProperty('--accent-bright', accent.color);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-bright');
  }
  root.dataset.density = a.density;
  root.dataset.contrast = a.contrast;
  root.dataset.motion = a.motion;
  root.dataset.autoscale = a.autoscale;
  const pct = Math.round(a.textSize * (a.autoscale === 'on' && typeof window !== 'undefined' ? autoscaleFactor(window.innerWidth) : 1));
  root.style.fontSize = pct === 100 ? '' : `${pct}%`;
  return a;
}

export function saveAppearance(patch) {
  const next = { ...loadAppearance(), ...patch };
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the choice still applies for this page */
  }
  window.dispatchEvent(new CustomEvent('calendra:appearance'));
  return applyAppearance(next);
}

/** Every page: apply the saved theme + appearance, and make sure there is a theme picker in the header. */
export function initThemeEverywhere() {
  const theme = initTheme();
  applyAppearance();
  window.addEventListener('resize', () => applyAppearance());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) applyTheme(e.newValue || 'ink');
    if (e.key === APPEARANCE_KEY) applyAppearance();
  });
  const mount = () => {
    if (document.getElementById('theme-select') || document.getElementById('theme-quick')) return;
    const tools = document.querySelector('.topbar-tools');
    if (!tools) return;
    const wrap = document.createElement('label');
    wrap.className = 'theme-quick';
    wrap.innerHTML = '<span>Theme</span>';
    const select = document.createElement('select');
    select.id = 'theme-quick';
    select.setAttribute('aria-label', 'Color theme');
    select.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
    select.value = getTheme();
    select.addEventListener('change', () => applyTheme(select.value));
    wrap.appendChild(select);
    tools.prepend(wrap);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  return theme;
}
