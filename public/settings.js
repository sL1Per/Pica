import { showMessage, setBusy } from '/app.js';

const $ = (id) => document.getElementById(id);
const messageEl = $('message');

const navOrg = $('nav-org');
const navBak = $('nav-bak');

// Account form
const accountForm = $('account-form');
const languageEl  = $('language');
const colorModeRadios = document.querySelectorAll('input[name="colorMode"]');

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

let me = null;
let employees = [];

// ---- Color mode application ----------------------------------------------

function applyColorMode(mode) {
  // `system` → remove the attribute so CSS falls back to @media(prefers-color-scheme)
  const root = document.documentElement;
  if (mode === 'dark' || mode === 'light') {
    root.setAttribute('data-theme', mode);
  } else {
    root.removeAttribute('data-theme');
  }
}

// ---- Rendering ------------------------------------------------------------

function renderAccount(prefs) {
  languageEl.value = prefs.language;
  for (const r of colorModeRadios) {
    r.checked = r.value === prefs.colorMode;
  }
  applyColorMode(prefs.colorMode);
}

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
}

function renderOverridesTable(overrides) {
  overridesWrap.innerHTML = '';
  if (employees.length === 0) {
    overridesWrap.textContent = 'No employees yet.';
    overridesWrap.className = 'subtle';
    return;
  }
  overridesWrap.className = '';
  const t = document.createElement('table');
  t.className = 'overrides-table';
  t.innerHTML = `
    <thead>
      <tr>
        <th>Employee</th>
        <th>Vacation</th>
        <th>Sick</th>
        <th>Appointment</th>
        <th>Other</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = t.querySelector('tbody');
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
  overridesWrap.appendChild(t);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- Save handlers --------------------------------------------------------

accountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage(messageEl, '');
  const btn = accountForm.querySelector('button');
  setBusy(btn, true, 'Saving…');

  const colorMode = [...colorModeRadios].find((r) => r.checked)?.value;
  const patch = { language: languageEl.value, colorMode };

  try {
    const res = await fetch('/api/settings/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save');
    applyColorMode(data.prefs.colorMode);
    showMessage(messageEl, 'Account settings saved.', 'success');
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
  }
  setBusy(btn, false);
});

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
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      showMessage(messageEl, 'Organization settings saved.', 'success');
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
  const prefsRes = await fetch('/api/settings/me', { credentials: 'same-origin' });
  const prefsData = await prefsRes.json();
  renderAccount(prefsData.prefs);

  if (me.role === 'employer') {
    navOrg.hidden = false;
    navBak.hidden = false;
    orgSection.hidden = false;
    backupsSection.hidden = false;

    // Load employees for the overrides table and the org settings.
    const [empRes, orgRes] = await Promise.all([
      fetch('/api/employees',   { credentials: 'same-origin' }),
      fetch('/api/settings/org', { credentials: 'same-origin' }),
    ]);
    const empData = await empRes.json();
    const orgData = await orgRes.json();
    employees = empData.employees;
    renderOrg(orgData.settings);
  }
})();
