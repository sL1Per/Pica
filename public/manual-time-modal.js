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
//   // Per-open the title + subtitle can be overridden so the punch page reads
//   // "Forgot to clock?" while the corrections list keeps "Register manual time":
//   openManualTimeModal({ titleKey: 'correctionNew.forgotTitle',
//                         subtitleKey: 'correctionNew.forgotSubtitle' });
//
// The modal is built lazily once (module-level singleton). Each call to
// openManualTimeModal() resets the form to its defaults and stores the
// caller's onFiled callback.  onFiled is stored per-open in a module-level
// variable — NOT registered via modal.onClose() — to avoid the additive
// callback accumulation that onClose() would cause across reopens.
//
// Form shape (0.45.0 redesign): a horizontal segmented control picks what was
// missed (Both / Clock-in / Clock-out); a single Day date + Start time + End
// time then describe the window. The day+time pieces are recombined into the
// ISO start/end timestamps the API expects, so the backend payload is
// byte-equivalent to the old two-`datetime-local` form.
//
// No inline styles, no innerHTML with dynamic data. Conforms to the CSP
// constraints enforced by test-security-headers.mjs.

import { createModal } from '/modal.js';
import { postJson, showMessage, setBusy } from '/app.js';
import { t, translateError } from '/i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---- Module-level singletons -----------------------------------------------

// The modal instance (created once on first openManualTimeModal() call).
let modal = null;
let built = false;

// Per-open state. Set in openManualTimeModal() before each open().
let currentOnFiled = null;

// Form elements captured once when the modal is first built.
let formEl, subtitleEl, dayInputEl,
    startFieldEl, endFieldEl, startInputEl, endInputEl,
    justEl, messageEl, submitBtn;

// ---- Helpers ---------------------------------------------------------------

function ymd(date) {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Combine a yyyy-mm-dd day with a HH:mm time into a *local* Date (same
// semantics datetime-local had: the value is interpreted in the user's
// timezone, then serialized to UTC via toISOString()).
function combine(day, time) {
  return new Date(`${day}T${time}`);
}

function selectedKind() {
  const checked = formEl.querySelector('input[name="mtm-kind"]:checked');
  return checked?.value ?? 'both';
}

function updateForKind() {
  const kind = selectedKind();
  // Day is always shown. Only the start/end time fields toggle with the kind.
  startFieldEl.hidden   = (kind === 'out');
  endFieldEl.hidden     = (kind === 'in');
  startInputEl.required = (kind !== 'out');
  endInputEl.required   = (kind !== 'in');
}

function resetForm() {
  // Re-enable the submit button in case a prior open left it in a busy state
  // (e.g. a RangeError during payload construction prevented the finally path).
  setBusy(submitBtn, false);

  // Reset kind to "both".
  const bothRadio = formEl.querySelector('input[name="mtm-kind"][value="both"]');
  if (bothRadio) bothRadio.checked = true;

  // Reset to today, 09:00 → 17:00.
  dayInputEl.value   = ymd(new Date());
  startInputEl.value = '09:00';
  endInputEl.value   = '17:00';

  // Clear justification.
  justEl.value = '';

  // Clear any inline message.
  showMessage(messageEl, '');

  // Apply field visibility for the default kind.
  updateForKind();
}

// Build the leading checkmark for the submit button (SVG via createElementNS so
// no innerHTML / no inline style attribute — CSP-safe). stroke=currentColor so
// it inherits the button's text colour across every palette.
function checkIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'mtm-check');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M20 6 9 17l-5-5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

// ---- Build (called once) ---------------------------------------------------

function buildModal() {
  modal = createModal({ titleKey: 'correctionNew.title', className: 'mtm-modal' });

  const body = modal.body;

  // -- Subtitle (text set per-open in openManualTimeModal) --------------------
  subtitleEl = document.createElement('p');
  subtitleEl.className = 'mtm-subtitle';
  body.appendChild(subtitleEl);

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

  // -- Kind segmented control -------------------------------------------------
  // <fieldset> keeps the radio-group semantics (arrow-key navigation, a single
  // accessible name). The radios are visually hidden (.sr-only) but stay in the
  // DOM and focusable; the labels render as segments, the checked one filled
  // via `:has(:checked)` in the stylesheet.
  const kindGroup = document.createElement('fieldset');
  kindGroup.className = 'mtm-kind-group';

  const kindLegend = document.createElement('legend');
  kindLegend.className = 'mtm-legend';
  kindLegend.textContent = t('correctionNew.kindLegend');
  kindGroup.appendChild(kindLegend);

  const seg = document.createElement('div');
  seg.className = 'mtm-seg';

  const KINDS = [
    { value: 'both', titleKey: 'correctionNew.kindBothTitle', descKey: 'correctionNew.kindBothDesc', checked: true  },
    { value: 'in',   titleKey: 'correctionNew.kindInTitle',   descKey: 'correctionNew.kindInDesc',   checked: false },
    { value: 'out',  titleKey: 'correctionNew.kindOutTitle',  descKey: 'correctionNew.kindOutDesc',  checked: false },
  ];

  for (const k of KINDS) {
    const label = document.createElement('label');
    label.className = 'mtm-seg__opt';

    const radio = document.createElement('input');
    radio.type    = 'radio';
    radio.name    = 'mtm-kind';
    radio.value   = k.value;
    radio.checked = k.checked;
    radio.className = 'sr-only';
    radio.addEventListener('change', updateForKind);

    const main = document.createElement('span');
    main.className = 'mtm-seg__main';
    main.textContent = t(k.titleKey);

    const sub = document.createElement('span');
    sub.className = 'mtm-seg__sub';
    sub.textContent = t(k.descKey);

    label.appendChild(radio);
    label.appendChild(main);
    label.appendChild(sub);
    seg.appendChild(label);
  }

  kindGroup.appendChild(seg);
  formEl.appendChild(kindGroup);

  // -- Day field --------------------------------------------------------------
  const dayField = document.createElement('div');
  dayField.className = 'mtm-field';

  const dayLabel = document.createElement('label');
  dayLabel.setAttribute('for', 'mtm-day');
  dayLabel.textContent = t('correctionNew.day');

  dayInputEl = document.createElement('input');
  dayInputEl.type     = 'date';
  dayInputEl.id       = 'mtm-day';
  dayInputEl.name     = 'day';
  dayInputEl.required = true;

  dayField.appendChild(dayLabel);
  dayField.appendChild(dayInputEl);
  formEl.appendChild(dayField);

  // -- Start time field -------------------------------------------------------
  startFieldEl = document.createElement('div');
  startFieldEl.id = 'mtm-start-field';
  startFieldEl.className = 'mtm-field';

  const startLabel = document.createElement('label');
  startLabel.setAttribute('for', 'mtm-start');
  startLabel.textContent = t('correctionNew.startTime');

  startInputEl = document.createElement('input');
  startInputEl.type = 'time';
  startInputEl.id   = 'mtm-start';
  startInputEl.name = 'start';

  startFieldEl.appendChild(startLabel);
  startFieldEl.appendChild(startInputEl);
  formEl.appendChild(startFieldEl);

  // -- End time field ---------------------------------------------------------
  endFieldEl = document.createElement('div');
  endFieldEl.id = 'mtm-end-field';
  endFieldEl.className = 'mtm-field';

  const endLabel = document.createElement('label');
  endLabel.setAttribute('for', 'mtm-end');
  endLabel.textContent = t('correctionNew.endTime');

  endInputEl = document.createElement('input');
  endInputEl.type = 'time';
  endInputEl.id   = 'mtm-end';
  endInputEl.name = 'end';

  endFieldEl.appendChild(endLabel);
  endFieldEl.appendChild(endInputEl);
  formEl.appendChild(endFieldEl);

  // -- Justification ("Why?") -------------------------------------------------
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

  // -- Actions row (footer bar) -----------------------------------------------
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
  submitBtn.appendChild(checkIcon());
  submitBtn.appendChild(document.createTextNode(t('correctionNew.submit')));

  actionsEl.appendChild(cancelBtn);
  actionsEl.appendChild(submitBtn);
  formEl.appendChild(actionsEl);

  // -- Submit handler ---------------------------------------------------------
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(messageEl, '');
    setBusy(submitBtn, true, t('correctionNew.submitting'));

    const kind          = selectedKind();
    const day           = dayInputEl.value;
    const justification = justEl.value.trim() || undefined;

    let payload;
    try {
      payload = { kind, justification };

      if (kind === 'both') {
        const start = combine(day, startInputEl.value);
        let   end   = combine(day, endInputEl.value);
        // A single Day can't express an overnight window directly; if the end
        // time is at or before the start, assume the shift crossed midnight and
        // roll it onto the next day. Preserves the overnight case the old
        // two-datetime-local form supported.
        if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
        payload.start = start.toISOString();
        payload.end   = end.toISOString();
      } else if (kind === 'in') {
        payload.start = combine(day, startInputEl.value).toISOString();
      } else if (kind === 'out') {
        payload.end = combine(day, endInputEl.value).toISOString();
      }
    } catch (_err) {
      // toISOString() throws RangeError on an invalid Date (e.g. empty day).
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
 * @param {string} [opts.titleKey]    i18n key for the modal title (defaults to
 *   'correctionNew.title' — "Register manual time").
 * @param {string} [opts.subtitleKey] i18n key for the subtitle line (defaults
 *   to 'correctionNew.subtitle').
 */
export function openManualTimeModal({ onFiled, titleKey, subtitleKey } = {}) {
  if (!built) buildModal();

  // Store the per-open callback. Reset to null if not provided so a leftover
  // callback from a previous open cannot fire again.
  currentOnFiled = onFiled || null;

  // Per-open title + subtitle (lets the punch page read "Forgot to clock?"
  // while the corrections list keeps "Register manual time").
  modal.titleEl.textContent = t(titleKey || 'correctionNew.title');
  subtitleEl.textContent    = t(subtitleKey || 'correctionNew.subtitle');

  // Reset form fields to clean defaults for this open.
  resetForm();

  modal.open();
}
