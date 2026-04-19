import { postJson, showMessage, setBusy } from '/app.js';

const form     = document.getElementById('login-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const submit   = document.getElementById('submit-btn');
const message  = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(message, '');
  setBusy(submit, true, 'Signing in…');

  const result = await postJson('/api/login', {
    username: username.value.trim(),
    password: password.value,
  });

  if (result.ok) {
    window.location.href = '/';
    return;
  }

  showMessage(message, result.data.error || 'Sign-in failed', 'error');
  setBusy(submit, false);
  password.value = '';
  password.focus();
});
