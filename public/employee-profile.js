import { t, translateError, applyTranslations } from '/i18n.js';
import { showMessage, setBusy, flashSaved } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

// Pull the employee id out of the URL. Handles two shapes:
//   /employees/<id>           — legacy (no longer used; kept for back-compat)
//   /employees/<id>/profile   — current canonical route under 0.16.4
const _segs = window.location.pathname.split('/').filter(Boolean);
const employeeId = _segs[_segs.indexOf('employees') + 1];

const $ = (id) => document.getElementById(id);
const titleEl   = $('page-title');
const subtitleEl = $('profile-subtitle');
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
const deactivateBtn = $('deactivate-btn');
const cancelLink = $('cancel-link');
const roleSeg   = $('role-segmented');
const roleCardLabel = $('role-card-label');

let me;
let target;


function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

// Deterministic avatar hue — mirrors public/employee.js hue().
function hue(s) { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; }

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
    avatarEl.style.setProperty('--hue', hue(emp.profile?.fullName || emp.username));
    removePic.hidden = true;
  }
}

function applyPermissions(isEmployer, isSelf, isActive) {
  // Employees can't edit position or comments on any profile.
  const readonlyForEmployee = ['position', 'comments'];
  if (!isEmployer) {
    for (const name of readonlyForEmployee) {
      const el = $(name);
      el.readOnly = true;
      // Drop `required` for readonly fields on the employee view —
      // an empty `position` from before mandatory-fields shipped
      // would otherwise block the employee from saving anything,
      // and they can't edit it anyway.
      el.required = false;
      const hint = $(`${name}-hint`);
      if (hint) hint.hidden = false;
    }
  }
  const canManage = isEmployer && !isSelf;
  // Active account → show Deactivate in the footer, hide danger zone.
  // Deactivated account → hide Deactivate, reveal permanent-delete danger zone.
  deactivateBtn.hidden = !(canManage && isActive);
  dangerZone.hidden    = !(canManage && !isActive);
}

function populateForm(emp) {
  $('username-display').textContent = emp.username;
  titleEl.textContent = emp.profile?.fullName || emp.username;
  subtitleEl.textContent = t('employee.editingProfile', { role: t('employee.role.' + emp.role) });

  // Segmented role control — mark the current role "on"; control is inert.
  for (const opt of roleSeg.querySelectorAll('.seg__opt')) {
    opt.classList.toggle('seg__opt--on', opt.dataset.role === emp.role);
  }

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
  out.textContent = t('employee.ageYears', { n: age });
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
      throw new Error(translateError(data.errorCode, data.error || `Upload failed (${res.status})`));
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
    flashSaved(saveBtn, { word: t('employee.savedFlash'), restore: t('employee.savePic'), flashClass: 'prof-btn--flash' });
  } else {
    const msg = translateError(data.errorCode, data.error || 'Save failed');
    showMessage(message, msg, 'error');
    setBusy(saveBtn, false);
  }
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

deactivateBtn.addEventListener('click', async () => {
  if (!confirm(t('employee.deactivateConfirm', { name: target.profile?.fullName || target.username }))) return;
  const res = await fetch(`/api/employees/${employeeId}/deactivate`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    window.location.href = '/employees';
  } else {
    showMessage(message, translateError(data.errorCode, data.error || 'Failed'), 'error');
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!confirm(t('employee.deleteConfirm', { name: target.profile?.fullName || target.username }))) return;
  const res = await fetch(`/api/employees/${employeeId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    window.location.href = '/employees';
  } else {
    showMessage(message, translateError(data.errorCode, data.error || 'Delete failed'), 'error');
  }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async () => {
  const [meRes, empRes, orgRes] = await Promise.all([
    fetch('/api/me', { credentials: 'same-origin' }),
    fetch(`/api/employees/${employeeId}`, { credentials: 'same-origin' }),
    fetch('/api/settings/org', { credentials: 'same-origin' }).catch(() => null),
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

  // Role card label: "Role at {org}" when we can read the org name.
  try {
    if (orgRes && orgRes.ok) {
      const org = await orgRes.json();
      const name = org?.settings?.company?.name;
      if (name) roleCardLabel.textContent = t('employee.cardRoleAt', { org: name });
    }
  } catch { /* keep the generic "Role" label */ }

  const isSelf = me.id === target.id;
  const isEmployer = me.role === 'employer';
  const isActive = target.active !== false;
  // Back-link / cancel target depends on context:
  //   - employer viewing someone else's profile → that employee's detail
  //   - employer viewing own profile → home
  //   - non-employer (employee viewing own) → home
  if (isEmployer && !isSelf) {
    backLink.href = `/employees/${encodeURIComponent(employeeId)}`;
    cancelLink.href = '/employees';
  } else {
    backLink.href = '/';
    cancelLink.href = '/';
  }
  if (isSelf) backLink.textContent = '← Home';

  populateForm(target);
  renderAvatar(target, target.profile?.hasPicture ?? false);

  applyPermissions(isEmployer, isSelf, isActive);
})();
