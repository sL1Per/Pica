import { postJson, showMessage, setBusy } from '/app.js';

const form = document.getElementById('new-form');
const submit = document.getElementById('submit-btn');
const message = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(message, '');
  setBusy(submit, true, 'Creating…');

  const fd = new FormData(form);
  const payload = {};
  for (const [k, v] of fd.entries()) {
    // Trim strings; coerce numeric `age`.
    if (k === 'age' && v) payload.age = Number(v);
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
