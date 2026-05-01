import { t, translateError, applyTranslations } from '/i18n.js';
import { postJson, showMessage, setBusy } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

// Pull the employee id out of the URL: /employees/<id>
const employeeId = window.location.pathname.split('/').pop();

const $ = (id) => document.getElementById(id);
const titleEl   = $('page-title');
const backLink  = $('back-link');
const message   = $('message');
const avatarEl  = $('avatar');
const uploadBtn = $('upload-btn');
const pictureIn = $('picture-input');
const removePic = $('remove-pic-btn');
const form      = $('profile-form');
const saveBtn   = $('save-btn');
const deleteBtn = $('delete-btn');
const dangerZone= $('danger-zone');

let me;
let target;

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

function renderAvatar(emp, hasPicture) {
  avatarEl.innerHTML = '';
  if (hasPicture) {
    const img = document.createElement('img');
    // Cache bust so the avatar updates after upload.
    img.src = `/api/employees/${emp.id}/picture?t=${Date.now()}`;
    img.alt = '';
    avatarEl.appendChild(img);
    removePic.hidden = false;
  } else {
    avatarEl.textContent = initials(emp.profile?.fullName || emp.username);
    removePic.hidden = true;
  }
}

function applyPermissions(isEmployer, isSelf) {
  // Employees can't edit position or comments on any profile.
  const readonlyForEmployee = ['position', 'comments'];
  if (!isEmployer) {
    for (const name of readonlyForEmployee) {
      $(name).readOnly = true;
      const hint = $(`${name}-hint`);
      if (hint) hint.hidden = false;
    }
  }
  // Delete button only for employers, and not on self.
  dangerZone.hidden = !(isEmployer && !isSelf);
}

function populateForm(emp) {
  $('username-display').textContent = emp.username;
  $('role-display').textContent = emp.role;
  titleEl.textContent = emp.profile?.fullName || emp.username;

  const p = emp.profile ?? {};
  $('fullName').value     = p.fullName     ?? '';
  $('dateOfBirth').value  = p.dateOfBirth  ?? '';
  updateAgeDisplay();
  $('position').value     = p.position     ?? '';
  $('contactEmail').value = p.contactEmail ?? '';
  $('contactPhone').value = p.contactPhone ?? '';
  $('address').value      = p.address      ?? '';
  $('comments').value     = p.comments     ?? '';
}

/**
 * Compute age in years from the DOB picker value and render alongside.
 * Hidden when no DOB or DOB is invalid / in the future.
 */
function updateAgeDisplay() {
  const dob = $('dateOfBirth').value;
  const out = $('age-display');
  if (!dob) { out.hidden = true; out.textContent = ''; return; }
  // Parse as YYYY-MM-DD in local time (avoid UTC-offset surprises).
  const [y, m, d] = dob.split('-').map(Number);
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime())) { out.hidden = true; return; }
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  if (age < 0 || age > 130) { out.hidden = true; return; }
  out.textContent = `${age} years old`;
  out.hidden = false;
}

// Recompute live as the user changes the picker.
document.addEventListener('DOMContentLoaded', () => {
  const dob = document.getElementById('dateOfBirth');
  if (dob) dob.addEventListener('change', updateAgeDisplay);
});

// ---------------------------------------------------------------------------
// Picture resize + upload (client-side)
// ---------------------------------------------------------------------------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function resizeToJpeg(file, maxDim = 400, quality = 0.85) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('resize failed')), 'image/jpeg', quality);
  });
}

uploadBtn.addEventListener('click', () => pictureIn.click());

pictureIn.addEventListener('change', async () => {
  const file = pictureIn.files?.[0];
  if (!file) return;
  showMessage(message, '');

  try {
    const blob = await resizeToJpeg(file);
    const fd = new FormData();
    fd.append('picture', blob, 'avatar.jpg');
    const res = await fetch(`/api/employees/${employeeId}/picture`, {
      method: 'PUT',
      body: fd,
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    renderAvatar(target, true);
    showMessage(message, 'Picture updated', 'success');
  } catch (err) {
    showMessage(message, err.message, 'error');
  } finally {
    pictureIn.value = '';
  }
});

removePic.addEventListener('click', async () => {
  const res = await fetch(`/api/employees/${employeeId}/picture`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (res.ok) {
    renderAvatar(target, false);
    showMessage(message, 'Picture removed', 'success');
  }
});

// ---------------------------------------------------------------------------
// Save profile
// ---------------------------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(message, '');
  setBusy(saveBtn, true, 'Saving…');

  const payload = {};
  const fields = ['fullName', 'dateOfBirth', 'position', 'contactEmail', 'contactPhone', 'address', 'comments'];
  for (const name of fields) {
    const el = $(name);
    if (el.readOnly) continue;
    const v = el.value.trim();
    if (name === 'dateOfBirth') payload.dateOfBirth = v === '' ? null : v;
    else payload[name] = v;
  }

  const res = await fetch(`/api/employees/${employeeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    target.profile = data.profile;
    titleEl.textContent = data.profile?.fullName || target.username;
    showMessage(message, 'Saved', 'success');
  } else {
    showMessage(message, data.error || 'Save failed', 'error');
  }
  setBusy(saveBtn, false);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

deleteBtn.addEventListener('click', async () => {
  if (!confirm(`Delete ${target.username}? This cannot be undone.`)) return;
  const res = await fetch(`/api/employees/${employeeId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    window.location.href = '/employees';
  } else {
    showMessage(message, data.error || 'Delete failed', 'error');
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async () => {
  const [meRes, empRes] = await Promise.all([
    fetch('/api/me', { credentials: 'same-origin' }),
    fetch(`/api/employees/${employeeId}`, { credentials: 'same-origin' }),
  ]);

  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  if (empRes.status === 403) {
    showMessage(message, 'You don’t have access to this employee.', 'error');
    form.hidden = true;
    return;
  }
  if (empRes.status === 404) {
    showMessage(message, 'Employee not found.', 'error');
    form.hidden = true;
    return;
  }
  target = await empRes.json();

  const isSelf = me.id === target.id;
  const isEmployer = me.role === 'employer';
  backLink.href = isEmployer ? '/employees' : '/';
  if (isSelf) backLink.textContent = '← Home';

  populateForm(target);
  renderAvatar(target, target.profile?.hasPicture ?? false);

  applyPermissions(isEmployer, isSelf);
})();
