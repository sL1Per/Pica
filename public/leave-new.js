import { postJson, showMessage, setBusy } from '/app.js';
import { t, translateError, applyTranslations } from '/i18n.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const form = $('leave-form');
const submitBtn = $('submit-btn');
const messageEl = $('message');
const daysFields  = $('days-fields');
const hoursFields = $('hours-fields');

// Pre-fill today for convenience.
const today = new Date().toISOString().slice(0, 10);
$('day-start').value = today;
$('day-end').value = today;
$('hour-date').value = today;

// Toggle between days and hours fields.
for (const r of form.querySelectorAll('input[name=unit]')) {
  r.addEventListener('change', () => {
    const isDays = r.value === 'days' && r.checked;
    daysFields.hidden = !isDays;
    hoursFields.hidden = isDays;
  });
}

function buildPayload() {
  const type = $('type').value;
  const unit = form.querySelector('input[name=unit]:checked').value;
  const reason = $('reason').value.trim() || undefined;

  if (unit === 'days') {
    const start = $('day-start').value;
    const end = $('day-end').value;
    if (!start || !end) throw new Error('Pick start and end dates.');
    if (start > end) throw new Error('Start must be on or before end.');
    return { type, unit, start, end, reason };
  }

  // hours
  const date = $('hour-date').value;
  const hs = $('hour-start').value;
  const he = $('hour-end').value;
  if (!date || !hs || !he) throw new Error('Pick a date and both times.');
  const start = new Date(`${date}T${hs}:00`).toISOString();
  const end   = new Date(`${date}T${he}:00`).toISOString();
  if (new Date(start) >= new Date(end)) throw new Error('End time must be after start time.');
  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  const hours = durationMs / 3_600_000;
  return { type, unit, start, end, hours, reason };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');

  let payload;
  try {
    payload = buildPayload();
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
    return;
  }

  setBusy(submitBtn, true, t('leaveNew.submitting'));
  const result = await postJson('/api/leaves', payload);
  if (result.ok) {
    window.location.href = `/leaves/${result.data.leave.id}`;
    return;
  }
  showMessage(messageEl, result.translateError(data.errorCode, data.error) || 'Failed to submit', 'error');
  setBusy(submitBtn, false);
});
