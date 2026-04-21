// Shared front-end utilities. Loaded as an ES module.

// -- Color mode bootstrap --------------------------------------------------
// Every page imports this module, so this IIFE runs exactly once per page
// load. It fetches the current user's stored color-mode preference and
// applies `data-theme="light"` or `"dark"` on <html>. On `system`
// (or any error), we remove the attribute and let the CSS fall through to
// the @media (prefers-color-scheme) fallback.
(async () => {
  try {
    const res = await fetch('/api/settings/me', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { prefs } = await res.json();
    const mode = prefs?.colorMode ?? 'system';
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    } else {
      document.documentElement.removeAttribute('data-theme');
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
