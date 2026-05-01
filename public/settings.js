import { t, applyTranslations } from '/i18n.js';
import { showMessage, setBusy } from '/app.js';

import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);
const messageEl = $('message');

const navOrg = $('nav-org');
const navBak = $('nav-bak');
const navCompany = $('nav-company');

// Account form
// Company form
const companySection = $('company');
const companyForm    = $('company-form');
const companyNameInput = $('company-name-input');
const logoPreview    = $('logo-preview');
const logoFile       = $('logo-file');
const logoUploadBtn  = $('logo-upload-btn');
const logoRemoveBtn  = $('logo-remove-btn');

// Org form
const orgSection = $('organization');
const orgForm    = $('org-form');
const defVacation = $('def-vacation');
const defSick     = $('def-sick');
const defAppoint  = $('def-appointment');
const defOther    = $('def-other');
const carryFwd    = $('carry-forward');
const concurrent  = $('concurrent-allowed');
const overridesWrap = $('overrides-table-wrap');

// Backups form
const backupsSection = $('backups');
const backupEnabled   = $('backup-enabled');
const backupSchedule  = $('backup-schedule');
const backupRetention = $('backup-retention');

// Working-time form (now lives inside the Organization section card —
// no separate nav link or section wrapper anymore).
const workingTimeForm    = $('working-time-form');
const dailyHoursInput    = $('daily-hours');
const weeklyHoursInput   = $('weekly-hours');
const wtOverridesWrap    = $('wt-overrides-table-wrap');

let me = null;
let employees = [];

// ---- Rendering ------------------------------------------------------------

function renderOrg(settings) {
  const al = settings.leaves.defaultAllowances;
  defVacation.value = al.vacation ?? 0;
  defSick.value     = al.sick ?? 0;
  defAppoint.value  = al.appointment ?? 0;
  defOther.value    = al.other ?? 0;
  carryFwd.checked  = !!settings.leaves.carryForward;
  concurrent.checked = !!settings.leaves.concurrentAllowed;

  renderOverridesTable(settings.leaves.perEmployeeOverrides ?? {});

  // Backups
  backupEnabled.checked   = !!settings.backups.enabled;
  backupSchedule.value    = settings.backups.schedule ?? 'off';
  backupRetention.value   = settings.backups.retention ?? 7;

  // Working time
  dailyHoursInput.value  = settings.workingTime?.dailyHours  ?? 8;
  weeklyHoursInput.value = settings.workingTime?.weeklyHours ?? 40;
  renderWorkingTimeOverridesTable(settings.workingTime?.perEmployeeOverrides ?? {});
}

function renderOverridesTable(overrides) {
  overridesWrap.innerHTML = '';
  if (employees.length === 0) {
    overridesWrap.textContent = t('settings.overridesEmpty');
    overridesWrap.className = 'subtle';
    return;
  }
  // Wrap in a scroll container so the table can be wider than the
  // viewport on narrow screens (it has 5 columns with fixed-width
  // number inputs). Without this the card itself stretches and gets
  // clipped on mobile.
  overridesWrap.className = 'overrides-scroll';
  const tbl = document.createElement('table');
  tbl.className = 'overrides-table';
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(t('reports.employee'))}</th>
        <th>${escapeHtml(t('leaves.type.vacation'))}</th>
        <th>${escapeHtml(t('leaves.type.sick'))}</th>
        <th>${escapeHtml(t('leaves.type.appointment'))}</th>
        <th>${escapeHtml(t('leaves.type.other'))}</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tbl.querySelector('tbody');
  for (const e of employees) {
    const o = overrides[e.id] ?? {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(e.fullName || e.username)}</td>
      <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="vacation"    value="${o.vacation ?? ''}" placeholder="—"></td>
      <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="sick"        value="${o.sick ?? ''}"     placeholder="—"></td>
      <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="appointment" value="${o.appointment ?? ''}" placeholder="—"></td>
      <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="other"       value="${o.other ?? ''}"    placeholder="—"></td>
    `;
    tbody.appendChild(tr);
  }
  overridesWrap.appendChild(tbl);
}

function renderWorkingTimeOverridesTable(overrides) {
  wtOverridesWrap.innerHTML = '';
  if (employees.length === 0) {
    wtOverridesWrap.textContent = t('settings.overridesEmpty');
    wtOverridesWrap.className = 'subtle';
    return;
  }
  wtOverridesWrap.className = 'overrides-scroll';
  const tbl = document.createElement('table');
  tbl.className = 'overrides-table';
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(t('reports.employee'))}</th>
        <th>${escapeHtml(t('settings.dailyHoursShort'))}</th>
        <th>${escapeHtml(t('settings.weeklyHoursShort'))}</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tbl.querySelector('tbody');
  for (const e of employees) {
    const o = overrides[e.id] ?? {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(e.fullName || e.username)}</td>
      <td><input type="number" min="0" max="24"  step="0.5" data-uid="${e.id}" data-field="dailyHours"  value="${o.dailyHours  ?? ''}" placeholder="—"></td>
      <td><input type="number" min="0" max="168" step="0.5" data-uid="${e.id}" data-field="weeklyHours" value="${o.weeklyHours ?? ''}" placeholder="—"></td>
    `;
    tbody.appendChild(tr);
  }
  wtOverridesWrap.appendChild(tbl);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- Save handlers --------------------------------------------------------

if (orgForm) {
  orgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(messageEl, '');
    const btn = orgForm.querySelector('button[type="submit"]');
    setBusy(btn, true, 'Saving…');

    // Collect per-employee overrides.
    const overrides = {};
    for (const input of overridesWrap.querySelectorAll('input[data-uid]')) {
      const uid = input.dataset.uid;
      const type = input.dataset.type;
      const v = input.value.trim();
      if (v === '') continue;
      if (!overrides[uid]) overrides[uid] = {};
      overrides[uid][type] = Number(v);
    }

    const patch = {
      leaves: {
        defaultAllowances: {
          vacation: Number(defVacation.value || 0),
          sick: Number(defSick.value || 0),
          appointment: Number(defAppoint.value || 0),
          other: Number(defOther.value || 0),
        },
        perEmployeeOverrides: overrides,
        carryForward: carryFwd.checked,
        concurrentAllowed: concurrent.checked,
      },
    };

    try {
      const res = await fetch('/api/settings/org', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.failedToSave'));
      showMessage(messageEl, t('settings.savedOrg'), 'success');
    } catch (err) {
      showMessage(messageEl, err.message, 'error');
    }
    setBusy(btn, false);
  });
}

if (workingTimeForm) {
  workingTimeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMessage(messageEl, '');
    const btn = workingTimeForm.querySelector('button[type="submit"]');
    setBusy(btn, true, 'Saving…');

    // Collect per-employee overrides from the table — empty input means
    // "no override for this field". A user with both fields empty is
    // omitted from the patch entirely (same shape the storage cleaner
    // expects; users with empty objects are silently dropped there too).
    const overrides = {};
    if (wtOverridesWrap) {
      for (const input of wtOverridesWrap.querySelectorAll('input[data-uid]')) {
        const uid = input.dataset.uid;
        const field = input.dataset.field;
        const v = input.value.trim();
        if (v === '') continue;
        if (!overrides[uid]) overrides[uid] = {};
        overrides[uid][field] = Number(v);
      }
    }

    const patch = {
      workingTime: {
        dailyHours: Number(dailyHoursInput.value || 8),
        weeklyHours: Number(weeklyHoursInput.value || 40),
        perEmployeeOverrides: overrides,
      },
    };
    try {
      const res = await fetch('/api/settings/org', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.failedToSave'));
      showMessage(messageEl, t('settings.savedWorkingTime'), 'success');
    } catch (err) {
      showMessage(messageEl, err.message, 'error');
    }
    setBusy(btn, false);
  });
}

// ---- Bootstrap ------------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();

  // Always: account prefs for the current user.

  if (me.role === 'employer') {
    navCompany.hidden = false;
    navOrg.hidden = false;
    navBak.hidden = false;
    companySection.hidden = false;
    orgSection.hidden = false;
    backupsSection.hidden = false;

    // Load employees for the overrides table and the org settings.
    const [empRes, orgRes, brandRes] = await Promise.all([
      fetch('/api/employees',   { credentials: 'same-origin' }),
      fetch('/api/settings/org', { credentials: 'same-origin' }),
      fetch('/api/branding',    { credentials: 'same-origin' }),
    ]);
    const empData = await empRes.json();
    const orgData = await orgRes.json();
    const brandData = await brandRes.json();
    employees = empData.employees;
    renderOrg(orgData.settings);
    renderCompany(orgData.settings.company, brandData.hasLogo);
  }
})();

// ---- Company section: render + handlers ----------------------------------

let stagedLogoBlob = null; // holds the resized PNG Blob between select and save
let logoShouldDelete = false;

function renderCompany(company, hasLogo) {
  companyNameInput.value = company?.name ?? '';
  if (hasLogo) {
    logoPreview.innerHTML = `<img src="/api/branding/logo?t=${Date.now()}" alt="Logo preview">`;
    logoRemoveBtn.hidden = false;
  } else {
    logoPreview.innerHTML = `<span class="logo-preview__placeholder">No logo</span>`;
    logoRemoveBtn.hidden = true;
  }
}

/**
 * Resize an image file to a max 256×256 PNG blob, preserving aspect ratio.
 * Same pattern as employee pictures — keeps the server dep-free.
 */
function resizeToPngBlob(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not read image'));
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
    };
    img.src = URL.createObjectURL(file);
  });
}

logoUploadBtn.addEventListener('click', () => logoFile.click());

logoFile.addEventListener('change', async () => {
  const file = logoFile.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    showMessage(messageEl, 'Please choose an image file.', 'error');
    return;
  }
  try {
    stagedLogoBlob = await resizeToPngBlob(file);
    logoShouldDelete = false;
    const url = URL.createObjectURL(stagedLogoBlob);
    logoPreview.innerHTML = `<img src="${url}" alt="Logo preview">`;
    logoRemoveBtn.hidden = false;
    showMessage(messageEl, 'Image selected. Click "Save company settings" to upload.', 'success');
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
  }
});

logoRemoveBtn.addEventListener('click', () => {
  stagedLogoBlob = null;
  logoShouldDelete = true;
  logoPreview.innerHTML = `<span class="logo-preview__placeholder">No logo</span>`;
  logoRemoveBtn.hidden = true;
  showMessage(messageEl, 'Logo will be removed when you save.', 'success');
});

companyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = companyForm.querySelector('button[type="submit"]');
  setBusy(btn, true, 'Saving…');

  try {
    // 1. Save name (via org settings patch).
    const name = companyNameInput.value.trim();
    const namePatch = { company: { name: name === '' ? null : name } };
    const nameRes = await fetch('/api/settings/org', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(namePatch),
    });
    if (!nameRes.ok) {
      const err = await nameRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save name');
    }

    // 2. Save logo change (upload, delete, or no-op).
    if (stagedLogoBlob) {
      const fd = new FormData();
      fd.append('logo', stagedLogoBlob, 'logo.png');
      const upRes = await fetch('/api/branding/logo', {
        method: 'PUT',
        credentials: 'same-origin',
        body: fd,
      });
      if (!upRes.ok) {
        const err = await upRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload logo');
      }
      stagedLogoBlob = null;
    } else if (logoShouldDelete) {
      const delRes = await fetch('/api/branding/logo', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!delRes.ok) {
        const err = await delRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to remove logo');
      }
      logoShouldDelete = false;
    }

    showMessage(messageEl, 'Company settings saved. Refresh to see the top bar update.', 'success');
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
  }
  setBusy(btn, false);
});
