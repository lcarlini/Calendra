import { THEMES, applyTheme, getTheme, initTheme } from './themes.js';
import { HOLIDAY_CATEGORY_DEFAULTS } from './holidays.js';

initTheme();

const select = document.getElementById('theme-select');
if (select) {
  select.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('');
  select.value = getTheme();
  select.addEventListener('change', () => applyTheme(select.value));
}

const HOLIDAY_KEY = 'calendra.holidays.v1';
document.getElementById('reset-holiday-prefs')?.addEventListener('click', () => {
  if (!window.confirm('Restore the default holiday visibility? Reminders are not changed.')) return;
  try {
    localStorage.setItem(HOLIDAY_KEY, JSON.stringify({ ...HOLIDAY_CATEGORY_DEFAULTS }));
  } catch {
    /* storage unavailable: nothing to reset */
  }
  window.alert('Holiday visibility restored to defaults.');
});
