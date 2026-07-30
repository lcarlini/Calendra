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
