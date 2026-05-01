import { mountFooter } from '/topbar.js';
import { postJson, showMessage, setBusy } from '/app.js';
import { t, translateError, applyTranslations } from '/i18n.js';

mountFooter();
applyTranslations();

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
    showMessage(message, t('setup.passwordMismatch'), 'error');
    return;
  }
  if (password.value.length < 8) {
    showMessage(message, t('errors.password_too_short'), 'error');
    return;
  }

  setBusy(submit, true, t('setup.submitting'));

  const result = await postJson('/api/setup', {
    username: username.value.trim(),
    password: password.value,
  });

  if (result.ok) {
    showMessage(message, t('setup.created'), 'success');
    window.location.href = '/';
    return;
  }

  const msg = translateError(result.data.errorCode, result.data.error || t('setup.failed'));
  showMessage(message, msg, 'error');
  setBusy(submit, false);
});
