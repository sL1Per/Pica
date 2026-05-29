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
const emailNotifEl    = $('email-notifications');
const emailRemEl      = $('email-reminders');
const paletteRow      = $('palette-row');

/** Replace a button's label with a transient sage "✓ <word>" flash. */
function flashSaved(btn, labelText, word, onComplete) {
  btn.disabled = true;
  btn.classList.add('prefs-btn--flash');
  btn.textContent = '✓ ' + word;
  setTimeout(() => {
    btn.classList.remove('prefs-btn--flash');
    btn.disabled = false;
    btn.textContent = labelText;
    if (typeof onComplete === 'function') onComplete();
  }, 1800);
}

// M15 palette picker. The 4 preview chips per palette are (bg, primary,
// success, alert) and swap with the selected color mode. Hex mirrors the
// 6-combo token cascade in app.css.
const PALETTE_ORDER = ['linen', 'slate', 'olive'];
const PALETTE_CHIPS = {
  linen: { light: ['#FBF6EC', '#C97A1A', '#5C7A4E', '#B14B2A'], dark: ['#261D12', '#E6A24F', '#97B385', '#D77453'] },
  slate: { light: ['#FBFCFE', '#2563EB', '#059669', '#DC2626'], dark: ['#151F33', '#60A5FA', '#34D399', '#F87171'] },
  olive: { light: ['#FBFAF1', '#6B7D2F', '#4D7041', '#B85C2F'], dark: ['#20231A', '#B5C557', '#91AC74', '#D27B53'] },
};
let selectedPalette = 'linen';

// Translate the static labels on this page.
function applyTranslations() {
  const setText = (id, key) => { const el = $(id); if (el) el.textContent = t(key); };
  setText('page-title',             'prefs.title');
  setText('page-subtitle',          'prefs.subtitle');
  setText('label-language',         'prefs.language');
  setText('hint-language',          'prefs.languageHint');
  setText('label-colormode',        'prefs.colorMode');
  setText('label-system',           'prefs.colorModeSystem');
  setText('label-light',            'prefs.colorModeLight');
  setText('label-dark',             'prefs.colorModeDark');
  setText('label-palette',          'prefs.palette');
  setText('hint-palette',           'prefs.paletteHint');
  setText('label-email-section',    'prefs.emailTitle');
  setText('label-email-notifications', 'prefs.emailNotifications');
  setText('label-email-reminders',  'prefs.emailReminders');
  setText('save-btn',               'prefs.save');
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

/** Effective light/dark for the chip preview, resolving 'system' via matchMedia. */
function effectiveMode() {
  const m = [...colorModeRadios].find((r) => r.checked)?.value || 'system';
  if (m === 'light') return 'light';
  if (m === 'dark') return 'dark';
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

/** Reflect a palette on <html> + persist it for other pages' bootstrap. */
function applyPalette(palette) {
  const root = document.documentElement;
  if (palette === 'slate' || palette === 'olive') root.setAttribute('data-palette', palette);
  else root.removeAttribute('data-palette'); // linen = bare :root, no attribute
  try { localStorage.setItem('pica-palette', palette); } catch {}
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Rebuild the palette cards for the current selection + color mode. */
function renderPaletteCards() {
  if (!paletteRow) return;
  const mode = effectiveMode();
  paletteRow.innerHTML = '';
  for (const id of PALETTE_ORDER) {
    const on = selectedPalette === id;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'palette-card' + (on ? ' palette-card--active' : '');
    card.setAttribute('aria-pressed', on ? 'true' : 'false');

    const swatches = document.createElement('div');
    swatches.className = 'palette-swatches';
    for (const color of PALETTE_CHIPS[id][mode]) {
      const chip = document.createElement('span');
      chip.className = 'palette-chip';
      chip.style.background = color; // CSSOM — no inline style attribute in HTML
      swatches.appendChild(chip);
    }

    const meta = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'palette-name';
    name.textContent = t('prefs.palette' + cap(id));
    const sub = document.createElement('div');
    sub.className = 'palette-sub';
    sub.textContent = t('prefs.palette' + cap(id) + 'Desc');
    meta.appendChild(name);
    meta.appendChild(sub);

    const check = document.createElement('span');
    check.className = 'palette-check' + (on ? ' palette-check--on' : '');
    check.textContent = on ? '✓' : '';

    card.appendChild(swatches);
    card.appendChild(meta);
    card.appendChild(check);
    card.addEventListener('click', () => { selectedPalette = id; renderPaletteCards(); });
    paletteRow.appendChild(card);
  }
}

// When the color mode changes, the chip previews swap light/dark.
for (const r of colorModeRadios) {
  r.addEventListener('change', renderPaletteCards);
}

function render(prefs) {
  localeEl.value = prefs.locale;
  for (const r of colorModeRadios) {
    r.checked = r.value === prefs.colorMode;
  }
  applyColorMode(prefs.colorMode);
  selectedPalette = prefs.palette || 'linen';
  renderPaletteCards();
  applyPalette(selectedPalette);
  // Treat absent email prefs as enabled (matches Task 6 store defaults).
  emailNotifEl.checked = prefs.email?.notifications !== false;
  emailRemEl.checked   = prefs.email?.reminders     !== false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = form.querySelector('button');
  setBusy(btn, true, t('prefs.saving'));

  const colorMode = [...colorModeRadios].find((r) => r.checked)?.value;
  const patch = {
    locale: localeEl.value,
    colorMode,
    palette: selectedPalette,
    email: { notifications: emailNotifEl.checked, reminders: emailRemEl.checked },
  };
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
    applyPalette(respData.prefs.palette);
    if (localeChanged) {
      window.location.reload();
      return;
    }
    flashSaved(btn, t('prefs.save'), t('prefs.savedFlash'));
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
    setBusy(btn, false);
  }
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
const pwMismatchEl        = $('pw-mismatch');

function refreshPwGate() {
  const cur = currentPasswordEl.value;
  const nw  = newPasswordEl.value;
  const cf  = confirmPasswordEl.value;
  const mismatch = cf.length > 0 && cf !== nw;
  if (pwMismatchEl) pwMismatchEl.hidden = !mismatch;
  const valid = cur.length > 0 && nw.length >= 8 && nw === cf;
  changePasswordBtn.disabled = !valid;
}
for (const el of [currentPasswordEl, newPasswordEl, confirmPasswordEl]) {
  el?.addEventListener('input', refreshPwGate);
}
refreshPwGate(); // start disabled

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
    flashSaved(changePasswordBtn, t('prefs.changePasswordButton'), t('prefs.passwordChangedFlash'), refreshPwGate);
    passwordForm.reset();
    refreshPwGate();
    // Hide the must-change banner — the flag has cleared on the backend.
    if (mustChangeBanner) mustChangeBanner.hidden = true;
  } catch (err) {
    showMessage(passwordMessageEl, err.message, 'error');
    setBusy(changePasswordBtn, false);
  }
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
  if (me.mustChangePassword && mustChangeBanner) {
    mustChangeBanner.hidden = false;
    // Scroll to the password form — the flag was set by an admin reset.
    $('password-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
