/**
 * Employee summary page (employer view).
 *
 * One round-trip via /api/employees/:id/summary returns everything we
 * need: profile, week hours, bank balance, upcoming leaves, pending
 * approvals. We render in a single pass — no per-section loading
 * spinners because the underlying request is server-aggregated and
 * fast.
 */

import { mountTopBar, mountFooter } from '/topbar.js';
import { t, applyTranslations, fmtDate } from '/i18n.js';
import { showMessage } from '/app.js';

mountTopBar();
mountFooter();
applyTranslations();

const $ = (id) => document.getElementById(id);

// Pull the employee id from /employees/<id>
const segs = window.location.pathname.split('/').filter(Boolean);
const employeeId = segs[segs.indexOf('employees') + 1];

const headerSection = $('header-section');
const avatar         = $('avatar');
const avatarPlaceholder = $('avatar-placeholder');
const nameEl         = $('name');
const roleLine       = $('role-line');
const positionLine   = $('position-line');
const profileLink    = $('profile-link');
const messageEl      = $('message');

const statsGrid      = $('stats-grid');
const weekHoursEl    = $('week-hours');
const weekCaptionEl  = $('week-caption');
const bankBignumEl   = $('bank-bignum');
const bankCaptionEl  = $('bank-caption');
const pendingBody    = $('pending-body');

const upcomingSection  = $('upcoming-section');
const upcomingListEl   = $('upcoming-list');
const upcomingEmptyEl  = $('upcoming-empty');

const pendingSection            = $('pending-section');
const pendingLeavesBlock        = $('pending-leaves-block');
const pendingLeavesListEl       = $('pending-leaves-list');
const pendingCorrectionsBlock   = $('pending-corrections-block');
const pendingCorrectionsListEl  = $('pending-corrections-list');

const errorEl = $('error');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtBankHours(hours) {
  if (!Number.isFinite(hours) || hours === 0) return '0h';
  const sign = hours > 0 ? '+' : '−';
  const abs = Math.abs(hours);
  const str = (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${sign}${str}h`;
}

function fmtRange(startStr, endStr, unit) {
  // YYYY-MM-DD or ISO ts. For days we show a date range; for hours
  // we show start day with hour times.
  const s = String(startStr);
  const e = String(endStr);
  if (unit === 'hours') {
    const sDate = new Date(s);
    const eDate = new Date(e);
    return `${fmtDate(sDate)} ${formatTimeOnly(sDate)}–${formatTimeOnly(eDate)}`;
  }
  const sYmd = s.slice(0, 10);
  const eYmd = e.slice(0, 10);
  if (sYmd === eYmd) return fmtDate(sYmd);
  return `${fmtDate(sYmd)} → ${fmtDate(eYmd)}`;
}

function formatTimeOnly(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderHeader(data) {
  const profile = data.profile || {};
  const name = profile.fullName || data.username;
  nameEl.textContent = name;
  document.title = `Pica — ${name}`;

  // Role line: "Employer" / "Employee" via existing dictionary
  roleLine.textContent = t('employee.role.' + data.role);

  // Position is optional
  if (profile.position) {
    positionLine.textContent = profile.position;
    positionLine.hidden = false;
  }

  // Avatar
  if (profile.hasPicture) {
    avatar.src = `/api/employees/${encodeURIComponent(employeeId)}/picture`;
    avatar.hidden = false;
    avatarPlaceholder.hidden = true;
  } else {
    avatarPlaceholder.textContent = (name.charAt(0) || '?').toUpperCase();
    avatarPlaceholder.hidden = false;
    avatar.hidden = true;
  }

  // Profile link
  profileLink.href = `/employees/${encodeURIComponent(employeeId)}/profile`;

  headerSection.hidden = false;
}

function renderStats(data) {
  // Week hours
  const wh = data.week?.hours ?? 0;
  weekHoursEl.textContent = (Math.round(wh * 10) / 10).toString();
  if (data.week?.scheduled) {
    weekCaptionEl.textContent = t('employee.summary.weekTarget', {
      target: data.week.scheduled + 'h',
    });
  } else {
    weekCaptionEl.textContent = '';
  }

  // Bank
  const bh = data.bankHours ?? 0;
  bankBignumEl.innerHTML = bh === 0
    ? `0<span class="widget__bignum-suffix">h</span>`
    : `${escapeHtml(fmtBankHours(bh))}`;
  bankCaptionEl.textContent = bh === 0
    ? t('employee.summary.bankZero')
    : t('employee.summary.bankExplain');

  // Pending counts (employer-actionable)
  const pendingLeaves = data.pending?.leaves?.length ?? 0;
  const pendingCorrs  = data.pending?.corrections?.length ?? 0;
  if (pendingLeaves === 0 && pendingCorrs === 0) {
    pendingBody.innerHTML = `<div class="widget__empty">${escapeHtml(t('employee.summary.pendingEmpty'))}</div>`;
  } else {
    pendingBody.innerHTML = `
      <div class="widget__row">
        <div class="widget__row-main"><div class="widget__row-name">${escapeHtml(t('widgets.pendingLeaves'))}</div></div>
        <div class="widget__row-aside">
          <span class="widget__count${pendingLeaves === 0 ? ' widget__count--zero' : ''}">${pendingLeaves}</span>
        </div>
      </div>
      <div class="widget__row">
        <div class="widget__row-main"><div class="widget__row-name">${escapeHtml(t('widgets.pendingCorrections'))}</div></div>
        <div class="widget__row-aside">
          <span class="widget__count${pendingCorrs === 0 ? ' widget__count--zero' : ''}">${pendingCorrs}</span>
        </div>
      </div>
    `;
  }

  statsGrid.hidden = false;
}

function renderUpcoming(data) {
  const leaves = data.upcomingLeaves || [];
  if (leaves.length === 0) {
    upcomingListEl.innerHTML = '';
    upcomingEmptyEl.hidden = false;
  } else {
    upcomingEmptyEl.hidden = true;
    upcomingListEl.innerHTML = leaves.map((l) => `
      <li class="summary-list__item">
        <div class="summary-list__main">
          <div class="summary-list__when">${escapeHtml(fmtRange(l.start, l.end, l.unit))}</div>
          <div class="summary-list__detail">${escapeHtml(t('leaves.type.' + l.type))}</div>
        </div>
        <a class="summary-list__link" href="/leaves/${encodeURIComponent(l.id)}" data-i18n="employee.summary.viewLeave">View →</a>
      </li>
    `).join('');
  }
  upcomingSection.hidden = false;
}

function renderPending(data) {
  const leaves = data.pending?.leaves ?? [];
  const corrs  = data.pending?.corrections ?? [];

  if (leaves.length === 0 && corrs.length === 0) {
    // Don't render the detail card at all when nothing is pending.
    pendingSection.hidden = true;
    return;
  }

  if (leaves.length > 0) {
    pendingLeavesListEl.innerHTML = leaves.map((l) => `
      <li class="summary-list__item">
        <div class="summary-list__main">
          <div class="summary-list__when">${escapeHtml(fmtRange(l.start, l.end, l.unit))}</div>
          <div class="summary-list__detail">${escapeHtml(t('leaves.type.' + l.type))}</div>
        </div>
        <a class="summary-list__link" href="/leaves/${encodeURIComponent(l.id)}">${escapeHtml(t('employee.summary.review'))} →</a>
      </li>
    `).join('');
    pendingLeavesBlock.hidden = false;
  } else {
    pendingLeavesBlock.hidden = true;
  }

  if (corrs.length > 0) {
    const KIND_KEYS = { both: 'corrections.kindBoth', in: 'corrections.kindIn', out: 'corrections.kindOut' };
    pendingCorrectionsListEl.innerHTML = corrs.map((c) => {
      const hrs = (Math.round((c.hours || 0) * 10) / 10);
      const kindLabel = t(KIND_KEYS[c.kind] || 'corrections.kindBoth');
      return `
        <li class="summary-list__item">
          <div class="summary-list__main">
            <div class="summary-list__when">${escapeHtml(fmtRange(c.start, c.end, 'hours'))}</div>
            <div class="summary-list__detail">${escapeHtml(kindLabel)} · ${hrs}h</div>
          </div>
          <a class="summary-list__link" href="/corrections/${encodeURIComponent(c.id)}">${escapeHtml(t('employee.summary.review'))} →</a>
        </li>
      `;
    }).join('');
    pendingCorrectionsBlock.hidden = false;
  } else {
    pendingCorrectionsBlock.hidden = true;
  }

  pendingSection.hidden = false;
}

async function load() {
  errorEl.hidden = true;
  try {
    const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/summary`, {
      credentials: 'same-origin',
    });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (res.status === 403) {
      // Employee viewing themselves via this URL — not allowed; send home.
      window.location.href = '/';
      return;
    }
    if (res.status === 404) {
      errorEl.hidden = false;
      errorEl.textContent = t('employee.summary.notFound');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    renderHeader(data);
    renderStats(data);
    renderUpcoming(data);
    renderPending(data);
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = t('widgets.couldNotLoad');
  }
}

// "Reset password" placeholder — disabled until M12. We attach a click
// listener anyway so a future enabling just removes the disabled
// attribute and this becomes the real handler.
$('reset-pw-btn').addEventListener('click', () => {
  showMessage(messageEl, t('employee.summary.resetPwUnavailable'), 'error');
});

load();
