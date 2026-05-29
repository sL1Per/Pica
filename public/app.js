// Shared front-end utilities. Loaded as an ES module.

// -- Color mode bootstrap --------------------------------------------------
// Every page's <head> contains a small synchronous script that reads the
// theme from localStorage *before* CSS loads, preventing FOUC. This async
// IIFE refreshes the cache from the server (the source of truth) and
// applies any change in case the user updated prefs from another tab/device.
(async () => {
  try {
    const res = await fetch('/api/settings/me', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { prefs } = await res.json();
    const root = document.documentElement;

    // Color mode (light/dark/system).
    const mode = prefs?.colorMode ?? 'system';
    try { localStorage.setItem('pica-color-mode', mode); } catch {}
    const dark = mode === 'dark' || (mode !== 'light'
      && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');

    // Palette (linen/slate/olive). Absent until the Preferences plan adds it —
    // when absent, leave whatever the synchronous bootstrap already applied.
    if (prefs?.palette === 'linen' || prefs?.palette === 'slate' || prefs?.palette === 'olive') {
      try { localStorage.setItem('pica-palette', prefs.palette); } catch {}
      if (prefs.palette === 'slate' || prefs.palette === 'olive') root.setAttribute('data-palette', prefs.palette);
      else root.removeAttribute('data-palette');
    }
  } catch { /* anonymous pages (login, setup) get the default theme */ }
})();

/**
 * POST JSON to the given URL. Returns { ok, status, data }.
 * Never throws — always returns a structured result.
 */
export async function postJson(url, payload) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message || 'Network error' } };
  }
}

/** Show a message in the given element. Clears if text is falsy. */
export function showMessage(el, text, kind = 'error') {
  if (!el) return;
  el.className = `message ${kind}`;
  el.textContent = text || '';
}

/** Disable/enable a button and change its label while in flight. */
export function setBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }
}

/**
 * Alternative to setBusy — keeps the original label visible but overlays
 * a CSS spinner. Better for short async actions where the text stays
 * stable. The button gets `data-loading="true"` which triggers the
 * spinner ::after in app.css.
 */
export function setLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.dataset.loading = 'true';
    button.disabled = true;
  } else {
    delete button.dataset.loading;
    button.disabled = false;
  }
}

/**
 * Transient "✓ saved" button flash, shared across Preferences / Profile /
 * Settings. Adds `flashClass`; shows confirmation content (either `word` →
 * "✓ word" via textContent, or caller-built `html`); then after `duration` ms
 * removes the class, re-enables the button, and restores its label (calls
 * `restore()` if a function, else sets `restore` as textContent). `onComplete`
 * runs after restore (Preferences uses it to re-disable Change-password until
 * the gate re-validates). `beforeFlash(btn)` runs first (Settings clears its
 * data-label). Each page keeps its own flash CSS class — the visual is
 * unchanged; only this timing/label-swap logic is shared.
 */
export function flashSaved(btn, opts = {}) {
  if (!btn) return;
  const { word, html, restore, flashClass = 'is-flashing',
          startDisabled = true, duration = 1800, onComplete, beforeFlash } = opts;
  if (typeof beforeFlash === 'function') beforeFlash(btn);
  btn.disabled = startDisabled;
  btn.classList.add(flashClass);
  if (html != null) btn.innerHTML = html;   // caller-built, escaped (Settings)
  else btn.textContent = '✓ ' + word;
  setTimeout(() => {
    btn.classList.remove(flashClass);
    btn.disabled = false;
    if (typeof restore === 'function') restore();
    else if (restore != null) btn.textContent = restore;
    if (typeof onComplete === 'function') onComplete();
  }, duration);
}

// -- Toasts -----------------------------------------------------------------

/**
 * Show a toast notification in the top-right.
 *
 *   toast('Saved successfully', 'success');
 *   toast('Network error', 'error');
 *   toast('Heads up', 'warning', { duration: 8000 });
 *
 * Kinds: 'success' (default), 'error', 'warning', 'info'.
 * Options:
 *   duration — ms before auto-dismiss. 0 = manual dismiss only. Default 3500.
 *   dismissible — render a close button. Default true.
 */
export function toast(message, kind = 'success', options = {}) {
  const duration = options.duration ?? 3500;
  const dismissible = options.dismissible ?? true;

  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  if (dismissible) {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost btn-sm toast__close';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.style.margin = '0 0 0 auto';
    btn.style.minHeight = '0';
    btn.style.padding = '0 6px';
    btn.textContent = '×';
    btn.addEventListener('click', () => dismiss(el));
    // Layout inside the toast: text on the left, close on the right.
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = 'var(--gap-3)';
    el.appendChild(btn);
  }

  root.appendChild(el);

  if (duration > 0) {
    setTimeout(() => dismiss(el), duration);
  }
  return el;
}

function dismiss(el) {
  if (!el || !el.isConnected) return;
  el.dataset.dismissing = 'true';
  setTimeout(() => el.remove(), 200);
}

function ensureToastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}
