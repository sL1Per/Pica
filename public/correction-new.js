import { postJson, showMessage, setBusy } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();

const $ = (id) => document.getElementById(id);
const form         = $('correction-form');
const startField   = $('start-field');
const endField     = $('end-field');
const startLabel   = $('start-label');
const endLabel     = $('end-label');
const startEl      = $('start');
const endEl        = $('end');
const justEl       = $('justification');
const bankWarning  = $('bank-warning');
const bankWarnHrs  = $('bank-warn-hours');
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
      startLabel.textContent = 'Start (when you started working)';
      endLabel.textContent = 'End (when you stopped working)';
      startEl.required = true;
      endEl.required = true;
      break;
    case 'in':
      startField.hidden = false;
      endField.hidden = true;
      startLabel.textContent = 'When you arrived';
      startEl.required = true;
      endEl.required = false;
      break;
    case 'out':
      startField.hidden = true;
      endField.hidden = false;
      endLabel.textContent = 'When you left';
      startEl.required = false;
      endEl.required = true;
      break;
  }
  refreshWarning();
}

// -------- Live duration display + bank warning -----------------------------

function fmtHours(h) {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

function refreshWarning() {
  const kind = selectedKind();
  // Bank warning only matters for 'both' — single-side corrections never
  // contribute to the bank, regardless of justification.
  if (kind !== 'both') {
    bankWarning.hidden = true;
    return;
  }
  // Hide also when the user has typed a justification.
  if (justEl.value.trim().length > 0) {
    bankWarning.hidden = true;
    return;
  }
  // Show with the current computed duration.
  const s = startEl.value && new Date(startEl.value).getTime();
  const e = endEl.value && new Date(endEl.value).getTime();
  if (!s || !e || !Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    bankWarnHrs.textContent = 'hours';
  } else {
    bankWarnHrs.textContent = fmtHours((e - s) / 3_600_000);
  }
  bankWarning.hidden = false;
}

// Wire events.
form.querySelectorAll('input[name="kind"]').forEach((r) => {
  r.addEventListener('change', updateForKind);
});
startEl.addEventListener('input', refreshWarning);
endEl.addEventListener('input', refreshWarning);
justEl.addEventListener('input', refreshWarning);

// Initial paint.
updateForKind();

// -------- Submit ------------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Submitting…');

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
    showMessage(messageEl, result.data.error || 'Could not file correction', 'error');
    setBusy(btn, false);
  }
});
