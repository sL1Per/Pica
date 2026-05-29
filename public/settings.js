import { t, applyTranslations, fmtDateTime } from '/i18n.js';
import { toast, setBusy, flashSaved as flashBtn } from '/app.js';
import { mountTopBar, mountFooter } from '/topbar.js';

mountTopBar();
mountFooter();
applyTranslations();

// ---- Small helpers --------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Static stroke-icon paths (reused from topbar.js' set). Path data is a
// literal — never interpolated with user input — so innerHTML is safe.
const ICONS = {
  company: '<path d="M4 11l8-6 8 6v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  organization: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3 2.8-5 6-5s6 2 6 5"/><path d="M16 4.5a3 3 0 0 1 0 6"/><path d="M21 20c0-2.4-1.6-4.3-4-4.8"/>',
  notifications: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  backups: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  security: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  check: '<path d="M5 12l4 4 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function svgIcon(paths, size = 18, sw = 1.7) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" `
    + `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Parse the active tab from a URL search string; unknown → default. Pure. */
function parseTab(search, def = 'company') {
  const ids = ['company', 'organization', 'notifications', 'backups', 'security'];
  const v = new URLSearchParams(search).get('tab');
  return ids.includes(v) ? v : def;
}

/** Build a card <section> shell with a serif title + optional sub. */
function card(titleText, subText, variant = '') {
  const sec = document.createElement('section');
  sec.className = 'set-card' + (variant ? ' ' + variant : '');
  const head = document.createElement('div');
  head.className = 'set-card__head';
  const h = document.createElement('h2');
  h.className = 'set-card__title';
  h.textContent = titleText;
  head.appendChild(h);
  if (subText) {
    const p = document.createElement('p');
    p.className = 'set-card__sub';
    p.textContent = subText;
    head.appendChild(p);
  }
  sec.appendChild(head);
  return sec;
}

/** Settings save-button flash. Delegates the timing/label-swap to the shared
 *  flashSaved in /app.js, supplying Settings' icon content + set-btn--flash. */
function flashSaved(btn, labelText) {
  flashBtn(btn, {
    html: svgIcon(ICONS.check, 16, 2.2) + `<span>${escapeHtml(t('settings.flashSaved'))}</span>`,
    restore: labelText,
    flashClass: 'set-btn--flash',
    startDisabled: false,
    beforeFlash: (b) => { delete b.dataset.label; },
  });
}

/** Format a byte count: "1.2 KB" / "3.4 MB". (Ported byte-equivalent.) */
function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Tab router -----------------------------------------------------------

const tabContent = document.getElementById('tab-content');
const tabsEl = document.getElementById('set-tabs');
const chipsEl = document.getElementById('set-chips');

let currentAbort = null;
let me = null;
let employees = [];

const TABS = [
  { id: 'company',       labelKey: 'settings.tab.company',  icon: ICONS.company,       render: renderCompany },
  { id: 'organization',  labelKey: 'settings.tab.org',      icon: ICONS.organization,  render: renderOrg },
  { id: 'notifications', labelKey: 'settings.tab.notif',    icon: ICONS.notifications, render: renderNotifications },
  { id: 'backups',       labelKey: 'settings.tab.backups',  icon: ICONS.backups,       render: renderBackups },
  { id: 'security',      labelKey: 'settings.tab.security', icon: ICONS.security,      render: renderSecurityEntry },
];

function mountTabs() {
  tabsEl.replaceChildren();
  chipsEl.replaceChildren();
  for (const tab of TABS) {
    // Desktop sidebar button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-tab';
    btn.dataset.tab = tab.id;
    btn.innerHTML = `<span class="set-tab__bar"></span>`
      + `<span class="set-tab__icon">${svgIcon(tab.icon, 15, 1.7)}</span>`
      + `<span>${escapeHtml(t(tab.labelKey))}</span>`;
    btn.addEventListener('click', () => switchTab(tab.id));
    tabsEl.appendChild(btn);

    // Mobile chip
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'set-chip';
    chip.dataset.tab = tab.id;
    chip.textContent = t(tab.labelKey);
    chip.addEventListener('click', () => switchTab(tab.id));
    chipsEl.appendChild(chip);
  }
}

function setActive(id) {
  for (const el of tabsEl.querySelectorAll('.set-tab')) {
    el.classList.toggle('set-tab--active', el.dataset.tab === id);
  }
  for (const el of chipsEl.querySelectorAll('.set-chip')) {
    el.classList.toggle('set-chip--active', el.dataset.tab === id);
  }
}

function switchTab(id) {
  const tab = TABS.find((x) => x.id === id) || TABS[0];
  history.replaceState({}, '', '?tab=' + tab.id);
  setActive(tab.id);
  // Cancel any in-flight fetch from the previous tab.
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();
  tabContent.replaceChildren();
  tab.render(tabContent, currentAbort.signal);
}

// ---- Bootstrap ------------------------------------------------------------

/** Render only the post-restore lockdown banner (every API but
    /api/backups/status returns 503 in this state). */
function renderLockdownOnly() {
  tabsEl.hidden = true;
  chipsEl.hidden = true;
  const sec = card(t('settings.backupsHeading'), '');
  sec.insertAdjacentHTML('beforeend', `
    <div class="lockdown-banner">
      <strong>${escapeHtml(t('settings.restorePendingTitle'))}</strong>
      <p>${escapeHtml(t('settings.restorePendingBody'))}</p>
    </div>`);
  tabContent.appendChild(sec);
}

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  if (!meRes.ok) {
    // Likely a post-restore lockdown: /api/me 503s while
    // /api/backups/status stays reachable. Show the restart banner.
    try {
      const st = await fetch('/api/backups/status', { credentials: 'same-origin' });
      if (st.ok && (await st.json()).restoreCompleted) { renderLockdownOnly(); return; }
    } catch { /* fall through to generic notice */ }
    tabContent.appendChild(card(t('settings.title'), t('settings.employerOnly')));
    tabsEl.hidden = true; chipsEl.hidden = true;
    return;
  }
  me = await meRes.json();

  if (me.role !== 'employer') {
    const sec = card(t('settings.title'), t('settings.employerOnly'));
    tabContent.appendChild(sec);
    tabsEl.hidden = true;
    chipsEl.hidden = true;
    return;
  }

  mountTabs();
  switchTab(parseTab(location.search));
})();

// Treat an aborted fetch as a benign tab-switch, not an error to surface.
function isAbort(err) { return err && err.name === 'AbortError'; }

// =====================================================================
// COMPANY TAB
// =====================================================================

function renderCompany(root, signal) {
  const sec = card(t('settings.companyHeading'), t('settings.companySubtitle'));

  const form = document.createElement('form');
  form.autocomplete = 'off';
  form.innerHTML = `
    <div class="set-field">
      <label for="company-name-input">${escapeHtml(t('settings.companyName'))}</label>
      <input type="text" id="company-name-input" maxlength="80" placeholder="Pica">
    </div>
    <div class="set-field">
      <label>${escapeHtml(t('settings.companyLogo'))}</label>
      <div class="logo-row">
        <div id="logo-preview" class="logo-preview">
          <span class="logo-preview__placeholder">${escapeHtml(t('settings.logoNone'))}</span>
        </div>
        <div class="logo-actions">
          <input type="file" id="logo-file" accept="image/*" hidden>
          <div class="inline-row">
            <button type="button" id="logo-upload-btn" class="set-btn set-btn--ghost">${escapeHtml(t('settings.logoChoose'))}</button>
            <button type="button" id="logo-remove-btn" class="set-btn set-btn--danger-ghost" hidden>${escapeHtml(t('settings.removeLogo'))}</button>
          </div>
          <p class="set-helper">${escapeHtml(t('settings.logoSquareHint'))}</p>
        </div>
      </div>
    </div>
    <button type="submit" class="set-btn set-btn--primary">${escapeHtml(t('settings.companySave'))}</button>
  `;
  sec.appendChild(form);
  root.appendChild(sec);

  const companyNameInput = form.querySelector('#company-name-input');
  const logoPreview = form.querySelector('#logo-preview');
  const logoFile = form.querySelector('#logo-file');
  const logoUploadBtn = form.querySelector('#logo-upload-btn');
  const logoRemoveBtn = form.querySelector('#logo-remove-btn');
  const saveBtn = form.querySelector('button[type="submit"]');
  const saveLabel = saveBtn.textContent;

  let stagedLogoBlob = null;   // resized PNG Blob between select and save
  let logoShouldDelete = false;

  function setPreview(hasLogo) {
    if (hasLogo) {
      logoPreview.innerHTML = `<img src="/api/branding/logo?t=${Date.now()}" alt="Logo preview">`;
      logoRemoveBtn.hidden = false;
    } else {
      logoPreview.innerHTML = `<span class="logo-preview__placeholder">${escapeHtml(t('settings.logoNone'))}</span>`;
      logoRemoveBtn.hidden = true;
    }
  }

  // Resize an image to a max 256×256 PNG blob, preserving aspect ratio.
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
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
      };
      img.src = URL.createObjectURL(file);
    });
  }

  logoUploadBtn.addEventListener('click', () => logoFile.click());

  logoFile.addEventListener('change', async () => {
    const file = logoFile.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast(t('settings.logoNotImage'), 'error'); return; }
    try {
      stagedLogoBlob = await resizeToPngBlob(file);
      logoShouldDelete = false;
      const url = URL.createObjectURL(stagedLogoBlob);
      logoPreview.innerHTML = `<img src="${url}" alt="Logo preview">`;
      logoRemoveBtn.hidden = false;
    } catch (err) { toast(err.message, 'error'); }
  });

  logoRemoveBtn.addEventListener('click', () => {
    stagedLogoBlob = null;
    logoShouldDelete = true;
    logoPreview.innerHTML = `<span class="logo-preview__placeholder">${escapeHtml(t('settings.logoNone'))}</span>`;
    logoRemoveBtn.hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setBusy(saveBtn, true, t('settings.flashSaved') + '…');
    try {
      // 1. Save name (via org settings patch).
      const name = companyNameInput.value.trim();
      const nameRes = await fetch('/api/settings/org', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ company: { name: name === '' ? null : name } }),
      });
      if (!nameRes.ok) {
        const err = await nameRes.json().catch(() => ({}));
        throw new Error(err.error || t('settings.failedToSave'));
      }
      // 2. Save logo change (upload, delete, or no-op).
      if (stagedLogoBlob) {
        const fd = new FormData();
        fd.append('logo', stagedLogoBlob, 'logo.png');
        const upRes = await fetch('/api/branding/logo', { method: 'PUT', credentials: 'same-origin', body: fd });
        if (!upRes.ok) { const err = await upRes.json().catch(() => ({})); throw new Error(err.error || t('settings.failedToSave')); }
        stagedLogoBlob = null;
      } else if (logoShouldDelete) {
        const delRes = await fetch('/api/branding/logo', { method: 'DELETE', credentials: 'same-origin' });
        if (!delRes.ok) { const err = await delRes.json().catch(() => ({})); throw new Error(err.error || t('settings.failedToSave')); }
        logoShouldDelete = false;
      }
      flashSaved(saveBtn, saveLabel);
    } catch (err) {
      setBusy(saveBtn, false);
      toast(err.message, 'error');
    }
  });

  // Load company name + logo state.
  (async () => {
    try {
      const [orgRes, brandRes] = await Promise.all([
        fetch('/api/settings/org', { credentials: 'same-origin', signal }),
        fetch('/api/branding', { credentials: 'same-origin', signal }),
      ]);
      const orgData = await orgRes.json();
      const brandData = await brandRes.json();
      companyNameInput.value = orgData.settings.company?.name ?? '';
      setPreview(brandData.hasLogo);
    } catch (err) { if (!isAbort(err)) toast(t('settings.failedToSave'), 'error'); }
  })();
}

// =====================================================================
// ORGANIZATION TAB
// =====================================================================

function renderOrg(root, signal) {
  // --- Card 1: Leave allowances + carry + per-employee overrides ---
  const c1 = card(t('settings.allowanceCardTitle'), t('settings.allowanceCardSub'));
  c1.insertAdjacentHTML('beforeend', `
    <div class="allowance-grid">
      ${['vacation', 'sick', 'appointment', 'other'].map((k) => `
        <div class="set-field">
          <label for="def-${k}">${escapeHtml(t('leaves.type.' + k))}</label>
          <input type="number" id="def-${k}" min="0" max="365" step="0.5">
        </div>`).join('')}
    </div>
    <label class="set-check">
      <input type="checkbox" id="carry-forward">
      <span>${escapeHtml(t('settings.carryForwardLabel'))}</span>
    </label>
    <div class="set-field set-field--narrow" id="carry-expires-wrap" hidden>
      <label for="carry-expires-at">${escapeHtml(t('settings.carryExpiresLabel'))}</label>
      <input type="text" id="carry-expires-at" pattern="\\d{2}-\\d{2}" maxlength="5" placeholder="03-31" inputmode="numeric">
      <p class="set-helper">${escapeHtml(t('settings.carryExpiresHelperShort'))}</p>
    </div>
    <h3 class="set-section">${escapeHtml(t('settings.overridesHeading'))}</h3>
    <p class="set-helper">${escapeHtml(t('settings.overridesSubtitle'))}</p>
    <div id="overrides-table-wrap" class="set-helper">${escapeHtml(t('settings.loadingEmployees'))}</div>
  `);

  // --- Card 2: Leave policy (concurrent + blocked dates) ---
  const c2 = card(t('settings.leavePolicyHeading'), t('settings.leavePolicyCardSub'));
  c2.insertAdjacentHTML('beforeend', `
    <label class="set-check">
      <input type="checkbox" id="concurrent-allowed">
      <span>${escapeHtml(t('settings.concurrentLabel'))}</span>
    </label>
    <h3 class="set-section">${escapeHtml(t('settings.blockedHeading'))}</h3>
    <p class="set-helper">${escapeHtml(t('settings.blockedHint'))}</p>
    <div id="blocked-ranges" class="blocked-ranges"></div>
    <button type="button" id="blocked-add" class="set-btn set-btn--add">${svgIcon(ICONS.plus, 14, 2)}<span>${escapeHtml(t('settings.blockedAdd'))}</span></button>
  `);

  // --- Card 3: Working time ---
  const c3 = card(t('settings.workingTimeHeading'), t('settings.workingTimeCardSub'));
  c3.insertAdjacentHTML('beforeend', `
    <h3 class="set-section">${escapeHtml(t('settings.defaultTargets'))}</h3>
    <div class="grid-2-narrow">
      <div class="set-field">
        <label for="daily-hours">${escapeHtml(t('settings.dailyHours'))}</label>
        <input type="number" id="daily-hours" min="0" max="24" step="0.5" required>
      </div>
      <div class="set-field">
        <label for="weekly-hours">${escapeHtml(t('settings.weeklyHours'))}</label>
        <input type="number" id="weekly-hours" min="0" max="168" step="0.5" required>
      </div>
    </div>
    <h3 class="set-section">${escapeHtml(t('settings.wtOverridesHeading'))}</h3>
    <p class="set-helper">${escapeHtml(t('settings.wtOverridesHint'))}</p>
    <div id="wt-overrides-table-wrap" class="set-helper">${escapeHtml(t('settings.loadingEmployees'))}</div>
  `);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'set-btn set-btn--primary';
  saveBtn.textContent = t('settings.orgSave');
  const saveLabel = saveBtn.textContent;

  root.append(c1, c2, c3, saveBtn);

  // Element refs
  const defVacation = c1.querySelector('#def-vacation');
  const defSick = c1.querySelector('#def-sick');
  const defAppoint = c1.querySelector('#def-appointment');
  const defOther = c1.querySelector('#def-other');
  const carryFwd = c1.querySelector('#carry-forward');
  const carryWrap = c1.querySelector('#carry-expires-wrap');
  const carryExpiresInput = c1.querySelector('#carry-expires-at');
  const overridesWrap = c1.querySelector('#overrides-table-wrap');
  const concurrent = c2.querySelector('#concurrent-allowed');
  const blockedWrap = c2.querySelector('#blocked-ranges');
  const blockedAddBtn = c2.querySelector('#blocked-add');
  const dailyHoursInput = c3.querySelector('#daily-hours');
  const weeklyHoursInput = c3.querySelector('#weekly-hours');
  const wtOverridesWrap = c3.querySelector('#wt-overrides-table-wrap');

  carryFwd.addEventListener('change', () => { carryWrap.hidden = !carryFwd.checked; });

  // --- Blocked-ranges editor (ported byte-equivalent) ---
  function blockedRowEl(range = { start: '', end: '', label: '' }) {
    const row = document.createElement('div');
    row.className = 'blocked-row';
    const start = document.createElement('input');
    start.type = 'date'; start.className = 'blocked-start'; start.value = range.start || '';
    start.setAttribute('aria-label', t('settings.blockedStart'));
    const end = document.createElement('input');
    end.type = 'date'; end.className = 'blocked-end'; end.value = range.end || '';
    end.setAttribute('aria-label', t('settings.blockedEnd'));
    const label = document.createElement('input');
    label.type = 'text'; label.className = 'blocked-label'; label.maxLength = 80;
    label.value = range.label || ''; label.placeholder = t('settings.blockedLabelPh');
    const syncMin = () => {
      end.min = start.value || '';
      if (start.value && end.value && end.value < start.value) end.value = start.value;
    };
    start.addEventListener('change', syncMin); syncMin();
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'set-btn set-btn--row-remove blocked-del';
    del.textContent = t('settings.blockedRemove');
    del.addEventListener('click', () => {
      row.remove();
      if (blockedWrap.querySelectorAll('.blocked-row').length === 0) renderBlockedEmpty();
    });
    row.append(start, end, label, del);
    return row;
  }
  function renderBlockedEmpty() {
    blockedWrap.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'set-helper blocked-empty';
    p.textContent = t('settings.blockedEmpty');
    blockedWrap.appendChild(p);
  }
  function renderBlockedRanges(ranges) {
    blockedWrap.innerHTML = '';
    if (!ranges.length) { renderBlockedEmpty(); return; }
    for (const r of ranges) blockedWrap.appendChild(blockedRowEl(r));
  }
  blockedAddBtn.addEventListener('click', () => {
    const empty = blockedWrap.querySelector('.blocked-empty');
    if (empty) empty.remove();
    blockedWrap.appendChild(blockedRowEl());
  });
  function collectBlockedRanges() {
    const out = [];
    for (const row of blockedWrap.querySelectorAll('.blocked-row')) {
      const start = row.querySelector('.blocked-start').value.trim();
      let end = row.querySelector('.blocked-end').value.trim();
      const label = row.querySelector('.blocked-label').value.trim();
      if (!start && !end) continue;
      if (!start) throw new Error(t('settings.blockedNeedStart'));
      if (!end) end = start;
      if (end < start) throw new Error(t('settings.blockedBadRange'));
      out.push({ start, end, label });
    }
    return out;
  }

  // --- Override tables (kept as <table> for SR semantics; CSS-restyled) ---
  function renderOverridesTable(overrides) {
    overridesWrap.innerHTML = '';
    overridesWrap.className = 'overrides-scroll';
    if (employees.length === 0) {
      overridesWrap.className = 'set-helper';
      overridesWrap.textContent = t('settings.overridesEmpty');
      return;
    }
    const tbl = document.createElement('table');
    tbl.className = 'overrides-table';
    tbl.innerHTML = `
      <thead><tr>
        <th>${escapeHtml(t('reports.employee'))}</th>
        <th>${escapeHtml(t('leaves.type.vacation'))}</th>
        <th>${escapeHtml(t('leaves.type.sick'))}</th>
        <th>${escapeHtml(t('leaves.type.appointment'))}</th>
        <th>${escapeHtml(t('leaves.type.other'))}</th>
      </tr></thead><tbody></tbody>`;
    const tbody = tbl.querySelector('tbody');
    for (const e of employees) {
      const o = overrides[e.id] ?? {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(e.fullName || e.username)}</td>
        <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="vacation"    value="${o.vacation ?? ''}" placeholder="—"></td>
        <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="sick"        value="${o.sick ?? ''}"     placeholder="—"></td>
        <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="appointment" value="${o.appointment ?? ''}" placeholder="—"></td>
        <td><input type="number" min="0" max="365" step="0.5" data-uid="${e.id}" data-type="other"       value="${o.other ?? ''}"    placeholder="—"></td>`;
      tbody.appendChild(tr);
    }
    overridesWrap.appendChild(tbl);
  }
  function renderWtOverridesTable(overrides) {
    wtOverridesWrap.innerHTML = '';
    wtOverridesWrap.className = 'overrides-scroll';
    if (employees.length === 0) {
      wtOverridesWrap.className = 'set-helper';
      wtOverridesWrap.textContent = t('settings.overridesEmpty');
      return;
    }
    const tbl = document.createElement('table');
    tbl.className = 'overrides-table';
    tbl.innerHTML = `
      <thead><tr>
        <th>${escapeHtml(t('reports.employee'))}</th>
        <th>${escapeHtml(t('settings.dailyHoursShort'))}</th>
        <th>${escapeHtml(t('settings.weeklyHoursShort'))}</th>
      </tr></thead><tbody></tbody>`;
    const tbody = tbl.querySelector('tbody');
    for (const e of employees) {
      const o = overrides[e.id] ?? {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(e.fullName || e.username)}</td>
        <td><input type="number" min="0" max="24"  step="0.5" data-uid="${e.id}" data-field="dailyHours"  value="${o.dailyHours  ?? ''}" placeholder="—"></td>
        <td><input type="number" min="0" max="168" step="0.5" data-uid="${e.id}" data-field="weeklyHours" value="${o.weeklyHours ?? ''}" placeholder="—"></td>`;
      tbody.appendChild(tr);
    }
    wtOverridesWrap.appendChild(tbl);
  }

  // --- Consolidated save: org form first, then working-time form ---
  saveBtn.addEventListener('click', async () => {
    setBusy(saveBtn, true, t('settings.flashSaved') + '…');

    // Org patch
    const overrides = {};
    for (const input of overridesWrap.querySelectorAll('input[data-uid]')) {
      const v = input.value.trim();
      if (v === '') continue;
      const uid = input.dataset.uid;
      (overrides[uid] ||= {})[input.dataset.type] = Number(v);
    }
    let blockedRanges;
    try { blockedRanges = collectBlockedRanges(); }
    catch (err) { setBusy(saveBtn, false); toast(err.message, 'error'); return; }

    const orgPatch = {
      leaves: {
        defaultAllowances: {
          vacation: Number(defVacation.value || 0),
          sick: Number(defSick.value || 0),
          appointment: Number(defAppoint.value || 0),
          other: Number(defOther.value || 0),
        },
        perEmployeeOverrides: overrides,
        carryForward: carryFwd.checked,
        carryForwardExpiresAt: carryExpiresInput.value.trim() || '03-31',
        concurrentAllowed: concurrent.checked,
        blockedRanges,
      },
    };
    try {
      const res = await fetch('/api/settings/org', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(orgPatch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('settings.failedToSave'));
    } catch (err) {
      setBusy(saveBtn, false);
      toast(`${t('settings.orgHeading')}: ${err.message}`, 'error');
      return;   // working-time save skipped when org save fails
    }

    // Working-time patch
    const wtOverrides = {};
    for (const input of wtOverridesWrap.querySelectorAll('input[data-uid]')) {
      const v = input.value.trim();
      if (v === '') continue;
      const uid = input.dataset.uid;
      (wtOverrides[uid] ||= {})[input.dataset.field] = Number(v);
    }
    const wtPatch = {
      workingTime: {
        dailyHours: Number(dailyHoursInput.value || 8),
        weeklyHours: Number(weeklyHoursInput.value || 40),
        perEmployeeOverrides: wtOverrides,
      },
    };
    try {
      const res = await fetch('/api/settings/org', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(wtPatch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('settings.failedToSave'));
      flashSaved(saveBtn, saveLabel);
    } catch (err) {
      setBusy(saveBtn, false);
      toast(`${t('settings.workingTimeHeading')}: ${err.message}`, 'error');
    }
  });

  // --- Load org settings + employees ---
  (async () => {
    try {
      const [empRes, orgRes] = await Promise.all([
        fetch('/api/employees', { credentials: 'same-origin', signal }),
        fetch('/api/settings/org', { credentials: 'same-origin', signal }),
      ]);
      const empData = await empRes.json();
      const orgData = await orgRes.json();
      employees = empData.employees;
      const s = orgData.settings;
      const al = s.leaves.defaultAllowances;
      defVacation.value = al.vacation ?? 0;
      defSick.value = al.sick ?? 0;
      defAppoint.value = al.appointment ?? 0;
      defOther.value = al.other ?? 0;
      carryFwd.checked = !!s.leaves.carryForward;
      carryWrap.hidden = !carryFwd.checked;
      carryExpiresInput.value = s.leaves.carryForwardExpiresAt ?? '03-31';
      concurrent.checked = !!s.leaves.concurrentAllowed;
      renderOverridesTable(s.leaves.perEmployeeOverrides ?? {});
      renderBlockedRanges(s.leaves.blockedRanges ?? []);
      dailyHoursInput.value = s.workingTime?.dailyHours ?? 8;
      weeklyHoursInput.value = s.workingTime?.weeklyHours ?? 40;
      renderWtOverridesTable(s.workingTime?.perEmployeeOverrides ?? {});
    } catch (err) { if (!isAbort(err)) toast(t('settings.failedToSave'), 'error'); }
  })();
}

// =====================================================================
// NOTIFICATIONS TAB
// =====================================================================

function renderNotifications(root, signal) {
  // --- Card 1: SMTP server ---
  const c1 = card(t('settings.notifications.smtp.title'), t('settings.notifications.smtp.subtitle'));
  const status = document.createElement('p');
  status.className = 'set-helper smtp-status';
  c1.querySelector('.set-card__head').appendChild(status);
  c1.insertAdjacentHTML('beforeend', `
    <form id="smtp-form" autocomplete="off">
      <label class="set-check"><input type="checkbox" id="smtp-enabled"><span>${escapeHtml(t('settings.notifications.smtp.enabled'))}</span></label>
      <div class="set-field"><label for="smtp-host">${escapeHtml(t('settings.notifications.smtp.host'))}</label>
        <input type="text" id="smtp-host" maxlength="253" placeholder="smtp.example.com"></div>
      <div class="set-field"><label for="smtp-port">${escapeHtml(t('settings.notifications.smtp.port'))}</label>
        <input type="number" id="smtp-port" min="1" max="65535" placeholder="465"></div>
      <label class="set-check"><input type="checkbox" id="smtp-secure"><span>${escapeHtml(t('settings.notifications.smtp.secure'))}</span></label>
      <div class="set-field"><label for="smtp-user">${escapeHtml(t('settings.notifications.smtp.user'))}</label>
        <input type="text" id="smtp-user" maxlength="254" placeholder="user@example.com" autocomplete="off"></div>
      <div class="set-field"><label for="smtp-pass">${escapeHtml(t('settings.notifications.smtp.password'))}</label>
        <input type="password" id="smtp-pass" maxlength="500" autocomplete="new-password">
        <p id="smtp-pass-hint" class="set-helper" hidden>${escapeHtml(t('settings.notifications.smtp.passwordHint'))}</p></div>
      <div class="set-field"><label for="smtp-from">${escapeHtml(t('settings.notifications.smtp.from'))}</label>
        <input type="text" id="smtp-from" maxlength="254" placeholder="Pica &lt;pica@example.com&gt;"></div>
      <button type="submit" id="smtp-save-btn" class="set-btn set-btn--primary">${escapeHtml(t('settings.notifications.smtp.save'))}</button>
    </form>`);

  // --- Card 2: Notification events ---
  const c2 = card(t('settings.notifications.eventsHeading'), t('settings.notifCardSub'));
  c2.insertAdjacentHTML('beforeend', `
    <form id="notifications-form" autocomplete="off">
      <label class="set-check"><input type="checkbox" id="notif-leave-decision"><span>${escapeHtml(t('settings.notifications.leaveDecision'))}</span></label>
      <label class="set-check"><input type="checkbox" id="notif-correction-decision"><span>${escapeHtml(t('settings.notifications.correctionDecision'))}</span></label>
      <label class="set-check"><input type="checkbox" id="notif-leave-reminder"><span>${escapeHtml(t('settings.notifications.leaveReminder'))}</span></label>
      <button type="submit" class="set-btn set-btn--primary">${escapeHtml(t('settings.notifications.save'))}</button>
    </form>`);

  root.append(c1, c2);

  const smtpForm = c1.querySelector('#smtp-form');
  const smtpEnabled = c1.querySelector('#smtp-enabled');
  const smtpHost = c1.querySelector('#smtp-host');
  const smtpPort = c1.querySelector('#smtp-port');
  const smtpSecure = c1.querySelector('#smtp-secure');
  const smtpUser = c1.querySelector('#smtp-user');
  const smtpPass = c1.querySelector('#smtp-pass');
  const smtpFrom = c1.querySelector('#smtp-from');
  const smtpPassHint = c1.querySelector('#smtp-pass-hint');
  const smtpSaveBtn = c1.querySelector('#smtp-save-btn');
  const smtpSaveLabel = smtpSaveBtn.textContent;
  const notifForm = c2.querySelector('#notifications-form');
  const notifLeaveDecision = c2.querySelector('#notif-leave-decision');
  const notifCorrectionDecision = c2.querySelector('#notif-correction-decision');
  const notifLeaveReminder = c2.querySelector('#notif-leave-reminder');
  const notifSaveBtn = notifForm.querySelector('button[type="submit"]');
  const notifSaveLabel = notifSaveBtn.textContent;

  function setStatus(configured) {
    status.textContent = configured
      ? t('settings.notifications.smtpConfigured')
      : t('settings.notifications.smtpNotConfigured');
  }
  function renderSmtp(mail) {
    if (!mail) return;
    smtpEnabled.checked = !!mail.enabled;
    smtpHost.value = mail.host ?? '';
    smtpPort.value = mail.port ?? 465;
    smtpSecure.checked = mail.secure !== false;
    smtpUser.value = mail.user ?? '';
    smtpFrom.value = mail.from ?? '';
    smtpPass.value = '';                 // write-only: never populated
    smtpPassHint.hidden = !mail.hasPassword;
  }

  smtpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setBusy(smtpSaveBtn, true, t('settings.flashSaved') + '…');
    const patch = {
      enabled: smtpEnabled.checked,
      host: smtpHost.value.trim(),
      port: Number(smtpPort.value) || 465,
      secure: smtpSecure.checked,
      user: smtpUser.value.trim(),
      from: smtpFrom.value.trim(),
    };
    if (smtpPass.value !== '') patch.pass = smtpPass.value;   // keep stored pass when blank
    try {
      const res = await fetch('/api/settings/mail', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.errorCode && t('errors.' + data.errorCode) !== '[errors.' + data.errorCode + ']'
          ? t('errors.' + data.errorCode)
          : (data.error || t('settings.failedToSave'));
        throw new Error(msg);
      }
      renderSmtp(data.mail);
      setStatus(data.mailConfigured === true);
      flashSaved(smtpSaveBtn, smtpSaveLabel);
    } catch (err) { setBusy(smtpSaveBtn, false); toast(err.message, 'error'); }
  });

  notifForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setBusy(notifSaveBtn, true, t('settings.flashSaved') + '…');
    const patch = { notifications: {
      leaveDecision: notifLeaveDecision.checked,
      correctionDecision: notifCorrectionDecision.checked,
      leaveReminder: notifLeaveReminder.checked,
    } };
    try {
      const res = await fetch('/api/settings/org', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('settings.failedToSave'));
      flashSaved(notifSaveBtn, notifSaveLabel);
    } catch (err) { setBusy(notifSaveBtn, false); toast(err.message, 'error'); }
  });

  // Load org settings (mail publicView + notifications + mailConfigured).
  (async () => {
    try {
      const res = await fetch('/api/settings/org', { credentials: 'same-origin', signal });
      const orgData = await res.json();
      const n = orgData.settings.notifications;
      notifLeaveDecision.checked = n?.leaveDecision !== false;
      notifCorrectionDecision.checked = n?.correctionDecision !== false;
      notifLeaveReminder.checked = n?.leaveReminder !== false;
      setStatus(orgData.mailConfigured === true);
      renderSmtp(orgData.mail);
    } catch (err) { if (!isAbort(err)) toast(t('settings.failedToSave'), 'error'); }
  })();
}

// =====================================================================
// BACKUPS TAB
// =====================================================================

function renderBackups(root, signal) {
  // --- Card 1: Create + existing list ---
  const c1 = card(t('settings.backupsHeading'), t('settings.backupsCardSub'));
  c1.insertAdjacentHTML('afterbegin', `
    <div id="restore-lockdown-banner" class="lockdown-banner" hidden>
      <strong>${escapeHtml(t('settings.restorePendingTitle'))}</strong>
      <p>${escapeHtml(t('settings.restorePendingBody'))}</p>
    </div>`);
  c1.insertAdjacentHTML('beforeend', `
    <button type="button" id="create-backup-btn" class="set-btn set-btn--primary">${svgIcon(ICONS.plus, 16, 2.2)}<span>${escapeHtml(t('settings.createBackupNow'))}</span></button>
    <h3 class="set-section">${escapeHtml(t('settings.backupsListHeading'))}</h3>
    <div id="backups-list" class="backups-list"></div>
    <p id="backups-empty" class="set-helper" hidden>${escapeHtml(t('settings.backupsEmpty'))}</p>`);

  // --- Card 2: Automatic backups ---
  const c2 = card(t('settings.backupsAutoHeading'), t('settings.backupsAutoCardSub'));
  c2.insertAdjacentHTML('beforeend', `
    <label class="set-check"><input type="checkbox" id="backup-enabled"><span>${escapeHtml(t('settings.backupEnabledLabel'))}</span></label>
    <div class="grid-2-narrow">
      <div class="set-field"><label for="backup-schedule">${escapeHtml(t('settings.backupSchedule'))}</label>
        <select id="backup-schedule">
          <option value="off">${escapeHtml(t('settings.scheduleOff'))}</option>
          <option value="hourly">${escapeHtml(t('settings.scheduleHourly'))}</option>
          <option value="daily">${escapeHtml(t('settings.scheduleDaily'))}</option>
          <option value="weekly">${escapeHtml(t('settings.scheduleWeekly'))}</option>
        </select></div>
      <div class="set-field"><label for="backup-retention">${escapeHtml(t('settings.backupRetentionLong'))}</label>
        <input type="number" id="backup-retention" min="1" max="365" step="1"></div>
    </div>
    <button type="button" id="save-schedule-btn" class="set-btn set-btn--primary">${escapeHtml(t('settings.saveSchedule'))}</button>`);

  // --- Card 3: Restore (clay) ---
  const c3 = card(t('settings.restoreHeading'), t('settings.restoreCardSub'), 'set-card--restore');
  c3.querySelector('.set-card__title').classList.add('set-card__title--clay');
  c3.insertAdjacentHTML('beforeend', `
    <div class="set-field">
      <label>${escapeHtml(t('settings.restoreChooseFile'))}</label>
      <input type="file" id="restore-file" accept=".bak" hidden>
      <div id="restore-drop" class="file-drop">
        <div class="file-drop__icon">${svgIcon(ICONS.plus, 16, 2)}</div>
        <div class="file-drop__text">
          <div class="file-drop__name">${escapeHtml(t('settings.restoreChooseFilePrompt'))}</div>
          <div class="file-drop__hint">${escapeHtml(t('settings.restoreFileHint'))}</div>
        </div>
      </div>
    </div>
    <div class="set-field">
      <label for="restore-confirm">${escapeHtml(t('settings.restoreTypeConfirm'))}</label>
      <input type="text" id="restore-confirm" autocomplete="off" spellcheck="false" placeholder="RESTORE">
      <p class="set-helper">${escapeHtml(t('settings.restoreWarn'))}</p>
    </div>
    <button type="button" id="restore-btn" class="set-btn set-btn--danger set-btn--block" disabled>${escapeHtml(t('settings.restoreButton'))}</button>`);

  root.append(c1, c2, c3);

  // Refs
  const lockdownBanner = c1.querySelector('#restore-lockdown-banner');
  const createBtn = c1.querySelector('#create-backup-btn');
  const listEl = c1.querySelector('#backups-list');
  const emptyEl = c1.querySelector('#backups-empty');
  const backupEnabled = c2.querySelector('#backup-enabled');
  const backupSchedule = c2.querySelector('#backup-schedule');
  const backupRetention = c2.querySelector('#backup-retention');
  const saveScheduleBtn = c2.querySelector('#save-schedule-btn');
  const scheduleLabel = saveScheduleBtn.textContent;
  const restoreFileInput = c3.querySelector('#restore-file');
  const restoreDrop = c3.querySelector('#restore-drop');
  const restoreName = c3.querySelector('.file-drop__name');
  const restoreHint = c3.querySelector('.file-drop__hint');
  const restoreConfirmInput = c3.querySelector('#restore-confirm');
  const restoreBtn = c3.querySelector('#restore-btn');

  function renderBackupsList(backups) {
    listEl.replaceChildren();
    if (!backups || backups.length === 0) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    backups.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'backup-row';
      const latest = i === 0
        ? `<span class="backup-latest">${escapeHtml(t('settings.backupLatest'))}</span>` : '';
      row.innerHTML = `
        <div class="backup-row__main">
          <div class="backup-row__date">${escapeHtml(fmtDateTime(b.createdAt))}${latest}</div>
          <div class="backup-row__meta"><span class="backup-chip">${escapeHtml(b.id)}</span></div>
        </div>
        <span class="backup-row__size">${escapeHtml(fmtSize(b.sizeBytes))}</span>
        <a class="set-btn set-btn--mini" href="/api/backups/${encodeURIComponent(b.id)}/download" download>${escapeHtml(t('settings.backupsDownload'))}</a>
        <button type="button" class="set-btn set-btn--mini-danger" data-action="delete" data-id="${escapeHtml(b.id)}">${escapeHtml(t('settings.backupsDelete'))}</button>`;
      listEl.appendChild(row);
    });
  }

  async function loadBackupsList() {
    try {
      const res = await fetch('/api/backups', { credentials: 'same-origin', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderBackupsList(data.backups);
    } catch (err) { if (!isAbort(err)) toast(t('settings.backupsLoadError'), 'error'); }
  }

  // Event-delegated Delete.
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id || !window.confirm(t('settings.backupsDeleteConfirm', { id }))) return;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
      toast(t('settings.backupsDeletedFmt', { id }), 'success');
      await loadBackupsList();
    } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
  });

  createBtn.addEventListener('click', async () => {
    setBusy(createBtn, true);
    try {
      const res = await fetch('/api/backups', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast(t('settings.backupsCreatedFmt', { id: data.backup.id, size: fmtSize(data.backup.sizeBytes) }), 'success');
      await loadBackupsList();
    } catch (err) { toast(err.message, 'error'); }
    setBusy(createBtn, false);
  });

  saveScheduleBtn.addEventListener('click', async () => {
    setBusy(saveScheduleBtn, true, t('settings.flashSaved') + '…');
    try {
      const res = await fetch('/api/settings/org', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ backups: {
          enabled: backupEnabled.checked,
          schedule: backupSchedule.value,
          retention: parseInt(backupRetention.value, 10) || 7,
        } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      flashSaved(saveScheduleBtn, scheduleLabel);
    } catch (err) { setBusy(saveScheduleBtn, false); toast(err.message, 'error'); }
  });

  // Restore: file drop-zone + RESTORE gate.
  restoreDrop.addEventListener('click', () => restoreFileInput.click());
  function updateRestoreEnabled() {
    const hasFile = !!restoreFileInput.files?.[0];
    const typed = restoreConfirmInput.value.trim() === 'RESTORE';
    restoreBtn.disabled = !(hasFile && typed);
  }
  restoreFileInput.addEventListener('change', () => {
    const f = restoreFileInput.files?.[0];
    if (f) {
      restoreName.textContent = f.name;
      restoreHint.textContent = fmtSize(f.size);
      restoreDrop.classList.add('file-drop--filled');
    } else {
      restoreName.textContent = t('settings.restoreChooseFilePrompt');
      restoreHint.textContent = t('settings.restoreFileHint');
      restoreDrop.classList.remove('file-drop--filled');
    }
    updateRestoreEnabled();
  });
  restoreConfirmInput.addEventListener('input', updateRestoreEnabled);

  restoreBtn.addEventListener('click', async () => {
    if (restoreBtn.disabled) return;
    const file = restoreFileInput.files?.[0];
    if (!file) { toast(t('settings.restoreNoFile'), 'error'); return; }
    setBusy(restoreBtn, true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await fetch('/api/backups/restore', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Pica-Confirm-Restore': 'RESTORE' },
        body: bytes,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fallback = data.error || `HTTP ${res.status}`;
        const localized = data.errorCode && t('errors.' + data.errorCode) !== '[errors.' + data.errorCode + ']'
          ? t('errors.' + data.errorCode) : fallback;
        throw new Error(localized);
      }
      toast(t('settings.restoreSuccessFmt', { count: String(data.restoredEntries ?? '?') }), 'success');
      showLockdown();
      disableAll();
    } catch (err) { toast(err.message, 'error'); setBusy(restoreBtn, false); }
    // On success keep the button busy until restart.
  });

  function showLockdown() { lockdownBanner.hidden = false; }
  function disableAll() {
    for (const el of [createBtn, restoreBtn, restoreFileInput, restoreConfirmInput,
      saveScheduleBtn, backupEnabled, backupSchedule, backupRetention]) {
      if (el) el.disabled = true;
    }
    for (const b of listEl.querySelectorAll('button[data-action="delete"]')) b.disabled = true;
  }

  async function checkRestoreStatus() {
    try {
      const res = await fetch('/api/backups/status', { credentials: 'same-origin', signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.restoreCompleted) { showLockdown(); disableAll(); }
    } catch { /* network blip — non-fatal */ }
  }

  // Load schedule form + list + lockdown state.
  (async () => {
    try {
      const res = await fetch('/api/settings/org', { credentials: 'same-origin', signal });
      const orgData = await res.json();
      const b = orgData.settings.backups;
      backupEnabled.checked = !!b?.enabled;
      backupSchedule.value = b?.schedule ?? 'off';
      backupRetention.value = b?.retention ?? 7;
    } catch (err) { if (!isAbort(err)) { /* schedule load failure is non-fatal */ } }
    await checkRestoreStatus();
    await loadBackupsList();
  })();
}

// =====================================================================
// SECURITY TAB (entry card — forms live on the standalone /security page)
// =====================================================================

function renderSecurityEntry(root) {
  const sec = card(t('settings.securityHeading'), t('settings.securityCardSub'));
  const link = document.createElement('a');
  link.href = '/security';
  link.className = 'set-btn set-btn--primary set-btn--block';
  link.textContent = t('settings.securityOpenBtn');
  sec.appendChild(link);
  root.appendChild(sec);
}
