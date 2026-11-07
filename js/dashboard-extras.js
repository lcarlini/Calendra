// Dashboard additions: display preferences and the policy-rates strip (shared data layer).
import { initDisplay } from './core/display.js';
import { mountRates } from './markets/rates-ui.js';

initDisplay();
mountRates(document.getElementById('rates-grid'), {
  refreshButton: document.getElementById('rates-refresh'),
});
