// Pica — Request-Leave form modal (M15 Plan 4).
//
// Wraps the leave-request form (ported from the retired /leave-new page) inside
// the generic modal shell so "Request leave" / "Book leave" opens in place from
// the leaves list (and, via the /leaves?new=1 redirect, from the home and
// calendar buttons) without navigating away.
//
// API:
//   import { openRequestLeaveModal } from '/request-leave-modal.js';
//   openRequestLeaveModal({ prefillDate, onCreated: (leave) => { ... } });
//
// onCreated fires after the user dismisses the success state with "Done".
//
// Four design extras (all from existing endpoints — no backend change):
//   • balance-after summary (from /api/leaves/balances/:id)
//   • conflict box           (from /api/leaves/approved — anonymized for employees)
//   • file drop-zone         (restyle of the existing multipart upload)
//   • success state          (replaces the form body; Request another / Done)
//
// No inline styles, no innerHTML with dynamic data. CSP-safe (textContent /
// createElement / createElementNS only).

import { createModal } from '/modal.js';
import { postJson, showMessage, setBusy } from '/app.js';
import { t, tn, translateError, fmtHours } from '/i18n.js';

// ---- Inline SVG helper (CSP-safe; no inline <script>/<style>) --------------

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(children, { size = 16, sw = 1.8 } = {}) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', String(sw));
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attrs] of children) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    s.appendChild(el);
  }
  return s;
}

const TYPE_ICONS = {
  vacation: [['circle', { cx: 12, cy: 12, r: 4 }],
    ['line', { x1: 12, y1: 2, x2: 12, y2: 4 }], ['line', { x1: 12, y1: 20, x2: 12, y2: 22 }],
    ['line', { x1: 4.2, y1: 4.2, x2: 5.6, y2: 5.6 }], ['line', { x1: 18.4, y1: 18.4, x2: 19.8, y2: 19.8 }],
    ['line', { x1: 2, y1: 12, x2: 4, y2: 12 }], ['line', { x1: 20, y1: 12, x2: 22, y2: 12 }],
    ['line', { x1: 4.2, y1: 19.8, x2: 5.6, y2: 18.4 }], ['line', { x1: 18.4, y1: 5.6, x2: 19.8, y2: 4.2 }]],
  sick: [['path', { d: 'M20.8 5.6a5.4 5.4 0 0 0-7.7 0L12 6.7l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.7l1.1 1.1L12 22l7.7-7.6 1.1-1.1a5.4 5.4 0 0 0 0-7.7z' }]],
  appointment: [['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['line', { x1: 16, y1: 2, x2: 16, y2: 6 }], ['line', { x1: 8, y1: 2, x2: 8, y2: 6 }],
    ['line', { x1: 3, y1: 10, x2: 21, y2: 10 }]],
  other: [['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
};
const FILE_ICON = [['path', { d: 'M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49' }]];
const CHECK_ICON = [['polyline', { points: '20 6 9 17 4 12' }]];

const LEAVE_TYPES = ['vacation', 'sick', 'appointment', 'other'];
const MAX_FILE = 5 * 1024 * 1024;

// ---- Module-level singletons -----------------------------------------------

let modal = null;
let built = false;
let me = null;
let unit = 'days';
let currentOnCreated = null;
let lastCreated = null;
let approvedCache = null;            // [{...}] for the current open (reset on open)
const balancesCache = {};            // year -> balances[]

// Element refs (captured once on build)
let formEl, successEl, subtitleEl, messageEl, typesWrap,
    unitDaysBtn, unitHoursBtn, daysFields, hoursFields,
    dayStart, dayEnd, hourDate, hourStart, hourEnd,
    reasonEl, summaryEl, summaryBig, summaryUnit, summaryAfter, conflictEl,
    dropEl, dropTitle, dropSub, removeFileBtn, fileInput,
    footHint, submitBtn,
    successIconEl, successBlurbEl, successChipEl;

// ---- Small helpers ---------------------------------------------------------

function currentType() {
  return formEl.querySelector('input[name="rlm-type"]:checked')?.value || 'vacation';
}
function ymd(s) { return String(s).slice(0, 10); }
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); }

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Day-equivalent count, mirroring approxDaysOff() in src/storage/reports.js
// (hours → hours/8; days → inclusive day span). Used by the balance-after line.
function additionalDays() {
  if (unit === 'hours') {
    const d = hourDate.value, hs = hourStart.value, he = hourEnd.value;
    if (!d || !hs || !he) return 0;
    const ms = new Date(`${d}T${he}:00`) - new Date(`${d}T${hs}:00`);
    return ms > 0 ? ms / 3_600_000 / 8 : 0;
  }
  const s = dayStart.value, e = dayEnd.value;
  if (!s || !e || s > e) return 0;
  return Math.round((parseYmd(e) - parseYmd(s)) / 86_400_000) + 1;
}

function currentRange() {
  if (unit === 'hours') { const d = hourDate.value; return d ? { start: d, end: d } : null; }
  const s = dayStart.value, e = dayEnd.value;
  return (s && e && s <= e) ? { start: s, end: e } : null;
}

function rangeText(leave) {
  if (leave.unit === 'days') {
    return leave.start === leave.end ? leave.start : `${leave.start} → ${leave.end}`;
  }
  return ymd(leave.start);
}

// ---- Async data (cached) ---------------------------------------------------

async function getBalances(year) {
  if (balancesCache[year]) return balancesCache[year];
  if (!me?.id) return null;
  try {
    const r = await fetch(`/api/leaves/balances/${me.id}?year=${year}`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const j = await r.json();
    balancesCache[year] = j.balances || [];
    return balancesCache[year];
  } catch { return null; }
}

async function getApproved() {
  if (approvedCache) return approvedCache;
  try {
    const r = await fetch('/api/leaves/approved', { credentials: 'same-origin' });
    if (!r.ok) return null;
    const j = await r.json();
    approvedCache = j.leaves || [];
    return approvedCache;
  } catch { return null; }
}

// ---- Live summary + conflict ----------------------------------------------

function refresh() {
  updateSummary();
  updateConflict();
}

async function updateSummary() {
  const count = additionalDays();
  if (unit === 'hours') {
    const d = hourDate.value, hs = hourStart.value, he = hourEnd.value;
    let hours = 0;
    if (d && hs && he) {
      const ms = new Date(`${d}T${he}:00`) - new Date(`${d}T${hs}:00`);
      hours = ms > 0 ? ms / 3_600_000 : 0;
    }
    summaryBig.textContent = fmtHours(hours);
    summaryUnit.textContent = t('rlm.unitHours');
  } else {
    summaryBig.textContent = String(count);
    summaryUnit.textContent = count === 1 ? t('rlm.unitDay') : t('rlm.unitDays');
  }

  const type = currentType();
  const anchor = unit === 'hours' ? hourDate.value : dayStart.value;
  const year = (anchor || todayYmd()).slice(0, 4);
  const balances = await getBalances(year);
  const b = balances?.find((x) => x.type === type);
  if (b && b.allowance > 0) {
    const after = (b.remaining ?? 0) - count;
    summaryAfter.textContent = t('rlm.balanceAfter', { n: fmtHours(after) });
    summaryEl.classList.toggle('rlm-summary--over', after < 0);
  } else {
    summaryAfter.textContent = t('rlm.noCap');
    summaryEl.classList.remove('rlm-summary--over');
  }
}

async function updateConflict() {
  const range = currentRange();
  if (!range) { conflictEl.hidden = true; return; }
  const approved = await getApproved();
  if (!approved) { conflictEl.hidden = true; return; }

  const others = approved.filter((l) => {
    if (l.employeeId && me?.id && l.employeeId === me.id) return false;  // skip my own
    return range.start <= ymd(l.end) && ymd(l.start) <= range.end;       // day overlap
  });
  if (others.length === 0) { conflictEl.hidden = true; return; }

  conflictEl.hidden = false;
  if (me?.role === 'employer') {
    const names = [...new Set(others.map((l) => l.fullName || l.username || t('rlm.someone')))].join(', ');
    conflictEl.textContent = t('rlm.conflictEmployer', { names });
  } else {
    conflictEl.textContent = tn('rlm.conflictEmployee', others.length, { n: others.length });
  }
}

// ---- Payload (ported verbatim from leave-new.js buildPayload) --------------

function buildPayload() {
  const type = currentType();
  const reason = reasonEl.value.trim() || undefined;

  if (unit === 'days') {
    const start = dayStart.value;
    const end = dayEnd.value;
    if (!start || !end) throw new Error(t('rlm.pickDates'));
    if (start > end) throw new Error(t('rlm.startBeforeEnd'));
    return { type, unit, start, end, reason };
  }
  const date = hourDate.value;
  const hs = hourStart.value;
  const he = hourEnd.value;
  if (!date || !hs || !he) throw new Error(t('rlm.pickDateTimes'));
  const start = new Date(`${date}T${hs}:00`).toISOString();
  const end = new Date(`${date}T${he}:00`).toISOString();
  if (new Date(start) >= new Date(end)) throw new Error(t('rlm.endAfterStart'));
  const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
  return { type, unit, start, end, hours, reason };
}

// ---- Build (once) ----------------------------------------------------------

function buildModal() {
  modal = createModal({ className: 'rlm-modal' });
  const body = modal.body;

  // Subtitle
  subtitleEl = document.createElement('p');
  subtitleEl.className = 'rlm-subtitle';
  body.appendChild(subtitleEl);

  // Inline message (errors)
  messageEl = document.createElement('div');
  messageEl.className = 'message';
  body.appendChild(messageEl);

  // Form
  formEl = document.createElement('form');
  formEl.className = 'rlm-form';
  formEl.setAttribute('autocomplete', 'off');
  formEl.setAttribute('novalidate', '');
  body.appendChild(formEl);

  // -- Type cards -------------------------------------------------------------
  const typeSection = section('rlm.sectionType');
  typesWrap = document.createElement('div');
  typesWrap.className = 'rlm-types';
  for (const k of LEAVE_TYPES) {
    const label = document.createElement('label');
    label.className = 'rlm-type' + (k === 'vacation' ? ' rlm-type--selected' : '');
    label.dataset.type = k;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'rlm-type';
    radio.value = k;
    radio.className = 'rlm-type__radio';
    radio.checked = k === 'vacation';
    radio.addEventListener('change', () => { selectType(k); refresh(); });

    const icon = document.createElement('span');
    icon.className = 'rlm-type__icon';
    icon.appendChild(svg(TYPE_ICONS[k], { size: 16 }));

    const lab = document.createElement('span');
    lab.className = 'rlm-type__label';
    lab.textContent = t('leaves.type.' + k);

    label.append(radio, icon, lab);
    typesWrap.appendChild(label);
  }
  typeSection.appendChild(typesWrap);
  formEl.appendChild(typeSection);

  // -- When (unit toggle + fields) -------------------------------------------
  const whenSection = section('rlm.sectionWhen');
  const toggle = document.createElement('div');
  toggle.className = 'rlm-toggle';
  unitDaysBtn = toggleBtn('leaveNew.unitDays', true);
  unitHoursBtn = toggleBtn('leaveNew.unitHours', false);
  unitDaysBtn.addEventListener('click', () => setUnit('days'));
  unitHoursBtn.addEventListener('click', () => setUnit('hours'));
  toggle.append(unitDaysBtn, unitHoursBtn);
  whenSection.appendChild(toggle);

  // Days fields
  daysFields = document.createElement('div');
  const dayRow = document.createElement('div');
  dayRow.className = 'rlm-row';
  ({ field: dayStart } = dateField('rlm.startDate', 'date'));
  ({ field: dayEnd } = dateField('rlm.endDate', 'date'));
  dayRow.append(dayStart.parentField, dayEnd.parentField);
  daysFields.appendChild(dayRow);
  const dayHint = document.createElement('p');
  dayHint.className = 'rlm-helper';
  dayHint.textContent = t('leaveNew.endDateHint');
  daysFields.appendChild(dayHint);
  whenSection.appendChild(daysFields);

  // Hours fields
  hoursFields = document.createElement('div');
  hoursFields.hidden = true;
  ({ field: hourDate } = dateField('rlm.date', 'date'));
  hoursFields.appendChild(hourDate.parentField);
  const timeRow = document.createElement('div');
  timeRow.className = 'rlm-row';
  ({ field: hourStart } = dateField('leaveNew.from', 'time'));
  ({ field: hourEnd } = dateField('leaveNew.to', 'time'));
  timeRow.append(hourStart.parentField, hourEnd.parentField);
  hoursFields.appendChild(timeRow);
  whenSection.appendChild(hoursFields);
  formEl.appendChild(whenSection);

  for (const el of [dayStart, dayEnd, hourDate, hourStart, hourEnd]) {
    el.addEventListener('change', () => {
      if (el === dayStart && dayEnd.value < dayStart.value) dayEnd.value = dayStart.value;
      refresh();
    });
  }

  // -- Summary bar ------------------------------------------------------------
  summaryEl = document.createElement('div');
  summaryEl.className = 'rlm-summary';
  const daysWrap = document.createElement('div');
  daysWrap.className = 'rlm-summary__days';
  summaryBig = document.createElement('span');
  summaryBig.className = 'rlm-summary__big';
  summaryUnit = document.createElement('span');
  summaryUnit.className = 'rlm-summary__unit';
  daysWrap.append(summaryBig, summaryUnit);
  summaryAfter = document.createElement('span');
  summaryAfter.className = 'rlm-summary__after';
  summaryEl.append(daysWrap, summaryAfter);
  formEl.appendChild(summaryEl);

  // -- Conflict box -----------------------------------------------------------
  conflictEl = document.createElement('div');
  conflictEl.className = 'rlm-conflict';
  conflictEl.hidden = true;
  formEl.appendChild(conflictEl);

  // -- Reason -----------------------------------------------------------------
  const reasonSection = section('rlm.sectionReason');
  reasonEl = document.createElement('textarea');
  reasonEl.rows = 3;
  reasonEl.maxLength = 500;
  reasonEl.placeholder = t('leaveNew.reasonPlaceholder');
  reasonSection.appendChild(reasonEl);
  formEl.appendChild(reasonSection);

  // -- File drop --------------------------------------------------------------
  const fileSection = section('rlm.sectionFile');
  fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.className = 'rlm-file-input';
  fileInput.accept = '.pdf,.jpg,.jpeg,.png,.gif,.webp,application/pdf,image/jpeg,image/png,image/gif,image/webp';

  dropEl = document.createElement('button');
  dropEl.type = 'button';
  dropEl.className = 'rlm-drop';
  const dropIcon = document.createElement('span');
  dropIcon.className = 'rlm-drop__icon';
  dropIcon.appendChild(svg(FILE_ICON, { size: 18 }));
  const dropText = document.createElement('div');
  dropText.className = 'rlm-drop__text';
  dropTitle = document.createElement('div');
  dropTitle.className = 'rlm-drop__title';
  dropTitle.textContent = t('rlm.dropTitle');
  dropSub = document.createElement('div');
  dropSub.className = 'rlm-drop__sub';
  dropSub.textContent = t('leaveNew.attachmentHint');
  dropText.append(dropTitle, dropSub);
  removeFileBtn = document.createElement('span');
  removeFileBtn.className = 'rlm-drop__remove';
  removeFileBtn.hidden = true;
  removeFileBtn.textContent = '×';
  removeFileBtn.setAttribute('role', 'button');
  removeFileBtn.setAttribute('aria-label', t('leave.attachmentRemove'));
  dropEl.append(dropIcon, dropText, removeFileBtn);

  dropEl.addEventListener('click', (e) => {
    if (e.target === removeFileBtn) { e.stopPropagation(); clearFile(); return; }
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) { clearFile(); return; }
    if (f.size > MAX_FILE) {
      showMessage(messageEl, t('leaveNew.attachmentTooLarge'), 'error');
      clearFile();
      return;
    }
    dropEl.classList.add('rlm-drop--has-file');
    dropTitle.textContent = f.name;
    dropSub.textContent = formatSize(f.size);
    removeFileBtn.hidden = false;
  });
  fileSection.append(dropEl, fileInput);
  formEl.appendChild(fileSection);

  // -- Footer (hint + actions) ------------------------------------------------
  const foot = document.createElement('div');
  foot.className = 'rlm-foot';
  footHint = document.createElement('div');
  footHint.className = 'rlm-foot__hint';
  const footActions = document.createElement('div');
  footActions.className = 'rlm-foot__actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-ghost';
  cancelBtn.textContent = t('leave.cancelButton');
  cancelBtn.addEventListener('click', () => modal.close());
  submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn-primary';
  submitBtn.textContent = t('rlm.submit');
  footActions.append(cancelBtn, submitBtn);
  foot.append(footHint, footActions);
  formEl.appendChild(foot);

  // -- Submit -----------------------------------------------------------------
  formEl.addEventListener('submit', onSubmit);

  // -- Success state (sibling of form; hidden until a successful submit) ------
  successEl = document.createElement('div');
  successEl.className = 'rlm-success';
  successEl.hidden = true;
  successIconEl = document.createElement('span');
  successIconEl.className = 'rlm-success__icon';
  successIconEl.appendChild(svg(CHECK_ICON, { size: 30, sw: 2.4 }));
  const successTitle = document.createElement('h3');
  successTitle.className = 'rlm-success__title';
  successTitle.textContent = t('rlm.successTitle');
  successBlurbEl = document.createElement('p');
  successBlurbEl.className = 'rlm-success__blurb';
  successChipEl = document.createElement('span');
  successChipEl.className = 'rlm-success__chip';
  const successActions = document.createElement('div');
  successActions.className = 'rlm-success__actions';
  const againBtn = document.createElement('button');
  againBtn.type = 'button';
  againBtn.className = 'btn-ghost';
  againBtn.textContent = t('rlm.requestAnother');
  againBtn.addEventListener('click', () => { resetForm(); successEl.hidden = true; formEl.hidden = false; });
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn-primary';
  doneBtn.textContent = t('rlm.done');
  doneBtn.addEventListener('click', () => {
    const cb = currentOnCreated;
    const created = lastCreated;
    modal.close();
    try { cb?.(created); } catch (err) { console.error('[request-leave] onCreated failed', err); }
  });
  successActions.append(againBtn, doneBtn);
  successEl.append(successIconEl, successTitle, successBlurbEl, successChipEl, successActions);
  body.appendChild(successEl);

  built = true;
}

// ---- Build helpers ---------------------------------------------------------

function section(labelKey) {
  const wrap = document.createElement('div');
  wrap.className = 'rlm-section';
  const label = document.createElement('div');
  label.className = 'rlm-section__label';
  label.textContent = t(labelKey);
  wrap.appendChild(label);
  return wrap;
}

function toggleBtn(labelKey, active) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rlm-toggle__btn' + (active ? ' rlm-toggle__btn--active' : '');
  b.textContent = t(labelKey);
  return b;
}

// Returns { field: input } where input.parentField is the wrapping .rlm-field.
function dateField(labelKey, type) {
  const wrap = document.createElement('div');
  wrap.className = 'rlm-field';
  const label = document.createElement('label');
  label.textContent = t(labelKey);
  const input = document.createElement('input');
  input.type = type;
  wrap.append(label, input);
  input.parentField = wrap;
  return { field: input };
}

// ---- Selection / unit toggle ----------------------------------------------

function selectType(k) {
  for (const label of typesWrap.children) {
    label.classList.toggle('rlm-type--selected', label.dataset.type === k);
  }
}

function setUnit(u) {
  unit = u;
  unitDaysBtn.classList.toggle('rlm-toggle__btn--active', u === 'days');
  unitHoursBtn.classList.toggle('rlm-toggle__btn--active', u === 'hours');
  daysFields.hidden = u !== 'days';
  hoursFields.hidden = u === 'days';
  refresh();
}

function clearFile() {
  fileInput.value = '';
  dropEl.classList.remove('rlm-drop--has-file');
  dropTitle.textContent = t('rlm.dropTitle');
  dropSub.textContent = t('leaveNew.attachmentHint');
  removeFileBtn.hidden = true;
}

// ---- Submit ----------------------------------------------------------------

async function onSubmit(e) {
  e.preventDefault();
  showMessage(messageEl, '');

  let payload;
  try {
    payload = buildPayload();
  } catch (err) {
    showMessage(messageEl, err.message, 'error');
    return;
  }

  const file = fileInput.files?.[0] || null;
  if (file && file.size > MAX_FILE) {
    showMessage(messageEl, t('leaveNew.attachmentTooLarge'), 'error');
    return;
  }

  setBusy(submitBtn, true, t('leaveNew.submitting'));

  let result;
  if (file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined && v !== null) fd.append(k, String(v));
    }
    fd.append('file', file, file.name);
    try {
      const res = await fetch('/api/leaves', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      result = { ok: res.ok, data };
    } catch { result = { ok: false, data: {} }; }
  } else {
    result = await postJson('/api/leaves', payload);
  }

  setBusy(submitBtn, false);

  if (result.ok) {
    showSuccess(result.data.leave);
  } else {
    showMessage(messageEl, translateError(result.data.errorCode, result.data.error || t('leaveNew.couldNotSubmit')), 'error');
  }
}

function showSuccess(leave) {
  lastCreated = leave;
  formEl.hidden = true;
  successEl.hidden = false;
  successBlurbEl.textContent = me?.role === 'employer' ? t('rlm.successEmployer') : t('rlm.successEmployee');
  successChipEl.textContent = `${t('leaves.type.' + leave.type)} · ${rangeText(leave)}`;
}

// ---- Reset -----------------------------------------------------------------

function resetForm(prefillDate) {
  setBusy(submitBtn, false);
  const day = prefillDate || todayYmd();
  selectType('vacation');
  const vac = formEl.querySelector('input[name="rlm-type"][value="vacation"]');
  if (vac) vac.checked = true;
  setUnit('days');
  dayStart.value = day;
  dayEnd.value = day;
  hourDate.value = day;
  hourStart.value = '';
  hourEnd.value = '';
  reasonEl.value = '';
  clearFile();
  conflictEl.hidden = true;
  showMessage(messageEl, '');
  formEl.hidden = false;
  successEl.hidden = true;
}

// ---- Public API ------------------------------------------------------------

/**
 * Open the request-leave modal.
 * @param {object}   [opts]
 * @param {string}   [opts.prefillDate]  YYYY-MM-DD to prefill (e.g. from a calendar day).
 * @param {(leave: object) => void} [opts.onCreated]  Called after the user clicks Done.
 */
export async function openRequestLeaveModal({ prefillDate, onCreated } = {}) {
  if (!me) {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.ok) me = await r.json();
    } catch { /* fall through to fallback */ }
  }
  if (!me) me = { id: null, role: 'employee' };

  if (!built) buildModal();

  currentOnCreated = onCreated || null;
  approvedCache = null;   // re-fetch the approved feed for each open

  modal.titleEl.textContent = me.role === 'employer' ? t('rlm.titleEmployer') : t('rlm.titleEmployee');
  subtitleEl.textContent = me.role === 'employer' ? t('rlm.subtitleEmployer') : t('rlm.subtitleEmployee');
  footHint.textContent = me.role === 'employer' ? t('rlm.willAutoApprove') : t('rlm.willBeSent');

  resetForm(prefillDate);
  modal.open();
  refresh();
}
