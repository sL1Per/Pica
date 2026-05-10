import { postJson, showMessage, setBusy } from '/app.js';
import { t, translateError, applyTranslations } from '/i18n.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const form         = $('correction-form');
const startField   = $('start-field');
const endField     = $('end-field');
const startLabel   = $('start-label');
const endLabel     = $('end-label');
const startEl      = $('start');
const endEl        = $('end');
const justEl       = $('justification');
const messageEl    = $('message');

// -------- Defaults ----------------------------------------------------------

function localISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mn = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mn}`;
}
const today9 = new Date(); today9.setHours(9, 0, 0, 0);
const today17 = new Date(); today17.setHours(17, 0, 0, 0);
startEl.value = localISO(today9);
endEl.value = localISO(today17);

// -------- Kind switching ----------------------------------------------------

function selectedKind() {
  const checked = form.querySelector('input[name="kind"]:checked');
  return checked?.value ?? 'both';
}

function updateForKind() {
  const kind = selectedKind();
  switch (kind) {
    case 'both':
      startField.hidden = false;
      endField.hidden = false;
      startLabel.textContent = t('correctionNew.startBoth');
      endLabel.textContent = t('correctionNew.endBoth');
      startEl.required = true;
      endEl.required = true;
      break;
    case 'in':
      startField.hidden = false;
      endField.hidden = true;
      startLabel.textContent = t('correctionNew.startIn');
      startEl.required = true;
      endEl.required = false;
      break;
    case 'out':
      startField.hidden = true;
      endField.hidden = false;
      endLabel.textContent = t('correctionNew.endOut');
      startEl.required = false;
      endEl.required = true;
      break;
  }
}

// Wire events.
form.querySelectorAll('input[name="kind"]').forEach((r) => {
  r.addEventListener('change', updateForKind);
});

// Initial paint.
updateForKind();

// -------- Submit ------------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true, t('correctionNew.submitting'));

  const kind = selectedKind();
  const justification = justEl.value.trim() || undefined;

  const payload = { kind, justification };
  if (kind === 'both' || kind === 'in') {
    payload.start = new Date(startEl.value).toISOString();
  }
  if (kind === 'both' || kind === 'out') {
    payload.end = new Date(endEl.value).toISOString();
  }

  const result = await postJson('/api/corrections', payload);
  if (result.ok) {
    window.location.href = `/corrections/${result.data.correction.id}`;
  } else {
    showMessage(messageEl, translateError(result.data.errorCode, result.data.error || t('correctionNew.couldNotFile')), 'error');
    setBusy(btn, false);
  }
});
