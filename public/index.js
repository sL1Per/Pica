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
import { pairSessions, workedMs, breakMs, groupByEmployee, classify, STATUS_SORT } from '/team-status.js';
import { approveLeaveWithCheck, rejectLeave } from '/leave-actions.js';

// ---- Helpers ------------------------------------------------------------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- Fetch wrapper with error capture ----------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

// ---- Employer home (M15, Plan 6) ---------------------------------------

function ehYmd(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function ehAnchor(off) { const d = new Date(); d.setDate(d.getDate() + off); return ehYmd(d); }

function durHM(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const tot = Math.round(ms / 60000), h = Math.floor(tot / 60), m = tot % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
function ehInitials(name) {
  return (String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')) || '?';
}
function ehHue(s) { let h = 0; for (const ch of String(s || '')) h = (h + ch.charCodeAt(0)) % 360; return h; }
function ehEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function ehAvatar(emp, name, cls = 'eh-avatar') {
  const a = ehEl('div', cls);
  if (emp?.hasPicture) { const img = ehEl('img'); img.src = `/api/employees/${emp.id}/picture`; img.alt = ''; a.appendChild(img); }
  else { a.textContent = ehInitials(name); a.style.setProperty('--hue', ehHue(name)); }
  return a;
}
function ehStatusDot(key) { const d = ehEl('span', `st-dot st-dot--${key}`); d.setAttribute('aria-hidden', 'true'); return d; }

const STATUS_LABEL = { working: 'team.status.working', break: 'team.status.break', done: 'team.status.done', leave: 'team.status.leave', off: 'team.status.off' };

function renderEmployerHome(main, user) {
  main.className = '';
  main.replaceChildren();
  const first = (user.fullName || user.username || '').trim().split(/\s+/)[0] || user.username;
  const home = ehEl('div', 'eh-home');
  const head = ehEl('div', 'eh-head');
  const headText = ehEl('div', 'eh-head__text');
  const title = ehEl('h1', 'eh-head__title');
  title.append(document.createTextNode(t(greetingKeyFor(new Date())) + ', '), ehEl('em', null, first));
  headText.append(title, ehEl('p', 'eh-head__sub', t('home.empSub')));
  // The live clock moved to the top-bar crumb (shown on every page), so it's
  // no longer duplicated in the home hero.
  head.append(headText);
  const stats = ehEl('div', 'eh-stats');
  const grid = ehEl('div', 'eh-grid');
  const left = ehEl('div', 'eh-col'), right = ehEl('div', 'eh-col');

  const teamCard = ehEl('section', 'eh-card');
  const teamHead = ehEl('div', 'eh-card__head');
  teamHead.append(ehEl('h2', 'eh-card__title', t('home.empTeamToday')));
  const teamLink = ehEl('a', 'eh-card__link', t('widgets.viewAll')); teamLink.href = '/employees';
  teamHead.append(teamLink);
  const teamBody = ehEl('div', 'eh-card__body');
  teamCard.append(teamHead, teamBody);
  left.append(teamCard);

  const waitCard = ehEl('section', 'eh-card');
  const waitHead = ehEl('div', 'eh-card__head');
  waitHead.append(ehEl('h2', 'eh-card__title', t('home.empWaiting')));
  const waitBody = ehEl('div', 'eh-card__body');
  waitCard.append(waitHead, waitBody);

  const hoursCard = ehEl('section', 'eh-card');
  const hoursHead = ehEl('div', 'eh-card__head');
  hoursHead.append(ehEl('h2', 'eh-card__title', t('home.empHoursTitle')));
  const hoursBody = ehEl('div', 'eh-card__body');
  hoursCard.append(hoursHead, hoursBody);

  right.append(waitCard, hoursCard);
  grid.append(left, right);
  home.append(head, stats, grid);
  main.append(home);
  return { stats, teamBody, waitBody, hoursBody, waitCard };
}

function ehStatHint(names) {
  if (names.length === 0) return ' ';
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? t('home.empNamesMore', { names: shown, n: names.length - 2 }) : shown;
}
function ehStatCard({ key, labelKey, count, hint, href, alert, onClick }) {
  const card = ehEl('button', 'eh-stat' + (alert ? ' eh-stat--alert' : '')); card.type = 'button';
  const label = ehEl('span', 'eh-stat__label');
  if (key) label.append(ehStatusDot(key));
  label.append(document.createTextNode(t(labelKey)));
  card.append(label, ehEl('span', 'eh-stat__num', String(count)), ehEl('span', 'eh-stat__hint', hint));
  card.addEventListener('click', onClick || (() => { if (href) window.location.href = href; }));
  return card;
}

function renderStatStrip(refs, rows, waitingCount) {
  const byStatus = (s) => rows.filter((r) => r.status === s);
  const firstNames = (rs) => rs.map((r) => (r.e.fullName || r.e.username || '').split(/\s+/)[0]).filter(Boolean);
  const working = byStatus('working'), brk = byStatus('break'), lv = byStatus('leave');
  refs.stats.replaceChildren(
    ehStatCard({ key: 'working', labelKey: 'home.empWorkingNow', count: working.length, hint: ehStatHint(firstNames(working)), href: '/employees' }),
    ehStatCard({ key: 'break', labelKey: 'home.empOnBreak', count: brk.length, hint: ehStatHint(firstNames(brk)), href: '/employees' }),
    ehStatCard({ key: 'leave', labelKey: 'home.empOnLeave', count: lv.length, hint: ehStatHint(firstNames(lv)), href: '/leaves/calendar' }),
    ehStatCard({ labelKey: 'home.empWaiting', count: waitingCount, hint: ' ', alert: waitingCount > 0, onClick: () => refs.waitCard.scrollIntoView({ behavior: 'smooth', block: 'start' }) }),
  );
}

function renderTeamToday(body, rows, errored) {
  if (errored) { body.replaceChildren(ehEl('div', 'eh-error', t('widgets.couldNotLoad'))); return; }
  if (rows.length === 0) { body.replaceChildren(ehEl('div', 'eh-empty', t('home.empNobody'))); return; }
  const sorted = [...rows].sort((a, b) => (STATUS_SORT[a.status] - STATUS_SORT[b.status])
    || (a.e.fullName || a.e.username || '').localeCompare(b.e.fullName || b.e.username || ''));
  const frag = document.createDocumentFragment();
  for (const r of sorted) {
    const name = r.e.fullName || r.e.username || '—';
    const row = ehEl('div', 'eh-row');
    row.append(ehAvatar(r.e, name));
    const main = ehEl('div', 'eh-row__main');
    const nameEl = ehEl('div', 'eh-row__name', name);
    nameEl.append(ehEl('span', 'eh-badge' + (r.e.role === 'employer' ? ' eh-badge--employer' : ''), t('employee.role.' + r.e.role)));
    const st = ehEl('div', 'eh-row__status');
    st.append(ehStatusDot(r.status), document.createTextNode(t(STATUS_LABEL[r.status])));
    main.append(nameEl, st);
    const aside = ehEl('div', 'eh-row__aside');
    if (r.status === 'working') {
      aside.append(ehEl('div', 'eh-row__dur', durHM(r.worked)));
      const since = r.pairs.find((p) => p.out === null)?.in?.ts;
      if (since) aside.append(ehEl('div', 'eh-row__meta', t('widgets.sinceTime', { time: fmtTime(since) })));
    } else if (r.status === 'break' || r.status === 'done') {
      aside.append(ehEl('div', 'eh-row__dur', durHM(r.worked)));
      const lastOut = r.pairs.length ? r.pairs[r.pairs.length - 1].out?.ts : null;
      if (lastOut) aside.append(ehEl('div', 'eh-row__meta', t('home.empLeftAt', { time: fmtTime(lastOut) })));
    } else {
      aside.append(ehEl('div', 'eh-row__meta', '—'));
    }
    row.append(main, aside);
    frag.append(row);
  }
  body.replaceChildren(frag);
}

function ehPendRow(emp, name, detail, onApprove, onReject) {
  const row = ehEl('div', 'eh-pend');
  row.append(ehAvatar(emp, name));
  const main = ehEl('div', 'eh-pend__main');
  main.append(ehEl('div', 'eh-pend__name', name), ehEl('div', 'eh-pend__detail', detail));
  const acts = ehEl('div', 'eh-pend__acts');
  const ok = ehEl('button', 'eh-act eh-act--approve', '✓'); ok.type = 'button'; ok.setAttribute('aria-label', t('corrections.inlineApprove'));
  const no = ehEl('button', 'eh-act eh-act--reject', '✗'); no.type = 'button'; no.setAttribute('aria-label', t('corrections.inlineReject'));
  acts.append(ok, no);
  const note = ehEl('div', 'eh-note'); note.hidden = true;
  const input = ehEl('input'); input.type = 'text'; input.maxLength = 500; input.placeholder = t('corrections.rejectNotesPlaceholder');
  const send = ehEl('button', 'eh-act eh-act--reject', '✗'); send.type = 'button'; send.setAttribute('aria-label', t('corrections.inlineReject'));
  note.append(input, send);
  ok.addEventListener('click', async () => { ok.disabled = no.disabled = true; await onApprove(); });
  no.addEventListener('click', () => { note.hidden = !note.hidden; if (!note.hidden) input.focus(); });
  send.addEventListener('click', async () => { send.disabled = true; await onReject(input.value.trim()); });
  row.append(main, acts, note);
  return row;
}

async function ehDecideCorrection(id, action, notes) {
  try {
    const res = await fetch(`/api/corrections/${encodeURIComponent(id)}/${action}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: action === 'reject' ? JSON.stringify({ notes: notes || '' }) : undefined,
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast(translateError(d.errorCode, d.error || t('widgets.couldNotLoad')), 'error'); return false; }
    return true;
  } catch { toast(t('widgets.couldNotLoad'), 'error'); return false; }
}

function ehRangeShort(l) {
  const s = String(l.start).slice(0, 10), e = String(l.end).slice(0, 10);
  if (l.unit === 'hours') return fmtDate(new Date(l.start));
  return s === e ? fmtDate(s) : `${fmtDate(s)} → ${fmtDate(e)}`;
}

function renderWaiting(refs, pendingLeaves, pendingCorrs, empById) {
  const body = refs.waitBody;
  const reload = () => loadEmployerHome(refs);
  if (pendingLeaves.length === 0 && pendingCorrs.length === 0) {
    const wrap = ehEl('div', 'eh-allcaught');
    wrap.append(ehEl('span', 'eh-allcaught__check', '✓'), document.createTextNode(t('widgets.allCaughtUp')));
    body.replaceChildren(wrap);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const l of pendingLeaves) {
    const emp = empById.get(l.employeeId);
    const name = emp?.fullName || emp?.username || '—';
    const detail = `${t('leaves.type.' + l.type)} · ${ehRangeShort(l)}`;
    frag.append(ehPendRow(emp, name, detail,
      async () => { const r = await approveLeaveWithCheck(l); if (r.ok) reload(); },
      async (notes) => { const r = await rejectLeave(l.id, notes); if (r.ok) reload(); }));
  }
  const KIND = { both: 'corrections.kindBoth', in: 'corrections.kindIn', out: 'corrections.kindOut' };
  for (const c of pendingCorrs) {
    const emp = empById.get(c.employeeId);
    const name = emp?.fullName || emp?.username || '—';
    const detail = `${t(KIND[c.kind] || 'corrections.kindBoth')} · ${fmtHours(c.hours || 0)}h`;
    frag.append(ehPendRow(emp, name, detail,
      async () => { const ok = await ehDecideCorrection(c.id, 'approve'); if (ok) reload(); },
      async (notes) => { const ok = await ehDecideCorrection(c.id, 'reject', notes); if (ok) reload(); }));
  }
  body.replaceChildren(frag);
}

function renderHoursWeek(body, wkThis, wkLast) {
  if (wkThis.status !== 'fulfilled') { body.replaceChildren(ehEl('div', 'eh-error', t('widgets.couldNotLoad'))); return; }
  const m = wkThis.value;
  const total = m.grandTotal ?? (m.rows || []).reduce((acc, r) => acc + (r.total || 0), 0);
  const lastTotal = wkLast.status === 'fulfilled' ? (wkLast.value.grandTotal ?? null) : null;

  const wrap = document.createDocumentFragment();
  const big = ehEl('div', 'eh-hours__big');
  big.append(document.createTextNode(fmtHours(total)), ehEl('small', null, 'h'));
  if (lastTotal != null) {
    const delta = Math.round((total - lastTotal) * 10) / 10;
    big.append(ehEl('span', 'eh-delta ' + (delta >= 0 ? 'eh-delta--up' : 'eh-delta--down'),
      t('home.empHoursDelta', { delta: (delta >= 0 ? '+' : '−') + fmtHours(Math.abs(delta)) })));
  }
  wrap.append(big);

  const bucketObjs = (m.buckets || []).map((k) => ({ key: k, hours: m.bucketTotals?.[k] || 0 }));
  const bars = weekBars({ from: m.from, to: m.to }, bucketObjs, ehYmd(new Date())).filter((b) => b.dow >= 1 && b.dow <= 5);
  const maxH = Math.max(8, ...bars.map((b) => b.hours));
  const dayLetters = ['', 'M', 'T', 'W', 'T', 'F'];
  const barsEl = ehEl('div', 'emp-weekbars');
  for (const b of bars) {
    const col = ehEl('div', 'emp-weekbars__col');
    const bar = ehEl('div', 'emp-weekbars__bar' + (b.today ? ' emp-weekbars__bar--today' : '') + (b.hours ? '' : ' emp-weekbars__bar--empty'));
    bar.style.height = `${Math.max(4, (b.hours / maxH) * 100)}%`;
    col.append(bar, ehEl('div', 'emp-weekbars__day' + (b.today ? ' emp-weekbars__day--today' : ''), dayLetters[b.dow] || ''));
    barsEl.append(col);
  }
  wrap.append(barsEl);
  body.replaceChildren(wrap);
}

async function loadEmployerHome(refs) {
  const [emp, today, leaves, corrs, approved, wkThis, wkLast] = await Promise.allSettled([
    fetchJson('/api/employees'),
    fetchJson('/api/punches/today'),
    fetchJson('/api/leaves'),
    fetchJson('/api/corrections?status=pending'),
    fetchJson('/api/leaves/approved'),
    fetchJson(`/api/reports/timesheets?scope=all&type=week&anchor=${ehAnchor(0)}`),
    fetchJson(`/api/reports/timesheets?scope=all&type=week&anchor=${ehAnchor(-7)}`),
  ]);

  const employees = emp.status === 'fulfilled' ? (emp.value.employees ?? []) : [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  const todayPunches = today.status === 'fulfilled' ? (today.value.punches ?? []) : [];
  const byEmp = groupByEmployee(todayPunches);
  const ymd = ehYmd(new Date());
  const approvedLeaves = approved.status === 'fulfilled' ? (approved.value.leaves ?? []) : [];
  const onLeaveIds = new Set();
  for (const l of approvedLeaves) {
    const s = String(l.start).slice(0, 10), e = String(l.end).slice(0, 10);
    if (s <= ymd && ymd <= e) onLeaveIds.add(l.employeeId);
  }
  const nowHour = new Date().getHours();
  const rows = employees.map((e) => {
    const pairs = pairSessions(byEmp.get(e.id) ?? []);
    const onLeave = onLeaveIds.has(e.id);
    return { e, pairs, status: classify({ pairs, onLeave, nowHour }), worked: workedMs(pairs), brk: breakMs(pairs) };
  });
  const pendingLeaves = leaves.status === 'fulfilled' ? (leaves.value.leaves ?? []).filter((l) => l.status === 'pending') : [];
  const pendingCorrs = corrs.status === 'fulfilled' ? (corrs.value.corrections ?? []) : [];

  renderStatStrip(refs, rows, pendingLeaves.length + pendingCorrs.length);
  renderTeamToday(refs.teamBody, rows, today.status !== 'fulfilled');
  renderWaiting(refs, pendingLeaves, pendingCorrs, empById);
  renderHoursWeek(refs.hoursBody, wkThis, wkLast);
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
    const main = document.querySelector('main');
    const refs = renderEmployerHome(main, data.user);
    const loader = () => loadEmployerHome(refs);
    loader();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loader();
    });
    return;
  }

  // Employee home (M15): replace <main> with the new layout.
  const main = document.querySelector('main');
  main.className = '';                 // drop .container--wide; the shell owns width
  const refs = renderEmployeeHomeShell(main, data.user);
  await loadEmployeeHome(refs, data.user);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadEmployeeHome(refs, data.user);
  });
})();
