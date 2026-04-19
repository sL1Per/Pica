import { postJson, showMessage, setBusy } from '/app.js';

const form     = document.getElementById('setup-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const confirm  = document.getElementById('confirm');
const submit   = document.getElementById('submit-btn');
const message  = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(message, '');

  if (password.value !== confirm.value) {
    showMessage(message, 'Passwords do not match', 'error');
    return;
  }
  if (password.value.length < 8) {
    showMessage(message, 'Password must be at least 8 characters', 'error');
    return;
  }

  setBusy(submit, true, 'Creating account…');

  const result = await postJson('/api/setup', {
    username: username.value.trim(),
    password: password.value,
  });

  if (result.ok) {
    showMessage(message, 'Account created — redirecting…', 'success');
    window.location.href = '/';
    return;
  }

  showMessage(message, result.data.error || 'Setup failed', 'error');
  setBusy(submit, false);
});
