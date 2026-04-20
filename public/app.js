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
