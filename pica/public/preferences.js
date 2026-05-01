import { showMessage, setBusy } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';
import { t } from '/i18n.js';

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
(async () => {
  const res = await fetch('/api/settings/me', { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = '/login'; return; }
  data = await res.json();
  render(data.prefs);
})();
