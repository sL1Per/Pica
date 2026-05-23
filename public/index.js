/**
 * Dashboard — welcome banner + role-specific widgets + quick-nav cards.
 *
 * Widgets fetched in parallel. Each widget renders independently:
 *   - A failure in one widget shows a per-widget error, doesn't break others.
 *   - All widgets share a single refresh cycle (one fetch per source).
 *   - Tab visibility change → re-fetch (cheap "live" feel without polling).
 */

import { mountTopBar, mountFooter } from '/topbar.js';
import { t, fmtDate, fmtTime, fmtHours, translateError } from '/i18n.js';
import { clockPunch } from '/geo.js';
import { toast } from '/app.js';

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

/**
 * Sum of break time between same-day sessions, in ms.
 * A break is the gap between consecutive (out → next in) — including
 * the gap from the last closed pair's out to a currently-open in.
 * Mirrors the helper on /punch and /punches/today.
 */
function breakMsFromGroup(g) {
  let total = 0;
  for (let i = 1; i < g.pairs.length; i++) {
    total += new Date(g.pairs[i].in.ts).getTime()
           - new Date(g.pairs[i - 1].out.ts).getTime();
  }
  if (g.openInPunch && g.pairs.length > 0) {
    const lastOut = g.pairs[g.pairs.length - 1].out.ts;
    total += new Date(g.openInPunch.ts).getTime() - new Date(lastOut).getTime();
  }
  return Math.max(0, total);
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
      let detail = t('widgets.sinceTime', { time: inT });
      const brk = breakMsFromGroup(g);
      if (brk > 0) detail += ` · ${t('punch.todayBreak', { dur: humanDuration(brk) })}`;
      html += `
        <li class="widget__row">
          <div class="widget__row-main">
            <div class="widget__row-name">${escapeHtml(g.fullName || g.username || '—')}</div>
            <div class="widget__row-detail">${escapeHtml(detail)}</div>
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
      let detail = pairsText;
      const brk = breakMsFromGroup(g);
      if (brk > 0) detail += ` · ${t('punch.todayBreak', { dur: humanDuration(brk) })}`;
      html += `
        <li class="widget__row">
          <div class="widget__row-main">
            <div class="widget__row-name">${escapeHtml(g.fullName || g.username || '—')}</div>
            <div class="widget__row-detail">${escapeHtml(detail)}</div>
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

// ===== Employee home (M15) =================================================

function greetingKeyFor(d) {
  const h = d.getHours();
  if (h < 5)  return 'home.greet.late';
  if (h < 12) return 'home.greet.morning';
  if (h < 18) return 'home.greet.afternoon';
  return 'home.greet.evening';
}

// punches ascending → {workedMs, open, segments:[{startMs,endMs,live}]}
function pairWorkedMs(punches, nowMs) {
  // punches: [{type,ts}] ascending. Returns {workedMs, open, segments:[{startMs,endMs,live}]}.
  let open = null, workedMs = 0; const segments = [];
  for (const p of punches) {
    if (p.type === 'in') open = new Date(p.ts).getTime();
    else if (p.type === 'out' && open != null) {
      const end = new Date(p.ts).getTime();
      segments.push({ startMs: open, endMs: end, live: false }); workedMs += end - open; open = null;
    }
  }
  let isOpen = false;
  if (open != null) { segments.push({ startMs: open, endMs: nowMs, live: true }); workedMs += nowMs - open; isOpen = true; }
  return { workedMs, open: isOpen, segments };
}

function weekBars(period, buckets, todayYmd) {
  // period:{from,to}; buckets:[{key:ymd,hours}]. Returns one entry per day from..to.
  // Use UTC noon to iterate — avoids local-midnight rollback in UTC+ timezones.
  const byKey = new Map(buckets.map((b) => [b.key, b.hours]));
  const out = []; const d = new Date(period.from + 'T12:00:00Z');
  const end = new Date(period.to + 'T12:00:00Z');
  while (d <= end) {
    const ymd = d.toISOString().slice(0, 10);
    out.push({ ymd, hours: byKey.get(ymd) || 0, today: ymd === todayYmd, dow: d.getUTCDay() });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function hhmm(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}
function fmtClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtHM(iso) {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Build the static home shell into <main>. Returns element refs for live bits.
function renderEmployeeHomeShell(main, user) {
  const first = (user.fullName || user.username || '').trim().split(/\s+/)[0] || user.username;
  main.innerHTML = `
    <div class="emp-home">
      <div class="emp-greet">
        <div>
          <h1 class="emp-greet__title">${escapeHtml(t(greetingKeyFor(new Date())))}, <em>${escapeHtml(first)}</em></h1>
          <div class="emp-greet__sub">${escapeHtml(fmtDate(new Date()))}</div>
        </div>
        <div class="emp-clock"><span class="emp-clock__dot"></span><span data-live-clock>${fmtClock(new Date())}</span></div>
      </div>
      <div class="emp-grid">
        <section class="emp-hero" data-hero aria-live="polite"></section>
        <div class="emp-col">
          <section class="emp-card" data-week></section>
          <section class="emp-card" data-leaves></section>
        </div>
      </div>
    </div>
  `;
  return {
    liveClock: main.querySelector('[data-live-clock]'),
    hero: main.querySelector('[data-hero]'),
    week: main.querySelector('[data-week]'),
    leaves: main.querySelector('[data-leaves]'),
  };
}

function renderHero(heroEl, todayPunches, onPunch) {
  const sorted = [...todayPunches].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const { workedMs, open, segments } = pairWorkedMs(sorted, Date.now());
  const { h, m } = hhmm(workedMs);
  const inAt = open ? segments.at(-1) : null;

  // Timeline window: 08:00 → 17:00 local, widened to fit any earlier/later activity.
  const dayStart = new Date(); dayStart.setHours(8, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(17, 0, 0, 0);
  let winStart = dayStart.getTime(), winEnd = dayEnd.getTime();
  for (const s of segments) { winStart = Math.min(winStart, s.startMs); winEnd = Math.max(winEnd, s.endMs); }
  const span = Math.max(1, winEnd - winStart);

  const legend = segments.map((s) =>
    `<span><i class="${s.live ? 'live' : ''}"></i>${escapeHtml(fmtHM(new Date(s.startMs).toISOString()))}–${s.live ? escapeHtml(t('home.now')) : escapeHtml(fmtHM(new Date(s.endMs).toISOString()))}</span>`
  ).join('');

  heroEl.innerHTML = `
    <div class="emp-hero__status${open ? ' emp-hero__status--working' : ''}">
      <span class="emp-hero__dot"></span>${escapeHtml(open ? t('home.workingNow') : t('home.notClockedIn'))}
    </div>
    <div>
      <div class="emp-hero__big">${String(h).padStart(2,'0')}<small>h</small>${String(m).padStart(2,'0')}</div>
      <div class="emp-hero__label">${open && inAt
        ? t('home.checkedInAt', { time: `<strong>${escapeHtml(fmtHM(new Date(inAt.startMs).toISOString()))}</strong>` })
        : escapeHtml(t('home.totalToday', { n: segments.length }))}</div>
    </div>
    <div>
      <div class="emp-timeline">
        <span class="emp-timeline__cap">${escapeHtml(fmtHM(new Date(winStart).toISOString()))}</span>
        <div class="emp-timeline__bar" data-segs></div>
        <span class="emp-timeline__cap">${escapeHtml(fmtHM(new Date(winEnd).toISOString()))}</span>
      </div>
      <div class="emp-timeline__legend">${legend}</div>
    </div>
    <button type="button" class="emp-punch${open ? ' emp-punch--out' : ''}" data-punch>
      ${escapeHtml(open ? t('home.checkOut') : t('home.checkIn'))}
    </button>
    <div class="emp-punch__help">${escapeHtml(open ? t('home.helpOut') : t('home.helpIn'))}</div>
  `;
  // Segments: set geometry via CSSOM (no inline style attribute in markup → CSP-clean).
  const bar = heroEl.querySelector('[data-segs]');
  for (const s of segments) {
    const seg = document.createElement('div');
    seg.className = 'emp-timeline__seg' + (s.live ? ' emp-timeline__seg--live' : '');
    seg.style.left = `${((s.startMs - winStart) / span) * 100}%`;
    seg.style.width = `${((s.endMs - s.startMs) / span) * 100}%`;
    bar.appendChild(seg);
  }
  const btn = heroEl.querySelector('[data-punch]');
  btn.addEventListener('click', () => onPunch(open, btn));
}

function renderWeek(weekEl, period, buckets, totalHours, weeklyTarget) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const bars = weekBars(period, buckets, todayYmd).filter((b) => b.dow >= 1 && b.dow <= 5); // Mon–Fri
  const maxH = Math.max(8, ...bars.map((b) => b.hours));
  const worked = totalHours || 0;
  const remaining = (weeklyTarget || 0) - worked;
  const dayLetters = ['', 'M', 'T', 'W', 'T', 'F'];
  weekEl.innerHTML = `
    <h3 class="emp-card__title">${escapeHtml(t('home.thisWeek'))}</h3>
    <div class="emp-week">
      <div class="emp-stat"><div class="emp-stat__val">${escapeHtml(fmtHours(worked))}<small>h</small></div><div class="emp-stat__label">${escapeHtml(t('home.worked'))}</div></div>
      <div class="emp-stat"><div class="emp-stat__val">${escapeHtml(fmtHours(weeklyTarget || 0))}<small>h</small></div><div class="emp-stat__label">${escapeHtml(t('home.target'))}</div></div>
      <div class="emp-stat"><div class="emp-stat__val${remaining < 0 ? ' emp-stat__val--neg' : ''}">${remaining < 0 ? '−' : ''}${escapeHtml(fmtHours(Math.abs(remaining)))}<small>h</small></div><div class="emp-stat__label">${escapeHtml(t('home.remaining'))}</div></div>
    </div>
    <div class="emp-weekbars" data-bars></div>
  `;
  const barsEl = weekEl.querySelector('[data-bars]');
  for (const b of bars) {
    const col = document.createElement('div'); col.className = 'emp-weekbars__col';
    const bar = document.createElement('div');
    bar.className = 'emp-weekbars__bar' + (b.today ? ' emp-weekbars__bar--today' : '') + (b.hours ? '' : ' emp-weekbars__bar--empty');
    bar.style.height = `${Math.max(4, (b.hours / maxH) * 100)}%`;
    const label = document.createElement('span');
    label.className = 'emp-weekbars__day' + (b.today ? ' emp-weekbars__day--today' : '');
    label.textContent = dayLetters[b.dow] || '';
    col.appendChild(bar); col.appendChild(label); barsEl.appendChild(col);
  }
}

function renderLeaves(leavesEl, leaves) {
  const todayYmd = new Date().toISOString().slice(0, 10);
  const upcoming = (leaves || [])
    .filter((l) => (l.status === 'approved' || l.status === 'pending') && String(l.end).slice(0, 10) >= todayYmd)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, 3);

  const rows = upcoming.map((l) => {
    const start = new Date(String(l.start).slice(0, 10) + 'T00:00:00');
    const endY = String(l.end).slice(0, 10), startY = String(l.start).slice(0, 10);
    const days = Math.max(1, Math.round((new Date(endY) - new Date(startY)) / 86400000) + 1);
    const typeLabel = t('leaves.type.' + l.type);
    const sub = l.unit === 'hours' ? typeLabel : t('home.leaveDays', { n: days, type: typeLabel });
    const pill = l.status === 'approved' ? 'approved' : 'pending';
    return `
      <div class="emp-leave">
        <div class="emp-leave__date">
          <div class="emp-leave__day">${start.getDate()}</div>
          <div class="emp-leave__mon">${escapeHtml(start.toLocaleString(undefined, { month: 'short' }))}</div>
        </div>
        <div>
          <div class="emp-leave__title">${escapeHtml(l.reason || typeLabel)}</div>
          <div class="emp-leave__sub">${escapeHtml(sub)}</div>
        </div>
        <a class="emp-leave__pill emp-leave__pill--${pill}" href="/leaves/${escapeHtml(l.id)}">${escapeHtml(t('leaves.status.' + l.status))}</a>
      </div>`;
  }).join('');

  leavesEl.innerHTML = `
    <div class="emp-card__head">
      <h3 class="emp-card__title">${escapeHtml(t('home.yourLeaves'))}</h3>
      <a class="emp-card__link" href="/leaves">${escapeHtml(t('home.seeAll'))}</a>
    </div>
    <div>${rows || `<div class="emp-empty">${escapeHtml(t('home.noUpcomingLeaves'))}</div>`}</div>
    <a class="emp-book" href="/leaves/new">+ ${escapeHtml(t('home.bookTimeOff'))}</a>
  `;
}

async function loadEmployeeHome(refs, user) {
  // Hero (today) — load first; it's the primary action.
  const refreshHero = async () => {
    try {
      const today = await fetchJson('/api/punches/today');
      renderHero(refs.hero, today.punches ?? [], onPunch);
    } catch { refs.hero.innerHTML = `<div class="emp-empty">${escapeHtml(t('widgets.couldNotLoad'))}</div>`; }
  };
  const onPunch = async (isOpen, btn) => {
    btn.disabled = true;
    try {
      await clockPunch(isOpen ? 'out' : 'in', {});
      await refreshHero();
    } catch (e) {
      toast(translateError(e.errorCode, t('home.punchFailed')), 'error');
      btn.disabled = false;
    }
  };
  await refreshHero();

  // This week.
  try {
    const ymd = new Date().toISOString().slice(0, 10);
    const [wk, wt] = await Promise.all([
      fetchJson(`/api/reports/timesheets?scope=me&type=week&anchor=${ymd}`),
      fetchJson('/api/settings/working-time').catch(() => ({ workingTime: {} })),
    ]);
    renderWeek(refs.week, wk.period, wk.buckets ?? [], wk.totalHours ?? 0, wt.workingTime?.weeklyHours ?? 0);
  } catch { refs.week.innerHTML = `<h3 class="emp-card__title">${escapeHtml(t('home.thisWeek'))}</h3><div class="emp-empty">${escapeHtml(t('widgets.couldNotLoad'))}</div>`; }

  // Leaves.
  try {
    const lv = await fetchJson('/api/leaves');
    renderLeaves(refs.leaves, lv.leaves ?? []);
  } catch { refs.leaves.innerHTML = `<div class="emp-empty">${escapeHtml(t('widgets.couldNotLoad'))}</div>`; }
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

  if (data.user.role === 'employer') {
    // Employer home is redesigned in a later M15 plan — keep the widgets.
    const grid = document.getElementById('widget-grid');
    const widgets = buildEmployerWidgets(grid);
    const loader = () => loadEmployerWidgets(widgets);
    loader();
    // Refresh on tab visibility change. When the user comes back to this
    // tab after working in another, the widgets should reflect what's
    // current — punches drift, leaves get filed, corrections get
    // approved. Cheap: only fires when the user is actually looking.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loader();
    });
    renderNavCards(data.user.role);
    return;
  }

  // Employee home (M15): replace <main> with the new layout.
  const main = document.querySelector('main');
  main.className = '';                 // drop .container--wide; the shell owns width
  const refs = renderEmployeeHomeShell(main, data.user);
  const tick = () => { if (refs.liveClock) refs.liveClock.textContent = fmtClock(new Date()); };
  setInterval(tick, 1000);
  await loadEmployeeHome(refs, data.user);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadEmployeeHome(refs, data.user);
  });
})();
