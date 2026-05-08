import { showMessage, setBusy } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';
import { t, translateError } from '/i18n.js';

mountTopBar();
mountFooter();

const $ = (id) => document.getElementById(id);
const messageEl       = $('message');
const form            = $('prefs-form');
const localeEl        = $('locale');
const colorModeRadios = document.querySelectorAll('input[name="colorMode"]');

// Translate the static labels on this page.
function applyTranslations() {
  const setText = (id, key) => { const el = $(id); if (el) el.textContent = t(key); };
  setText('page-title',     'prefs.title');
  setText('page-subtitle',  'prefs.subtitle');
  setText('label-language', 'prefs.language');
  setText('hint-language',  'prefs.languageHint');
  setText('label-colormode','prefs.colorMode');
  setText('label-system',   'prefs.colorModeSystem');
  setText('label-light',    'prefs.colorModeLight');
  setText('label-dark',     'prefs.colorModeDark');
  setText('save-btn',       'prefs.save');
}

function applyColorMode(mode) {
  const root = document.documentElement;
  if (mode === 'dark' || mode === 'light') {
    root.setAttribute('data-theme', mode);
  } else {
    root.removeAttribute('data-theme');
  }
  // Persist for other pages' synchronous theme bootstrap.
  try { localStorage.setItem('pica-color-mode', mode); } catch {}
}

function render(prefs) {
  localeEl.value = prefs.locale;
  for (const r of colorModeRadios) {
    r.checked = r.value === prefs.colorMode;
  }
  applyColorMode(prefs.colorMode);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = form.querySelector('button');
  setBusy(btn, true, t('prefs.saving'));

  const colorMode = [...colorModeRadios].find((r) => r.checked)?.value;
  const patch = { locale: localeEl.value, colorMode };
  // Note whether the language changed — a change requires a reload so the
  // server-rendered <html lang> + meta tag pick up the new locale and
  // every page on the site re-bootstraps with the new strings.
  const localeChanged = data?.prefs?.locale !== localeEl.value;

  try {
    const res = await fetch('/api/settings/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    });
    const respData = await res.json();
    if (!res.ok) throw new Error(respData.error || 'Failed to save');
    applyColorMode(respData.prefs.colorMode);
    if (localeChanged) {
      window.location.reload();
      return;
    }
    showMessage(messageEl, t('prefs.saved'), 'success');
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
  }
  setBusy(btn, false);
});

let data = null;
applyTranslations();

// ---- Password change form -----------------------------------------------

const passwordForm        = $('password-form');
const passwordMessageEl   = $('password-message');
const currentPasswordEl   = $('current-password');
const newPasswordEl       = $('new-password');
const confirmPasswordEl   = $('confirm-password');
const changePasswordBtn   = $('change-password-btn');
const mustChangeBanner    = $('must-change-banner');
const passwordCard        = $('password-card');

passwordForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = currentPasswordEl.value;
  const newPassword     = newPasswordEl.value;
  const confirm         = confirmPasswordEl.value;

  if (newPassword !== confirm) {
    showMessage(passwordMessageEl, t('prefs.passwordsDoNotMatch'), 'error');
    return;
  }
  if (newPassword.length < 8) {
    showMessage(passwordMessageEl, t('errors.password_too_short'), 'error');
    return;
  }

  setBusy(changePasswordBtn, true);
  try {
    const res = await fetch('/api/me/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const respData = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fallback = respData.error || `HTTP ${res.status}`;
      throw new Error(translateError(respData.errorCode, fallback));
    }
    showMessage(passwordMessageEl, t('prefs.passwordChanged'), 'success');
    // Clear the form so a stray refresh doesn't leak the new password.
    passwordForm.reset();
    // Hide the must-change banner — the flag has cleared on the backend.
    if (mustChangeBanner) mustChangeBanner.hidden = true;
  } catch (err) {
    showMessage(passwordMessageEl, err.message, 'error');
  }
  setBusy(changePasswordBtn, false);
});

(async () => {
  const [prefsRes, meRes] = await Promise.all([
    fetch('/api/settings/me', { credentials: 'same-origin' }),
    fetch('/api/me', { credentials: 'same-origin' }),
  ]);
  if (prefsRes.status === 401 || meRes.status === 401) {
    window.location.href = '/login';
    return;
  }
  data = await prefsRes.json();
  render(data.prefs);

  // Surface the must-change banner if the backend says the user must
  // change their password. Also auto-scroll to the password card so
  // the next interaction is obvious.
  const me = await meRes.json();
  if (me.mustChangePassword && mustChangeBanner && passwordCard) {
    mustChangeBanner.hidden = false;
    passwordCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
