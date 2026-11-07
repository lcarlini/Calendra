// Loaded by every page that has no module of its own: theme + display preferences.
import { initThemeEverywhere } from '../themes.js';
import { initDisplay } from './display.js';

initThemeEverywhere();
initDisplay();
