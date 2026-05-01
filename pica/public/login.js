import { mountFooter } from '/topbar.js';
import { postJson, showMessage, setBusy } from '/app.js';
import { t, translateError, applyTranslations } from '/i18n.js';

mountFooter();
applyTranslations();

const form     = document.getElementById('login-form');
const username = document.getElementById('username');
const password = document.getElementById('password');
const submit   = document.getElementById('submit-btn');
const message  = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(message, '');
  setBusy(submit, true, t('login.signingIn'));

  const result = await postJson('/api/login', {
    username: username.value.trim(),
    password: password.value,
  });

  if (result.ok) {
    window.location.href = '/';
    return;
  }

  // Prefer the localized message via errorCode; fall back to the
  // server's English `error` string; final fallback is generic.
  const msg = translateError(result.data.errorCode, result.data.error || t('login.invalid'));
  showMessage(message, msg, 'error');
  setBusy(submit, false);
  password.value = '';
  password.focus();
});
