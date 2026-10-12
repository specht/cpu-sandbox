// Small DOM helpers, the same as in the Sorting Sandbox.

export const $ = id => document.getElementById(id);

/** Creates an element: el('button', {class: 'x', onclick: fn}, 'text', child). */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
/** A Tabler icon from the local sprite. */
export function icon(name, className = '') {
  const node = document.createElementNS(SVG, 'svg');
  node.setAttribute('class', `ui-icon ${className}`.trim());
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `/vendor/tabler-icons.svg#ti-${name}`);
  node.append(use);
  return node;
}

export const grouped = value => Number(value).toLocaleString('en-US');

/** 1500 → "1.5 kHz", 4000000 → "4 MHz" */
export function formatHz(hz) {
  if (hz >= 1e6) return `${+(hz / 1e6).toFixed(2)} MHz`;
  if (hz >= 1e3) return `${+(hz / 1e3).toFixed(2)} kHz`;
  return `${hz} Hz`;
}

/** Seconds of machine time: "0.42 ms", "3.1 s", "2 min 5 s" */
export function formatDuration(seconds) {
  if (seconds < 1e-3) return `${+(seconds * 1e6).toFixed(1)} µs`;
  if (seconds < 1) return `${+(seconds * 1e3).toFixed(1)} ms`;
  if (seconds < 60) return `${+seconds.toFixed(2)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

const PREFERENCES_KEY = 'cpu-sandbox.v1';
export function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch (_) { return {}; }
}
export function savePreferences(patch) {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...loadPreferences(), ...patch })); } catch (_) {
    // Private windows may refuse storage; preferences are a convenience only.
  }
}

/**
 * A question in the style of the other dialogs instead of the browser's
 * confirm(): resolves true for the main action, false for cancel, Esc, ×
 * or a click beside the dialog.
 */
export function askConfirm({ title, message, note = '', ok = 'Discard', cancel = 'Keep editing' }) {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-note').textContent = note;
  $('confirm-ok').querySelector('span').textContent = ok;
  $('confirm-cancel').textContent = cancel;
  return new Promise(resolve => {
    const finish = answer => {
      dialog.removeEventListener('close', onClose);
      for (const [id, handler] of handlers) $(id).removeEventListener('click', handler);
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    const onClose = () => finish(false);
    const handlers = [['confirm-ok', () => finish(true)], ['confirm-cancel', () => finish(false)], ['confirm-close', () => finish(false)]];
    for (const [id, handler] of handlers) $(id).addEventListener('click', handler);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    $('confirm-cancel').focus();   // the safe choice has the focus
  });
}
