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

// ---- Change passphrase ----------------------------------------------------
// Submit is gated until: current present, new ≥12, confirm matches. The
// inline "don't match" hint shows once the confirm field is non-empty.

const cpCurrent = $('cp-current');
const cpNew = $('cp-new');
const cpConfirm = $('cp-confirm');
const cpMismatch = $('cp-mismatch');
const cpSubmit = $('cp-submit');

function passValid() {
  return cpCurrent.value.length > 0 && cpNew.value.length >= 12 && cpNew.value === cpConfirm.value;
}
function refreshPassGate() {
  cpMismatch.hidden = !(cpConfirm.value.length > 0 && cpConfirm.value !== cpNew.value);
  cpSubmit.disabled = !passValid();
}
[cpCurrent, cpNew, cpConfirm].forEach((el) => el.addEventListener('input', refreshPassGate));

$('pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!passValid()) return;
  setBusy(cpSubmit, true);
  const r = await postJson('/api/security/passphrase', {
    currentPassphrase: cpCurrent.value,
    newPassphrase: cpNew.value,
  });
  setBusy(cpSubmit, false);
  if (r.ok) {
    e.target.reset();
    refreshPassGate();
    flash(t('security.changePassOk'), 'success');
  } else flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
});

// ---- Recovery code --------------------------------------------------------
// Generate is gated on the current passphrase. After a successful generate
// the code shows once in a dashed-honey block with Copy + Done; the form is
// hidden. "Done" returns to the pre-generate state and reveals the hint that
// a code now exists (so the button reads "Generate new…").

const rcCurrent = $('rc-current');
const rcGen = $('rc-gen');
const rcRemove = $('rc-remove');
const rcHint = $('rc-hint');
const rcForm = $('rec-form');
const rcResult = $('rc-result');
const rcOutput = $('rc-output');

let hasRecovery = false;   // best-effort: known true after a generate this session

function refreshRecoveryGate() { rcGen.disabled = rcCurrent.value.length === 0; }
function setGenLabel() {
  rcGen.textContent = hasRecovery ? t('security.genNewRecoveryBtn') : t('security.genRecoveryBtn');
  rcHint.hidden = !hasRecovery;
}
rcCurrent.addEventListener('input', refreshRecoveryGate);
setGenLabel();

rcForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (rcCurrent.value.length === 0) return;
  setBusy(rcGen, true);
  const r = await postJson('/api/security/recovery-code', { currentPassphrase: rcCurrent.value });
  setBusy(rcGen, false);
  if (r.ok) {
    rcOutput.textContent = r.data.code;
    rcResult.hidden = false;
    rcForm.hidden = true;
    hasRecovery = true;
    rcCurrent.value = '';
    refreshRecoveryGate();
    flash(t('security.recoveryShown'), 'success');
  } else flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
});

$('rc-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(rcOutput.textContent);
    flash(t('security.recoveryCopied'), 'success');
  } catch { /* clipboard blocked — the code is still on screen, user-select:all */ }
});

$('rc-done').addEventListener('click', () => {
  rcResult.hidden = true;
  rcOutput.textContent = '';
  rcForm.hidden = false;
  setGenLabel();
});

rcRemove.addEventListener('click', async () => {
  setBusy(rcRemove, true);
  const r = await sendJson('DELETE', '/api/security/recovery-code', { currentPassphrase: rcCurrent.value });
  setBusy(rcRemove, false);
  if (r.ok) {
    hasRecovery = false;
    setGenLabel();
    flash(t('security.recoveryRemoved'), 'success');
  } else flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
});

// ---- Rotate encryption key ------------------------------------------------
// Gated until current passphrase present AND the confirm box reads ROTATE.

const rotCurrent = $('rot-current');
const rotConfirm = $('rot-confirm');
const rotSubmit = $('rot-submit');

function rotateValid() { return rotCurrent.value.length > 0 && rotConfirm.value === 'ROTATE'; }
function refreshRotateGate() { rotSubmit.disabled = !rotateValid(); }
[rotCurrent, rotConfirm].forEach((el) => el.addEventListener('input', refreshRotateGate));

$('rot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!rotateValid()) return;
  setBusy(rotSubmit, true);
  const r = await postJson('/api/security/rotate', {
    currentPassphrase: rotCurrent.value,
    confirm: rotConfirm.value,
  });
  if (r.ok) {
    // Rotation locks the server down (503) until restart. Deliberately
    // leave the button busy so a second submit can't fire the lockdown
    // error and clobber this success message.
    flash(t('security.rotateOk'), 'success');
  } else {
    setBusy(rotSubmit, false);
    flash(translateError(r.data.errorCode, r.data.error || 'Failed'), 'error');
  }
});
