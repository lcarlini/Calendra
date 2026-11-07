import { initTheme } from './themes.js';

initTheme();

// Fallback only: opens a Google search for the query in a new tab.
// Results are not fetched or shown inside Calendra.
const form = document.getElementById('deal-search');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const q = document.getElementById('deal-q')?.value.trim();
  if (!q) return;
  const url = `https://www.google.com/search?q=${encodeURIComponent(`${q} preço`)}`;
  window.open(url, '_blank', 'noopener');
});
