import { showMessage, setBusy } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();

const $ = (id) => document.getElementById(id);
const messageEl       = $('message');
const form            = $('prefs-form');
const languageEl      = $('language');
const colorModeRadios = document.querySelectorAll('input[name="colorMode"]');

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
  languageEl.value = prefs.language;
  for (const r of colorModeRadios) {
    r.checked = r.value === prefs.colorMode;
  }
  applyColorMode(prefs.colorMode);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = form.querySelector('button');
  setBusy(btn, true, 'Saving…');

  const colorMode = [...colorModeRadios].find((r) => r.checked)?.value;
  const patch = { language: languageEl.value, colorMode };

  try {
    const res = await fetch('/api/settings/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save');
    applyColorMode(data.prefs.colorMode);
    showMessage(messageEl, 'Preferences saved.', 'success');
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
  }
  setBusy(btn, false);
});

(async () => {
  const res = await fetch('/api/settings/me', { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = '/login'; return; }
  const data = await res.json();
  render(data.prefs);
})();
