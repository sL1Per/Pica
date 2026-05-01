/**
 * Dashboard — welcome banner + role-specific widgets + quick-nav cards.
 *
 * Widgets fetched in parallel. Each widget renders independently:
 *   - A failure in one widget shows a per-widget error, doesn't break others.
 *   - All widgets share a single refresh cycle (one fetch per source).
 *   - Tab visibility change → re-fetch (cheap "live" feel without polling).
 */

import { mountTopBar, mountFooter } from '/topbar.js';
import { t, fmtTime } from '/i18n.js';

// ---- Quick-nav cards (kept from earlier dashboard) -----------------------

const NAV_EMPLOYEE = [
  { href: '/punch',           titleKey: 'dashboard.card.punches.title',     descKey: 'dashboard.card.punches.desc' },
  { href: '/leaves/calendar', titleKey: 'dashboard.card.calendar.title',    descKey: 'dashboard.card.calendar.desc' },
  { href: '/leaves',          titleKey: 'dashboard.card.leaves.title',      descKey: 'dashboard.card.leavesEmployee.desc' },
  { href: '/corrections',     titleKey: 'dashboard.card.corrections.title', descKey: 'dashboard.card.correctionsEmployee.desc' },
  { href: '/reports',         titleKey: 'dashboard.card.reports.title',     descKey: 'dashboard.card.reportsEmployee.desc' },
];

const NAV_EMPLOYER = [
  { href: '/employees',       titleKey: 'dashboard.card.employees.title',   descKey: 'dashboard.card.employees.desc' },
  { href: '/leaves/calendar', titleKey: 'dashboard.card.calendar.title',    descKey: 'dashboard.card.calendar.desc' },
  { href: '/leaves',          titleKey: 'dashboard.card.leaves.title',      descKey: 'dashboard.card.leaves.desc' },
  { href: '/corrections',     titleKey: 'dashboard.card.corrections.title', descKey: 'dashboard.card.correctionsEmployer.desc' },
  { href: '/punch',           titleKey: 'dashboard.card.punches.title',     descKey: 'dashboard.card.punches.desc' },
  { href: '/reports',         titleKey: 'dashboard.card.reports.title',     descKey: 'dashboard.card.reportsEmployer.desc' },
  { href: '/settings',        titleKey: 'dashboard.card.settings.title',    descKey: 'dashboard.card.settings.desc' },
];

function renderNavCards(role) {
  const items = role === 'employer' ? NAV_EMPLOYER : NAV_EMPLOYEE;
  const root = document.getElementById('nav-cards');
  root.innerHTML = items.map((it) => `
    <a class="nav-card" href="${it.href}">
      <div class="nav-card__title">${escapeHtml(t(it.titleKey))}</div>
      <div class="nav-card__desc">${escapeHtml(t(it.descKey))}</div>
    </a>
  `).join('');
}

// ---- Helpers ------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** "8h 30m" / "8h" / "0m" — terse human duration from a millisecond value. */
function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Plain HHh from a fractional-hours number. Used for the bank balance. */
function formatBankHours(hours) {
  if (!Number.isFinite(hours)) return '0h';
  const sign = hours > 0 ? '+' : (hours < 0 ? '−' : '');
  const abs = Math.abs(hours);
  // Up to one decimal place, no trailing .0
  const str = (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${sign}${str}h`;
}

/** From an ISO timestamp, return the local HH:MM via the i18n fmtTime helper. */
function timeOnly(iso) { return fmtTime(iso); }

// ---- Fetch wrapper with error capture ----------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

// ---- Punch grouping ----------------------------------------------------

/**
 * Given an array of punches sorted by timestamp ascending, group them into
 * (in, out) pairs per employee. Returns an array of:
 *   { employeeId, username, fullName, pairs: [{ in, out }], openInPunch }
 *
 * `openInPunch` is the most recent in-punch with no matching out (i.e. the
 * employee is currently clocked in). Otherwise null.
 */
function groupPunchesByEmployee(punches, employeesById) {
  const byEmp = new Map();
  for (const p of punches) {
    if (!byEmp.has(p.employeeId)) {
      const emp = employeesById.get(p.employeeId);
      byEmp.set(p.employeeId, {
        employeeId: p.employeeId,
        username: p.username || emp?.username || null,
        fullName: emp?.fullName || null,
        pairs: [],
        openInPunch: null,
      });
    }
    const g = byEmp.get(p.employeeId);
    if (p.type === 'in') {
      g.openInPunch = p;          // becomes the new "open" until closed
    } else if (p.type === 'out') {
      if (g.openInPunch) {
        g.pairs.push({ in: g.openInPunch, out: p });
        g.openInPunch = null;
      } else {
        // Out without a prior in — orphan. Skip; UI doesn't need to surface
        // these on the dashboard. (Corrections page handles those flows.)
      }
    }
  }
  return [...byEmp.values()];
}

/** Sum of (out - in) durations across closed pairs, in ms. */
function workedMsFromPairs(pairs) {
  let total = 0;
  for (const p of pairs) {
    total += new Date(p.out.ts).getTime() - new Date(p.in.ts).getTime();
  }
  return total;
}

/** Currently-working duration: from the open in-punch to now. */
function openDurationMs(openInPunch) {
  if (!openInPunch) return 0;
  return Date.now() - new Date(openInPunch.ts).getTime();
}

// ---- Widget framework --------------------------------------------------

/**
 * Set the body of a widget while keeping its head. `body` is HTML (caller
 * is responsible for escaping). Used by all the renderXxx() functions.
 */
function setWidgetBody(widgetEl, body) {
  const bodyEl = widgetEl.querySelector('.widget__body');
  if (bodyEl) bodyEl.innerHTML = body;
}

function widgetLoading(widgetEl) {
  setWidgetBody(widgetEl, `<div class="widget__loading">${escapeHtml(t('widgets.loading'))}</div>`);
}

function widgetError(widgetEl, retry) {
  setWidgetBody(widgetEl, `
    <div class="widget__error">${escapeHtml(t('widgets.couldNotLoad'))}</div>
    <div style="text-align:center"><button type="button" class="btn-ghost btn-sm" data-retry>${escapeHtml(t('widgets.retry'))}</button></div>
  `);
  const btn = widgetEl.querySelector('[data-retry]');
  if (btn) btn.addEventListener('click', retry);
}

/** Build a widget shell: <section class="widget"> with a head and empty body. */
function buildWidget({ titleKey, action, wide }) {
  const w = document.createElement('section');
  w.className = 'widget' + (wide ? ' widget--wide' : '');
  const actionHtml = action
    ? `<a class="widget__action" href="${action.href}">${escapeHtml(t(action.labelKey))}</a>`
    : '';
  w.innerHTML = `
    <div class="widget__head">
      <h2 class="widget__title">${escapeHtml(t(titleKey))}</h2>
      ${actionHtml}
    </div>
    <div class="widget__body"></div>
  `;
  return w;
}

// ---- Renderers — employer ---------------------------------------------

function renderPendingApprovalsEmployer(widgetEl, leaves, corrections) {
  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const pendingCorrections = corrections.filter((c) => c.status === 'pending');
  if (pendingLeaves.length === 0 && pendingCorrections.length === 0) {
    setWidgetBody(widgetEl, `<div class="widget__empty">${escapeHtml(t('widgets.allCaughtUp'))}</div>`);
    return;
  }
  setWidgetBody(widgetEl, `
    <div class="widget__row">
      <div class="widget__row-main">
        <div class="widget__row-name">
          <a href="/leaves">${escapeHtml(t('widgets.pendingLeaves'))}</a>
        </div>
      </div>
      <div class="widget__row-aside">
        <span class="widget__count${pendingLeaves.length === 0 ? ' widget__count--zero' : ''}">${pendingLeaves.length}</span>
      </div>
    </div>
    <div class="widget__row">
      <div class="widget__row-main">
        <div class="widget__row-name">
          <a href="/corrections">${escapeHtml(t('widgets.pendingCorrections'))}</a>
        </div>
      </div>
      <div class="widget__row-aside">
        <span class="widget__count${pendingCorrections.length === 0 ? ' widget__count--zero' : ''}">${pendingCorrections.length}</span>
      </div>
    </div>
  `);
}

function renderWorkingTodayEmployer(widgetEl, punches, employeesById) {
  const groups = groupPunchesByEmployee(punches, employeesById);
  if (groups.length === 0) {
    setWidgetBody(widgetEl, `<div class="widget__empty">${escapeHtml(t('widgets.noOneWorkingYet'))}</div>`);
    return;
  }
  const working = groups.filter((g) => g.openInPunch);
  const done    = groups.filter((g) => !g.openInPunch && g.pairs.length > 0);

  let html = '';

  if (working.length > 0) {
    html += `<div class="widget__section"><div class="widget__section-head">${escapeHtml(t('widgets.currentlyWorking'))}</div><ul class="widget__list">`;
    for (const g of working) {
      const inT = timeOnly(g.openInPunch.ts);
      const dur = humanDuration(openDurationMs(g.openInPunch) + workedMsFromPairs(g.pairs));
      html += `
        <li class="widget__row">
          <div class="widget__row-main">
            <div class="widget__row-name">${escapeHtml(g.fullName || g.username || '—')}</div>
            <div class="widget__row-detail">${escapeHtml(t('widgets.sinceTime', { time: inT }))}</div>
          </div>
          <div class="widget__row-aside">${escapeHtml(dur)}</div>
        </li>
      `;
    }
    html += `</ul></div>`;
  }

  if (done.length > 0) {
    html += `<div class="widget__section"><div class="widget__section-head">${escapeHtml(t('widgets.doneForTheDay'))}</div><ul class="widget__list">`;
    for (const g of done) {
      const dur = humanDuration(workedMsFromPairs(g.pairs));
      const pairsText = g.pairs
        .map((p) => `${timeOnly(p.in.ts)}–${timeOnly(p.out.ts)}`)
        .join(', ');
      html += `
        <li class="widget__row">
          <div class="widget__row-main">
            <div class="widget__row-name">${escapeHtml(g.fullName || g.username || '—')}</div>
            <div class="widget__row-detail">${escapeHtml(pairsText)}</div>
          </div>
          <div class="widget__row-aside">${escapeHtml(dur)}</div>
        </li>
      `;
    }
    html += `</ul></div>`;
  }

  setWidgetBody(widgetEl, html);
}

function renderOnLeaveTodayEmployer(widgetEl, approvedLeaves) {
  // /api/leaves/approved already enriches each leave with `fullName` and
  // `username`, so we don't need the employeesById map here.
  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  const onLeave = approvedLeaves.filter((l) => {
    // Each leave has start/end as YYYY-MM-DD (day-unit) or ISO ts (hours-unit).
    // Normalize both ends to YYYY-MM-DD by slicing.
    const startYmd = String(l.start).slice(0, 10);
    const endYmd   = String(l.end).slice(0, 10);
    return startYmd <= todayYmd && todayYmd <= endYmd;
  });

  if (onLeave.length === 0) {
    setWidgetBody(widgetEl, `<div class="widget__empty">${escapeHtml(t('widgets.noOneOnLeave'))}</div>`);
    return;
  }

  let html = `<ul class="widget__list">`;
  for (const l of onLeave) {
    const name = l.fullName || l.username || '—';
    const typeLabel = t('leaves.type.' + l.type);
    html += `
      <li class="widget__row">
        <div class="widget__row-main">
          <div class="widget__row-name">${escapeHtml(name)}</div>
          <div class="widget__row-detail">${escapeHtml(typeLabel)}</div>
        </div>
        <div class="widget__row-aside">
          <a href="/leaves/${escapeHtml(l.id)}" class="widget__action">${escapeHtml(t('widgets.viewAll'))}</a>
        </div>
      </li>
    `;
  }
  html += `</ul>`;
  setWidgetBody(widgetEl, html);
}

// ---- Renderers — employee ---------------------------------------------

function renderPendingApprovalsEmployee(widgetEl, leaves, corrections) {
  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const pendingCorrections = corrections.filter((c) => c.status === 'pending');
  if (pendingLeaves.length === 0 && pendingCorrections.length === 0) {
    setWidgetBody(widgetEl, `<div class="widget__empty">${escapeHtml(t('widgets.allCaughtUp'))}</div>`);
    return;
  }
  setWidgetBody(widgetEl, `
    <div class="widget__row">
      <div class="widget__row-main">
        <div class="widget__row-name">
          <a href="/leaves">${escapeHtml(t('widgets.pendingLeaves'))}</a>
        </div>
      </div>
      <div class="widget__row-aside">
        <span class="widget__count${pendingLeaves.length === 0 ? ' widget__count--zero' : ''}">${pendingLeaves.length}</span>
      </div>
    </div>
    <div class="widget__row">
      <div class="widget__row-main">
        <div class="widget__row-name">
          <a href="/corrections">${escapeHtml(t('widgets.pendingCorrections'))}</a>
        </div>
      </div>
      <div class="widget__row-aside">
        <span class="widget__count${pendingCorrections.length === 0 ? ' widget__count--zero' : ''}">${pendingCorrections.length}</span>
      </div>
    </div>
  `);
}

function renderTodayHoursEmployee(widgetEl, todayPunches, workingTime) {
  // todayPunches is the user's own punches for today (already filtered by
  // the API since we're an employee).
  const groups = groupPunchesByEmployee(todayPunches.map((p) => ({ ...p, employeeId: 'self' })), new Map());
  const g = groups[0];
  const target = workingTime?.dailyHours ? `${workingTime.dailyHours}h` : null;

  if (!g) {
    // No punches today.
    setWidgetBody(widgetEl, `
      <div class="widget__bignum widget__bignum--muted">0<span class="widget__bignum-suffix">h</span></div>
      <div class="widget__caption">${escapeHtml(t('widgets.notClockedInYet'))}</div>
      <div style="margin-top: var(--gap-3)">
        <a href="/punch" class="widget__action">${escapeHtml(t('widgets.goClockIn'))}</a>
      </div>
    `);
    return;
  }

  const totalMs = workedMsFromPairs(g.pairs) + openDurationMs(g.openInPunch);
  const totalHrs = totalMs / 3_600_000;
  const wholeHrs = Math.floor(totalHrs);
  const minStr   = String(Math.round((totalHrs - wholeHrs) * 60)).padStart(2, '0');

  let captionHtml = '';
  if (g.openInPunch) {
    captionHtml = `<div class="widget__caption">${escapeHtml(t('widgets.currentlyClockedIn', { time: timeOnly(g.openInPunch.ts) }))}</div>`;
  } else if (target) {
    captionHtml = `<div class="widget__caption">${escapeHtml(t('widgets.todayTarget', { target }))}</div>`;
  }

  setWidgetBody(widgetEl, `
    <div class="widget__bignum">${wholeHrs}<span class="widget__bignum-suffix">h ${minStr}m</span></div>
    ${captionHtml}
  `);
}

function renderBankSummaryEmployee(widgetEl, bank) {
  const hours = bank?.hours ?? 0;
  if (hours === 0) {
    setWidgetBody(widgetEl, `
      <div class="widget__bignum widget__bignum--muted">0<span class="widget__bignum-suffix">h</span></div>
      <div class="widget__caption">${escapeHtml(t('widgets.bankZero'))}</div>
    `);
    return;
  }
  setWidgetBody(widgetEl, `
    <div class="widget__bignum">${escapeHtml(formatBankHours(hours))}</div>
    <div class="widget__caption">${escapeHtml(t('widgets.bankExplain'))}</div>
    <div style="margin-top: var(--gap-3)">
      <a href="/corrections" class="widget__action">${escapeHtml(t('widgets.bankViewDetails'))}</a>
    </div>
  `);
}

// ---- Orchestration -----------------------------------------------------

/** Build the widget shells in order, return references for the loaders. */
function buildEmployerWidgets(grid) {
  const pending  = buildWidget({ titleKey: 'widgets.pendingApprovals' });
  const working  = buildWidget({ titleKey: 'widgets.workingToday',
                                 action: { href: '/punches/today', labelKey: 'widgets.viewAll' } });
  const onLeave  = buildWidget({ titleKey: 'widgets.onLeaveToday',
                                 action: { href: '/leaves/calendar', labelKey: 'widgets.viewAll' },
                                 wide: true });
  grid.appendChild(pending);
  grid.appendChild(working);
  grid.appendChild(onLeave);
  return { pending, working, onLeave };
}

function buildEmployeeWidgets(grid) {
  const pending = buildWidget({ titleKey: 'widgets.myPending' });
  const today   = buildWidget({ titleKey: 'widgets.todayHours',
                                action: { href: '/punch', labelKey: 'widgets.viewAll' } });
  const bank    = buildWidget({ titleKey: 'widgets.bankSummary',
                                action: { href: '/corrections', labelKey: 'widgets.viewAll' },
                                wide: true });
  grid.appendChild(pending);
  grid.appendChild(today);
  grid.appendChild(bank);
  return { pending, today, bank };
}

async function loadEmployerWidgets(widgets) {
  // Show loading state on each widget.
  Object.values(widgets).forEach(widgetLoading);

  // Fetch everything in parallel. Settled (not all) so one failure doesn't
  // tank the others — each gets per-widget error treatment below.
  const [emp, leaves, corrections, today, approved] = await Promise.allSettled([
    fetchJson('/api/employees'),
    fetchJson('/api/leaves'),
    fetchJson('/api/corrections?status=pending'),
    fetchJson('/api/punches/today'),
    fetchJson('/api/leaves/approved'),
  ]);

  // Build employee map from /api/employees if it succeeded; otherwise {}.
  const employeesById = new Map();
  if (emp.status === 'fulfilled') {
    for (const e of (emp.value.employees ?? [])) {
      employeesById.set(e.id, e);
    }
  }

  // Pending approvals widget.
  if (leaves.status === 'fulfilled' && corrections.status === 'fulfilled') {
    renderPendingApprovalsEmployer(widgets.pending,
      leaves.value.leaves ?? [],
      corrections.value.corrections ?? []);
  } else {
    widgetError(widgets.pending, () => loadEmployerWidgets(widgets));
  }

  // Working today widget.
  if (today.status === 'fulfilled') {
    renderWorkingTodayEmployer(widgets.working,
      today.value.punches ?? [],
      employeesById);
  } else {
    widgetError(widgets.working, () => loadEmployerWidgets(widgets));
  }

  // On-leave-today widget.
  if (approved.status === 'fulfilled') {
    renderOnLeaveTodayEmployer(widgets.onLeave,
      approved.value.leaves ?? []);
  } else {
    widgetError(widgets.onLeave, () => loadEmployerWidgets(widgets));
  }
}

async function loadEmployeeWidgets(widgets) {
  Object.values(widgets).forEach(widgetLoading);

  const [leaves, corrections, today, bank, wt] = await Promise.allSettled([
    fetchJson('/api/leaves'),
    fetchJson('/api/corrections?status=pending'),
    fetchJson('/api/punches/today'),
    fetchJson('/api/corrections/bank'),
    fetchJson('/api/settings/working-time'),
  ]);

  if (leaves.status === 'fulfilled' && corrections.status === 'fulfilled') {
    renderPendingApprovalsEmployee(widgets.pending,
      leaves.value.leaves ?? [],
      corrections.value.corrections ?? []);
  } else {
    widgetError(widgets.pending, () => loadEmployeeWidgets(widgets));
  }

  if (today.status === 'fulfilled') {
    renderTodayHoursEmployee(widgets.today,
      today.value.punches ?? [],
      wt.status === 'fulfilled' ? wt.value.workingTime : null);
  } else {
    widgetError(widgets.today, () => loadEmployeeWidgets(widgets));
  }

  if (bank.status === 'fulfilled') {
    renderBankSummaryEmployee(widgets.bank, bank.value);
  } else {
    widgetError(widgets.bank, () => loadEmployeeWidgets(widgets));
  }
}

// ---- Boot --------------------------------------------------------------

(async () => {
  const data = await mountTopBar();
  mountFooter();
  if (!data) return; // mountTopBar redirected to /login

  // Welcome heading + role line.
  const companyName = data.branding?.name || 'Pica';
  const welcomeEl = document.getElementById('welcome');
  if (welcomeEl) welcomeEl.textContent = t('dashboard.welcome', { name: companyName });
  const signedInEl = document.getElementById('signed-in-line');
  if (signedInEl) {
    signedInEl.textContent = t('dashboard.signedIn', {
      name: data.user.fullName || data.user.username,
      role: data.user.role,
    });
  }

  // Build widgets for the user's role.
  const grid = document.getElementById('widget-grid');
  let widgets;
  let loader;
  if (data.user.role === 'employer') {
    widgets = buildEmployerWidgets(grid);
    loader = () => loadEmployerWidgets(widgets);
  } else {
    widgets = buildEmployeeWidgets(grid);
    loader = () => loadEmployeeWidgets(widgets);
  }

  // Initial load.
  loader();

  // Refresh on tab visibility change. When the user comes back to this
  // tab after working in another, the widgets should reflect what's
  // current — punches drift, leaves get filed, corrections get
  // approved. Cheap: only fires when the user is actually looking.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loader();
  });

  // Quick-nav cards stay below the widgets.
  renderNavCards(data.user.role);
})();
