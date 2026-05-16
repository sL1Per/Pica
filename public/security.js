import { mountTopBar, mountFooter } from '/topbar.js';
import { applyTranslations, t, translateError } from '/i18n.js';
import { postJson, showMessage, setBusy } from '/app.js';

mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const msg = $('message');
function flash(text, kind) { msg.hidden = !text; showMessage(msg, text, kind); }

// Local DELETE-with-body helper (app.js postJson is POST-only). Mirrors
// postJson's contract incl. its try/catch so a network error becomes a
// returned {ok:false} rather than an unhandled rejection.
async function sendJson(method, url, payload) {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message || 'Network error' } };
  }
}

$('pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true);
  const r = await postJson('/api/security/passphrase', {
    currentPassphrase: $('cp-current').value,
    newPassphrase: $('cp-new').value,
  });
  setBusy(btn, false);
  if (r.ok) { e.target.reset(); flash(t('security.changePassOk'), 'success'); }
  else flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
});

$('rec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true);
  const r = await postJson('/api/security/recovery-code', { currentPassphrase: $('rc-current').value });
  setBusy(btn, false);
  if (r.ok) {
    const out = $('rc-output');
    out.hidden = false;
    out.textContent = r.data.code;
    flash(t('security.recoveryShown'), 'success');
    $('rc-current').value = '';
  } else flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
});

$('rc-remove').addEventListener('click', async () => {
  setBusy($('rc-remove'), true);
  const r = await sendJson('DELETE', '/api/security/recovery-code',
    { currentPassphrase: $('rc-current').value });
  setBusy($('rc-remove'), false);
  if (r.ok) { $('rc-output').hidden = true; flash(t('security.recoveryRemoved'), 'success'); }
  else flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
});

$('rot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  setBusy(btn, true);
  const r = await postJson('/api/security/rotate', {
    currentPassphrase: $('rot-current').value,
    confirm: $('rot-confirm').value,
  });
  if (r.ok) {
    // Rotation locks the server down (503) until restart. Deliberately
    // leave the button busy so a second submit can't fire the lockdown
    // error and clobber this success message.
    flash(t('security.rotateOk'), 'success');
  } else {
    setBusy(btn, false);
    flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
  }
});
