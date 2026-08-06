export function toast(message, detail = '') {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }

  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${message}${detail ? `<small>${detail}</small>` : ''}`;
  host.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = '0.3s ease';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

let activeModal = null;

/**
 * Open a modal. Returns { close, setBody, el }.
 * @param {{ title: string, subtitle?: string, bodyHtml?: string, wide?: boolean, xl?: boolean, onClose?: () => void }} opts
 */
export function openModal({ title, subtitle = '', bodyHtml = '', wide = false, xl = false, onClose } = {}) {
  closeModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const sizeClass = xl ? 'modal-xl' : wide ? 'modal-wide' : '';
  backdrop.innerHTML = `
    <div class="modal ${sizeClass}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head">
        <div>
          <h3>${title}</h3>
          ${subtitle ? `<p class="modal-sub">${subtitle}</p>` : ''}
        </div>
        <button type="button" class="btn-icon modal-close" aria-label="Fechar">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;

  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 280);
    if (activeModal === api) activeModal = null;
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('.modal-close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const api = {
    close,
    el: backdrop,
    setBody(html) {
      const body = backdrop.querySelector('.modal-body');
      if (body) body.innerHTML = html;
    },
  };
  activeModal = api;
  return api;
}

export function closeModal() {
  if (activeModal) activeModal.close();
}
