const KEY = 'calendra.layout.v5';
const LEGACY_KEYS = ['calendra.layout.v1', 'calendra.layout.v2', 'calendra.layout.v3', 'calendra.layout.v4'];

export const SIZES = [
  { id: 'sm', label: 'S', className: 'g-sm' },
  { id: 'md', label: 'M', className: 'g-md' },
  { id: 'lg', label: 'L', className: 'g-lg' },
  { id: 'xl', label: 'XL', className: 'g-xl' },
  { id: 'full', label: 'Full', className: 'g-full' },
];

const SIZE_CLASS = new Set(SIZES.map((s) => s.className));

/** Default: clocks | markets | calendar | weather */
export function defaultLayout() {
  return [
    { id: 'clocks', size: 'sm' },
    { id: 'markets', size: 'sm' },
    { id: 'calendar', size: 'sm' },
    { id: 'weather', size: 'sm' },
    { id: 'reminders', size: 'xl' },
    { id: 'quick', size: 'sm' },
    { id: 'hubs', size: 'sm' },
  ];
}

function clearLegacyLayouts() {
  try {
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function isValidLayout(parsed) {
  if (!Array.isArray(parsed) || !parsed.length) return false;
  const ids = new Set(parsed.map((i) => i.id));
  // Old dashboards never had markets / used full-width clocks
  if (!ids.has('markets')) return false;
  const clocks = parsed.find((i) => i.id === 'clocks');
  if (clocks && clocks.size === 'full') return false;
  return true;
}

export function loadLayout() {
  clearLegacyLayouts();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw);
    if (!isValidLayout(parsed)) {
      localStorage.removeItem(KEY);
      return defaultLayout();
    }
    return parsed;
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout) {
  localStorage.setItem(KEY, JSON.stringify(layout));
}

function applySizeClass(el, sizeId) {
  const size = SIZES.find((s) => s.id === sizeId) || SIZES[0];
  [...el.classList].forEach((c) => {
    if (SIZE_CLASS.has(c)) el.classList.remove(c);
  });
  el.classList.add(size.className);
  el.dataset.size = size.id;
}

export function initLayoutEditor(gridSelector = '#gadget-grid') {
  const grid = document.querySelector(gridSelector);
  if (!grid) return { setEditMode() {} };

  clearLegacyLayouts();

  const gadgets = [...grid.querySelectorAll('[data-gadget]')];
  let layout = loadLayout();
  const byId = Object.fromEntries(gadgets.map((g) => [g.dataset.gadget, g]));

  // Always place in default order first, then apply saved sizes when valid
  const orderIds = layout.map((i) => i.id);
  defaultLayout().forEach((item) => {
    if (!orderIds.includes(item.id)) {
      layout.push(item);
      orderIds.push(item.id);
    }
  });

  layout.forEach((item) => {
    const el = byId[item.id];
    if (!el) return;
    applySizeClass(el, item.size);
    grid.appendChild(el);
  });

  gadgets.forEach((el) => {
    if (!layout.find((l) => l.id === el.dataset.gadget)) {
      applySizeClass(el, el.dataset.size || 'sm');
      grid.appendChild(el);
      layout.push({ id: el.dataset.gadget, size: el.dataset.size || 'sm' });
    }
  });

  // Persist canonical default if we had to repair
  if (!localStorage.getItem(KEY) || !isValidLayout(JSON.parse(localStorage.getItem(KEY) || '[]'))) {
    saveLayout(
      [...grid.querySelectorAll('[data-gadget]')].map((el) => ({
        id: el.dataset.gadget,
        size: el.dataset.size || 'sm',
      }))
    );
  }

  function persist() {
    const order = [...grid.querySelectorAll('[data-gadget]')].map((el) => ({
      id: el.dataset.gadget,
      size: el.dataset.size || 'md',
    }));
    layout = order;
    saveLayout(order);
  }

  function wireChrome(el) {
    let chrome = el.querySelector('.gadget-chrome');
    if (!chrome) {
      chrome = document.createElement('div');
      chrome.className = 'gadget-chrome';
      chrome.innerHTML = `
        <button type="button" class="drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</button>
        <div class="size-pills" role="group" aria-label="Gadget size">
          ${SIZES.map(
            (s) =>
              `<button type="button" class="size-pill ${el.dataset.size === s.id ? 'active' : ''}" data-size="${s.id}" title="${s.label}">${s.label}</button>`
          ).join('')}
        </div>
      `;
      el.insertBefore(chrome, el.firstChild);
    }

    chrome.querySelectorAll('.size-pill').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applySizeClass(el, btn.dataset.size);
        chrome.querySelectorAll('.size-pill').forEach((b) => b.classList.toggle('active', b === btn));
        persist();
      });
    });

    const handle = chrome.querySelector('.drag-handle');
    handle.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.dataset.gadget);
    });
    handle.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      grid.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
      persist();
    });
  }

  gadgets.forEach(wireChrome);

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = grid.querySelector('.dragging');
    if (!dragging) return;
    const after = getDragAfterElement(grid, e.clientY, e.clientX);
    grid.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    if (after == null) {
      grid.appendChild(dragging);
    } else if (after !== dragging) {
      after.classList.add('drag-over');
      grid.insertBefore(dragging, after);
    }
  });

  function setEditMode(on) {
    grid.classList.toggle('edit-mode', on);
    document.body.classList.toggle('layout-editing', on);
  }

  return {
    setEditMode,
    reset() {
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
      saveLayout(defaultLayout());
      location.reload();
    },
    persist,
  };
}

function getDragAfterElement(container, y, x) {
  const els = [...container.querySelectorAll('[data-gadget]:not(.dragging)')];
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dist = (x - cx) ** 2 + (y - cy) ** 2;
    if (y < box.bottom && x < box.right) {
      if (dist < bestDist) {
        bestDist = dist;
        best = child;
      }
    }
  }
  if (best) return best;
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}
