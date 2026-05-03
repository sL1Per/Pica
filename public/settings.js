import { t, applyTranslations, fmtDateTime } from '/i18n.js';
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
const backupsMessageEl = $('backups-message');
const backupsTableBody = $('backups-table')?.querySelector('tbody');
const backupsEmptyEl   = $('backups-empty');
const createBackupBtn  = $('create-backup-btn');

// Drop 2: restore form, schedule save, lockdown banner.
const restoreLockdownBanner = $('restore-lockdown-banner');
const restoreFileInput      = $('restore-file');
const restoreConfirmInput   = $('restore-confirm');
const restoreBtn            = $('restore-btn');
const saveScheduleBtn       = $('save-schedule-btn');

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
    renderBackupsForm(orgData.settings.backups);

    // Drop 2: check whether the server is in post-restore lockdown.
    // If so, the banner shows and controls are disabled; no point
    // listing backups (the user needs to restart, period).
    await checkRestoreStatus();

    // Load the backups list (separate fetch — failure here shouldn't
    // block the rest of the settings page from rendering).
    loadBackupsList().catch(() => { /* error already shown by loader */ });
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

// ---- Backups: load + render + create + download --------------------------

function escapeHtmlBak(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Format a byte count for display: "1.2 KB" / "3.4 MB". */
function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderBackupsList(backups) {
  if (!backupsTableBody) return;
  backupsTableBody.innerHTML = '';
  if (!backups || backups.length === 0) {
    backupsEmptyEl.hidden = false;
    return;
  }
  backupsEmptyEl.hidden = true;
  for (const b of backups) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtmlBak(fmtDateTime(b.createdAt))}</td>
      <td><code>${escapeHtmlBak(b.id)}</code></td>
      <td class="right">${escapeHtmlBak(fmtSize(b.sizeBytes))}</td>
      <td>
        <a class="btn-link" href="/api/backups/${encodeURIComponent(b.id)}/download" download>${escapeHtmlBak(t('settings.backupsDownload'))}</a>
        &middot;
        <button type="button" class="btn-link btn-link--danger" data-action="delete" data-id="${escapeHtmlBak(b.id)}">${escapeHtmlBak(t('settings.backupsDelete'))}</button>
      </td>
    `;
    backupsTableBody.appendChild(tr);
  }
}

// Event-delegated Delete button. Single listener handles every row,
// so we don't have to re-attach on every list re-render.
backupsTableBody?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="delete"]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (!id) return;
  if (!window.confirm(t('settings.backupsDeleteConfirm', { id }))) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/backups/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    showMessage(backupsMessageEl, t('settings.backupsDeletedFmt', { id }), 'success');
    await loadBackupsList();
  } catch (err) {
    btn.disabled = false;
    showMessage(backupsMessageEl, err.message, 'error');
  }
});

async function loadBackupsList() {
  try {
    const res = await fetch('/api/backups', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderBackupsList(data.backups);
  } catch (err) {
    showMessage(backupsMessageEl, t('settings.backupsLoadError'), 'error');
    throw err;
  }
}

createBackupBtn?.addEventListener('click', async () => {
  setBusy(createBackupBtn, true);
  try {
    const res = await fetch('/api/backups', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    showMessage(
      backupsMessageEl,
      t('settings.backupsCreatedFmt', { id: data.backup.id, size: fmtSize(data.backup.sizeBytes) }),
      'success',
    );
    await loadBackupsList();
  } catch (err) {
    showMessage(backupsMessageEl, err.message, 'error');
  }
  setBusy(createBackupBtn, false);
});

// ---- Drop 2: restore, lockdown banner, schedule save --------------------

/**
 * Read the file picker's selected file as a Buffer-like Uint8Array.
 * Returns null if no file is selected.
 */
async function readSelectedBackupBytes() {
  const file = restoreFileInput?.files?.[0];
  if (!file) return null;
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Toggle the Restore button enabled state based on:
 *   - a file is selected, AND
 *   - the confirmation textbox contains the literal "RESTORE"
 */
function updateRestoreButtonEnabled() {
  if (!restoreBtn) return;
  const hasFile = !!restoreFileInput?.files?.[0];
  const typed   = (restoreConfirmInput?.value ?? '').trim() === 'RESTORE';
  restoreBtn.disabled = !(hasFile && typed);
}

restoreFileInput?.addEventListener('change', updateRestoreButtonEnabled);
restoreConfirmInput?.addEventListener('input', updateRestoreButtonEnabled);

restoreBtn?.addEventListener('click', async () => {
  // Triple-check: button shouldn't be enabled, but defend anyway.
  if (restoreBtn.disabled) return;
  const bytes = await readSelectedBackupBytes();
  if (!bytes) {
    showMessage(backupsMessageEl, t('settings.restoreNoFile'), 'error');
    return;
  }

  setBusy(restoreBtn, true);
  try {
    const res = await fetch('/api/backups/restore', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Pica-Confirm-Restore': 'RESTORE',
      },
      body: bytes,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Translate the errorCode if we have a translation; fall back
      // to the server's English message.
      const fallback = data.error || `HTTP ${res.status}`;
      const localized = data.errorCode
        ? (t('errors.' + data.errorCode) === '[errors.' + data.errorCode + ']'
            ? fallback
            : t('errors.' + data.errorCode))
        : fallback;
      throw new Error(localized);
    }

    // Success path: server has flipped restoreCompleted to true. Show
    // the lockdown banner and disable everything else.
    showMessage(
      backupsMessageEl,
      t('settings.restoreSuccessFmt', { count: String(data.restoredEntries ?? '?') }),
      'success',
    );
    showLockdownBanner();
    disableAllBackupControls();
  } catch (err) {
    showMessage(backupsMessageEl, err.message, 'error');
    setBusy(restoreBtn, false);
  }
  // Don't clear setBusy on success — we want the button to stay
  // visually-busy until restart.
});

/**
 * On page load, ask the server whether a restore is pending. If so,
 * show the banner and disable backup controls so the user can't
 * accidentally trigger more work.
 */
async function checkRestoreStatus() {
  try {
    const res = await fetch('/api/backups/status', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.restoreCompleted) {
      showLockdownBanner();
      disableAllBackupControls();
    }
  } catch { /* network blip — non-fatal, just skip */ }
}

function showLockdownBanner() {
  if (restoreLockdownBanner) restoreLockdownBanner.hidden = false;
}

function disableAllBackupControls() {
  // Disable everything in the backups section except the lockdown
  // banner itself. The user can still see the page; they just can't
  // do anything that would touch state until they restart.
  for (const el of [
    createBackupBtn,
    restoreBtn,
    restoreFileInput,
    restoreConfirmInput,
    saveScheduleBtn,
    $('backup-enabled'),
    $('backup-schedule'),
    $('backup-retention'),
  ]) {
    if (el) el.disabled = true;
  }
  // Also disable the per-row Delete buttons.
  if (backupsTableBody) {
    for (const btn of backupsTableBody.querySelectorAll('button[data-action="delete"]')) {
      btn.disabled = true;
    }
  }
}

// ---- Schedule + retention form ------------------------------------------

/**
 * Populate the schedule form fields from a settings object's
 * `backups` sub-object. Called when org settings are loaded into the
 * page.
 */
function renderBackupsForm(backups) {
  const enabled = $('backup-enabled');
  const schedule = $('backup-schedule');
  const retention = $('backup-retention');
  if (!enabled || !schedule || !retention) return;
  enabled.checked = !!backups?.enabled;
  schedule.value  = backups?.schedule ?? 'off';
  retention.value = backups?.retention ?? 7;
}

saveScheduleBtn?.addEventListener('click', async () => {
  const enabled = $('backup-enabled')?.checked ?? false;
  const schedule = $('backup-schedule')?.value ?? 'off';
  const retention = parseInt($('backup-retention')?.value ?? '7', 10);

  setBusy(saveScheduleBtn, true);
  try {
    const res = await fetch('/api/settings/org', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backups: { enabled, schedule, retention },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    showMessage(backupsMessageEl, t('settings.backupsScheduleSaved'), 'success');
  } catch (err) {
    showMessage(backupsMessageEl, err.message, 'error');
  }
  setBusy(saveScheduleBtn, false);
});
