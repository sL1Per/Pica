/**
 * Change-password page.
 *
 * Two entry paths:
 *   1. /change-password (voluntary) — user came from /preferences. Cancel
 *      goes home.
 *   2. /change-password (forced)   — user logged in with mustChangePassword=true,
 *      every other route redirects here. We hide the cancel link and show the
 *      forced-banner so the user understands why they're stuck here.
 *
 * On success, the server reissues the session cookie. We then redirect home.
 */

import { t, applyTranslations } from '/i18n.js';
import { showMessage, setBusy, postJson } from '/app.js';

applyTranslations();

const $ = (id) => document.getElementById(id);
const form         = $('change-form');
const currentInput = $('current-password');
const newInput     = $('new-password');
const confirmInput = $('new-password-confirm');
const submitBtn    = $('submit-btn');
const cancelLink   = $('cancel-link');
const forcedBanner = $('forced-banner');
const messageEl    = $('message');

// Detect forced mode from /api/me. We can't drive UI off the cookie alone
// (it doesn't carry the flag), so we ask the server.
(async () => {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) return; // best-effort; UI defaults to voluntary mode
    const me = await res.json();
    if (me.mustChangePassword) {
      forcedBanner.hidden = false;
      // Forced mode: hide the cancel link. The user can still log out
      // through the OS-level browser actions, but the UI doesn't offer
      // an escape hatch here.
      if (cancelLink) cancelLink.hidden = true;
    }
  } catch { /* network blip; voluntary mode is fine */ }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const currentPassword = currentInput.value;
  const newPassword = newInput.value;
  const confirm = confirmInput.value;

  if (newPassword !== confirm) {
    showMessage(messageEl, t('changePassword.mismatch'), 'error');
    return;
  }
  if (newPassword.length < 8) {
    showMessage(messageEl, t('errors.password_too_short'), 'error');
    return;
  }
  if (newPassword === currentPassword) {
    showMessage(messageEl, t('changePassword.sameAsOld'), 'error');
    return;
  }

  setBusy(submitBtn, true);
  const r = await postJson('/api/me/password', { currentPassword, newPassword });
  if (r.ok) {
    showMessage(messageEl, t('changePassword.success'), 'success');
    // Brief pause so the user can see the success message, then redirect.
    setTimeout(() => { window.location.href = '/'; }, 800);
  } else {
    // Localize via errorCode when present, fall back to the server's English text.
    let message;
    if (r.data?.errorCode) {
      const localized = t('errors.' + r.data.errorCode);
      message = localized.startsWith('[errors.') ? (r.data.error || localized) : localized;
    } else {
      message = r.data?.error || `HTTP ${r.status}`;
    }
    showMessage(messageEl, message, 'error');
    setBusy(submitBtn, false);
  }
});
