// Pica — Manual-time form modal (M15).
//
// Wraps the correction-new form logic inside the generic modal shell so the
// same "register manual time" form can be opened from the punch page (and
// future pages) without navigating away to /correction-new.
//
// API:
//   import { openManualTimeModal } from '/manual-time-modal.js';
//   openManualTimeModal({ onFiled: (correction) => { ... } });
//
// The modal is built lazily once (module-level singleton). Each call to
// openManualTimeModal() resets the form to its defaults and stores the
// caller's onFiled callback.  onFiled is stored per-open in a module-level
// variable — NOT registered via modal.onClose() — to avoid the additive
// callback accumulation that onClose() would cause across reopens.
//
// No inline styles, no innerHTML with dynamic data. Conforms to the CSP
// constraints enforced by test-security-headers.mjs.

import { createModal } from '/modal.js';
import { postJson, showMessage, setBusy } from '/app.js';
import { t, translateError } from '/i18n.js';

// ---- Module-level singletons -----------------------------------------------

// The modal instance (created once on first openManualTimeModal() call).
let modal = null;
let built = false;

// Per-open state. Set in openManualTimeModal() before each open().
let currentOnFiled = null;

// Form elements captured once when the modal is first built.
let formEl, startFieldEl, endFieldEl, startInputEl, endInputEl,
    startLabelEl, endLabelEl, justEl, messageEl, submitBtn;

// ---- Helpers ---------------------------------------------------------------

function localISO(date) {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  const hh   = String(date.getHours()).padStart(2, '0');
  const mn   = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mn}`;
}

function selectedKind() {
  const checked = formEl.querySelector('input[name="mtm-kind"]:checked');
  return checked?.value ?? 'both';
}

function updateForKind() {
  const kind = selectedKind();
  switch (kind) {
    case 'both':
      startFieldEl.hidden = false;
      endFieldEl.hidden   = false;
      startLabelEl.textContent = t('correctionNew.startBoth');
      endLabelEl.textContent   = t('correctionNew.endBoth');
      startInputEl.required    = true;
      endInputEl.required      = true;
      break;
    case 'in':
      startFieldEl.hidden  = false;
      endFieldEl.hidden    = true;
      startLabelEl.textContent = t('correctionNew.startIn');
      startInputEl.required    = true;
      endInputEl.required      = false;
      break;
    case 'out':
      startFieldEl.hidden  = true;
      endFieldEl.hidden    = false;
      endLabelEl.textContent   = t('correctionNew.endOut');
      startInputEl.required    = false;
      endInputEl.required      = true;
      break;
  }
}

function resetForm() {
  // Re-enable the submit button in case a prior open left it in a busy state
  // (e.g. a RangeError during payload construction prevented the finally path).
  setBusy(submitBtn, false);

  // Reset kind to "both".
  const bothRadio = formEl.querySelector('input[name="mtm-kind"][value="both"]');
  if (bothRadio) bothRadio.checked = true;

  // Reset datetimes to today 09:00 / 17:00.
  const today9  = new Date(); today9.setHours(9, 0, 0, 0);
  const today17 = new Date(); today17.setHours(17, 0, 0, 0);
  startInputEl.value = localISO(today9);
  endInputEl.value   = localISO(today17);

  // Clear justification.
  justEl.value = '';

  // Clear any inline message.
  showMessage(messageEl, '');

  // Apply field visibility for the default kind.
  updateForKind();
}

// ---- Build (called once) ---------------------------------------------------

function buildModal() {
  modal = createModal({ titleKey: 'correctionNew.title', className: 'mtm-modal' });

  const body = modal.body;

  // -- Subtitle ---------------------------------------------------------------
  const subtitle = document.createElement('p');
  subtitle.className = 'mtm-subtitle';
  subtitle.textContent = t('correctionNew.subtitle');
  body.appendChild(subtitle);

  // -- Inline message (errors) ------------------------------------------------
  messageEl = document.createElement('div');
  messageEl.id = 'mtm-message';
  messageEl.className = 'message';
  body.appendChild(messageEl);

  // -- Form -------------------------------------------------------------------
  formEl = document.createElement('form');
  formEl.id = 'mtm-form';
  formEl.setAttribute('autocomplete', 'off');
  body.appendChild(formEl);

  // -- Kind group (radio cards) -----------------------------------------------
  const kindGroup = document.createElement('fieldset');
  kindGroup.className = 'mtm-kinds';

  const kindLegend = document.createElement('legend');
  kindLegend.textContent = t('correctionNew.kindLegend');
  kindGroup.appendChild(kindLegend);

  const KINDS = [
    { value: 'both', titleKey: 'correctionNew.kindBothTitle', descKey: 'correctionNew.kindBothDesc', checked: true  },
    { value: 'in',   titleKey: 'correctionNew.kindInTitle',   descKey: 'correctionNew.kindInDesc',   checked: false },
    { value: 'out',  titleKey: 'correctionNew.kindOutTitle',  descKey: 'correctionNew.kindOutDesc',  checked: false },
  ];

  for (const k of KINDS) {
    const label = document.createElement('label');
    label.className = 'mtm-kind';

    const radio = document.createElement('input');
    radio.type    = 'radio';
    radio.name    = 'mtm-kind';
    radio.value   = k.value;
    radio.checked = k.checked;
    radio.addEventListener('change', updateForKind);

    const textCol = document.createElement('div');
    textCol.className = 'mtm-kind__text';

    const strong = document.createElement('strong');
    strong.textContent = t(k.titleKey);

    const span = document.createElement('span');
    span.textContent = t(k.descKey);

    textCol.appendChild(strong);
    textCol.appendChild(span);

    label.appendChild(radio);
    label.appendChild(textCol);
    kindGroup.appendChild(label);
  }

  formEl.appendChild(kindGroup);

  // -- Start field ------------------------------------------------------------
  startFieldEl = document.createElement('div');
  startFieldEl.id = 'mtm-start-field';
  startFieldEl.className = 'mtm-field';

  startLabelEl = document.createElement('label');
  startLabelEl.setAttribute('for', 'mtm-start');
  startLabelEl.textContent = t('correctionNew.startBoth');

  startInputEl = document.createElement('input');
  startInputEl.type = 'datetime-local';
  startInputEl.id   = 'mtm-start';
  startInputEl.name = 'start';

  startFieldEl.appendChild(startLabelEl);
  startFieldEl.appendChild(startInputEl);
  formEl.appendChild(startFieldEl);

  // -- End field --------------------------------------------------------------
  endFieldEl = document.createElement('div');
  endFieldEl.id = 'mtm-end-field';
  endFieldEl.className = 'mtm-field';

  endLabelEl = document.createElement('label');
  endLabelEl.setAttribute('for', 'mtm-end');
  endLabelEl.textContent = t('correctionNew.endBoth');

  endInputEl = document.createElement('input');
  endInputEl.type = 'datetime-local';
  endInputEl.id   = 'mtm-end';
  endInputEl.name = 'end';

  endFieldEl.appendChild(endLabelEl);
  endFieldEl.appendChild(endInputEl);
  formEl.appendChild(endFieldEl);

  // -- Justification ----------------------------------------------------------
  const justLabel = document.createElement('label');
  justLabel.setAttribute('for', 'mtm-justification');

  const justLabelMain = document.createElement('span');
  justLabelMain.textContent = t('correctionNew.justification');

  const justLabelOpt = document.createElement('span');
  justLabelOpt.className = 'subtle';
  justLabelOpt.textContent = ' ' + t('correctionNew.justificationOptional');

  justLabel.appendChild(justLabelMain);
  justLabel.appendChild(justLabelOpt);

  justEl = document.createElement('textarea');
  justEl.id          = 'mtm-justification';
  justEl.name        = 'justification';
  justEl.rows        = 3;
  justEl.maxLength   = 500;
  justEl.placeholder = t('correctionNew.justificationPlaceholder');

  formEl.appendChild(justLabel);
  formEl.appendChild(justEl);

  // -- Actions row ------------------------------------------------------------
  const actionsEl = document.createElement('div');
  actionsEl.className = 'mtm-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type      = 'button';
  cancelBtn.className = 'btn-ghost';
  cancelBtn.textContent = t('correctionNew.cancel');
  cancelBtn.addEventListener('click', () => modal.close());

  submitBtn = document.createElement('button');
  submitBtn.type      = 'submit';
  submitBtn.className = 'btn-primary';
  submitBtn.textContent = t('correctionNew.submit');

  actionsEl.appendChild(cancelBtn);
  actionsEl.appendChild(submitBtn);
  formEl.appendChild(actionsEl);

  // -- Submit handler ---------------------------------------------------------
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(messageEl, '');
    setBusy(submitBtn, true, t('correctionNew.submitting'));

    const kind          = selectedKind();
    const justification = justEl.value.trim() || undefined;

    let payload;
    try {
      payload = { kind, justification };
      if (kind === 'both' || kind === 'in') {
        payload.start = new Date(startInputEl.value).toISOString();
      }
      if (kind === 'both' || kind === 'out') {
        payload.end = new Date(endInputEl.value).toISOString();
      }
    } catch (_err) {
      showMessage(messageEl, t('correctionNew.couldNotFile'), 'error');
      setBusy(submitBtn, false);
      return;
    }

    const result = await postJson('/api/corrections', payload);
    if (result.ok) {
      // Store the callback before closing — close() may trigger callbacks
      // registered elsewhere (though we don't use onClose here).
      const cb = currentOnFiled;
      modal.close();
      setBusy(submitBtn, false);
      try { cb?.(result.data.correction); } catch (err) { console.error('[manual-time] onFiled callback failed', err); }
    } else {
      showMessage(
        messageEl,
        translateError(result.data.errorCode, result.data.error || t('correctionNew.couldNotFile')),
        'error',
      );
      setBusy(submitBtn, false);
    }
  });

  built = true;
}

// ---- Public API ------------------------------------------------------------

/**
 * Open the manual-time modal.
 *
 * @param {object} [opts]
 * @param {(correction: object) => void} [opts.onFiled]
 *   Called with the newly created correction object after a successful submit.
 *   The modal will already be closed when this fires.
 */
export function openManualTimeModal({ onFiled } = {}) {
  if (!built) buildModal();

  // Store the per-open callback. Reset to null if not provided so a leftover
  // callback from a previous open cannot fire again.
  currentOnFiled = onFiled || null;

  // Reset form fields to clean defaults for this open.
  resetForm();

  modal.open();
}
