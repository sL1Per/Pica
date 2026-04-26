import { postJson, showMessage, setBusy } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();

const form = document.getElementById('new-form');
const submit = document.getElementById('submit-btn');
const message = document.getElementById('message');

// Live age display next to the DOB picker.
const dobInput = document.getElementById('dateOfBirth');
const ageOut = document.getElementById('age-display');
if (dobInput && ageOut) {
  dobInput.addEventListener('change', () => {
    const v = dobInput.value;
    if (!v) { ageOut.hidden = true; return; }
    const [y, m, d] = v.split('-').map(Number);
    const birth = new Date(y, m - 1, d);
    if (Number.isNaN(birth.getTime())) { ageOut.hidden = true; return; }
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    if (age < 0 || age > 130) { ageOut.hidden = true; return; }
    ageOut.textContent = `${age} years old`;
    ageOut.hidden = false;
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(message, '');
  setBusy(submit, true, 'Creating…');

  const fd = new FormData(form);
  const payload = {};
  for (const [k, v] of fd.entries()) {
    // dateOfBirth is sent as YYYY-MM-DD string, null when empty.
    if (k === 'dateOfBirth') payload.dateOfBirth = v === '' ? null : v;
    else if (typeof v === 'string' && v.trim()) payload[k] = v.trim();
  }

  const result = await postJson('/api/employees', payload);
  if (result.ok) {
    showMessage(message, 'Created — redirecting…', 'success');
    window.location.href = `/employees/${result.data.employee.id}`;
    return;
  }
  showMessage(message, result.data.error || 'Failed to create', 'error');
  setBusy(submit, false);
});
