export const THEMES = [
  { id: 'mist', label: 'Mist', mode: 'light' },
  { id: 'midnight', label: 'Midnight', mode: 'dark' },
  { id: 'ocean', label: 'Ocean', mode: 'dark' },
  { id: 'sand', label: 'Sand', mode: 'light' },
  { id: 'ink', label: 'Ink', mode: 'dark' },
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
