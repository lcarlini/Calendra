/**
 * Image viewer for the News page: a full-screen dialog with the publisher's image, its credit, a link to the
 * original article, and previous/next across the images currently on screen (arrows, swipe, buttons).
 */
import { esc } from '../core/format.js';

let dialog = null;
let items = [];
let index = 0;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'img-viewer';
  dialog.setAttribute('aria-label', 'Image viewer');
  dialog.innerHTML = `
    <div class="img-viewer-stage">
      <button type="button" class="img-viewer-nav prev" data-iv="prev" aria-label="Previous image">‹</button>
      <figure class="img-viewer-figure">
        <div class="img-viewer-frame"><img alt="" decoding="async" /></div>
        <figcaption class="img-viewer-caption"></figcaption>
      </figure>
      <button type="button" class="img-viewer-nav next" data-iv="next" aria-label="Next image">›</button>
      <button type="button" class="img-viewer-close" data-iv="close" aria-label="Close">×</button>
      <span class="img-viewer-count" aria-live="polite"></span>
    </div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('click', (e) => {
    const act = e.target.closest('[data-iv]')?.dataset.iv;
    if (act === 'prev') show(index - 1);
    else if (act === 'next') show(index + 1);
    else if (act === 'close' || e.target === dialog || e.target.classList.contains('img-viewer-stage')) dialog.close();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  let startX = null;
  dialog.addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
  dialog.addEventListener('close', () => document.documentElement.classList.remove('viewer-open'));
  const img = dialog.querySelector('img');
  img.addEventListener('load', () => dialog.querySelector('.img-viewer-frame').classList.remove('loading'));
  img.addEventListener('error', () => {
    const frame = dialog.querySelector('.img-viewer-frame');
    frame.classList.remove('loading');
    frame.classList.add('broken');
  });
  return dialog;
}

function show(i) {
  if (!items.length) return;
  index = (i + items.length) % items.length;
  const it = items[index];
  const d = ensureDialog();
  const frame = d.querySelector('.img-viewer-frame');
  frame.classList.remove('broken');
  frame.classList.add('loading');
  const img = d.querySelector('img');
  img.src = it.src;
  img.alt = it.title;
  d.querySelector('.img-viewer-caption').innerHTML = `
    <strong>${esc(it.title)}</strong>
    <span class="muted">Image: ${esc(it.source)}${it.when ? ` · ${esc(it.when)}` : ''}</span>
    <a class="btn btn-primary btn-sm" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">Open the article ↗</a>`;
  d.querySelector('.img-viewer-count').textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
  d.querySelectorAll('.img-viewer-nav').forEach((b) => (b.hidden = items.length < 2));
}

/** @param {Array<{src:string,title:string,source:string,url:string,when?:string}>} list */
export function openImageViewer(list, start = 0) {
  const valid = list.map((x, i) => [x, i]).filter(([x]) => x?.src);
  items = valid.map(([x]) => x);
  if (!items.length) return;
  const d = ensureDialog();
  show(Math.max(0, valid.findIndex(([, i]) => i === start)));
  if (!d.open) d.showModal();
  document.documentElement.classList.add('viewer-open');
  d.querySelector('[data-iv="close"]').focus();
}
