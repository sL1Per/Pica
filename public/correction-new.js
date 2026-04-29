import { postJson, showMessage, setBusy } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();

const $ = (id) => document.getElementById(id);
const form         = $('correction-form');
const startEl      = $('start');
const endEl        = $('end');
const justEl       = $('justification');
const bankWarning  = $('bank-warning');
const bankWarnHrs  = $('bank-warn-hours');
const messageEl    = $('message');

// -------- Defaults ----------------------------------------------------------

// Pre-fill with "today, 09:00 → 17:00" so the user can just edit the bits
// they care about. We use the local-time HTML5 datetime-local format
// (YYYY-MM-DDTHH:mm), NOT the UTC ISO format. The browser handles the
// conversion when posting.
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

// -------- Live duration display + bank warning -----------------------------

function fmtHours(h) {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh === 0) return `${mm} min`;
  if (mm === 0) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

function updateWarning() {
  const s = startEl.value && new Date(startEl.value).getTime();
  const e = endEl.value && new Date(endEl.value).getTime();
  if (!s || !e || !Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    bankWarnHrs.textContent = 'hours';
    return;
  }
  bankWarnHrs.textContent = fmtHours((e - s) / 3_600_000);
}
function refreshWarningVisibility() {
  // Show only when justification is empty.
  bankWarning.hidden = justEl.value.trim().length > 0;
}
startEl.addEventListener('input', () => { updateWarning(); });
endEl.addEventListener('input', () => { updateWarning(); });
justEl.addEventListener('input', refreshWarningVisibility);
updateWarning();
refreshWarningVisibility();

// -------- Submit -----------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Submitting…');

  // datetime-local values are local-time strings without timezone — convert
  // to a real ISO via the Date constructor (which interprets them as local).
  const startIso = new Date(startEl.value).toISOString();
  const endIso   = new Date(endEl.value).toISOString();
  const justification = justEl.value.trim() || undefined;

  const result = await postJson('/api/corrections', {
    start: startIso, end: endIso, justification,
  });
  if (result.ok) {
    window.location.href = `/corrections/${result.data.correction.id}`;
  } else {
    showMessage(messageEl, result.data.error || 'Could not file correction', 'error');
    setBusy(btn, false);
  }
});
