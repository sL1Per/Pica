import {
  hoursReport, leavesReport,
  hoursReportToCsv, leavesReportToCsv,
} from '../storage/reports.js';
import { computePeriod } from '../storage/period.js';

/**
 * Reports endpoints. All require authentication. Access follows the
 * same pattern as employees/leaves: owner or employer.
 *
 * Routes:
 *   GET /api/reports/hours/:id[.csv]?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|week|month
 *   GET /api/reports/leaves/:id[.csv]?year=YYYY&month=MM
 *   GET /api/reports/summary                          — employer only
 *   GET /api/reports/team-hours?period=today|week|month — employer only
 */
export function registerReportRoutes(router, {
  punchesStore,
  leavesStore,
  usersStore,
  employeesStore,
  orgSettingsStore,
  requireAuth,
  requireRole,
  requireOwnerOrEmployer,
}) {

  // Default range helpers.
  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function firstOfMonthYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  }
  function thisYearMonth() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function sendCsv(res, filename, body) {
    const buf = Buffer.from(body, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buf.length,
      'Cache-Control': 'private, no-store',
    });
    res.end(buf);
  }

  // --------------------------------------------------------------------------
  // Hours — CSV export (registered BEFORE the JSON route so the router
  // matches the more specific pattern first).
  // --------------------------------------------------------------------------
  router.get('/api/reports/hours/:id.csv', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });
    const { from, to, groupBy } = parseHoursQuery(req.query);
    try {
      const report = hoursReport(punchesStore, user.id, from, to, groupBy);
      const fname = `pica-hours-${user.username}-${from}-to-${to}-${groupBy}.csv`;
      sendCsv(res, fname, hoursReportToCsv(report));
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  // Hours — JSON
  // --------------------------------------------------------------------------
  router.get('/api/reports/hours/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });
    const { from, to, groupBy } = parseHoursQuery(req.query);
    try {
      const report = hoursReport(punchesStore, user.id, from, to, groupBy);
      res.json({ ...report, username: user.username });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  // Leaves — CSV export (before JSON route, same reason)
  // --------------------------------------------------------------------------
  router.get('/api/reports/leaves/:id.csv', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });
    const { year, month } = parseMonthQuery(req.query);
    try {
      const report = leavesReport(leavesStore, user.id, year, month);
      const fname = `pica-leaves-${user.username}-${year}-${String(month).padStart(2,'0')}.csv`;
      sendCsv(res, fname, leavesReportToCsv(report));
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  // Leaves — JSON
  // --------------------------------------------------------------------------
  router.get('/api/reports/leaves/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });
    const { year, month } = parseMonthQuery(req.query);
    try {
      const report = leavesReport(leavesStore, user.id, year, month);
      res.json({ ...report, username: user.username });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  // Team summary (employer only).
  // Hours this month + leave counts per employee.
  // --------------------------------------------------------------------------
  router.get('/api/reports/summary', requireRole('employer')((req, res) => {
    const { year, month } = thisYearMonth();
    const first = `${year}-${String(month).padStart(2,'0')}-01`;
    const last = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2,'0')}-${String(last).padStart(2,'0')}`;

    const rows = usersStore.list().map((u) => {
      let hours = 0;
      try {
        hours = hoursReport(punchesStore, u.id, first, to, 'month').totalHours;
      } catch {}
      let leavesSummary = { approved: 0, pending: 0, rejected: 0, cancelled: 0, approvedDaysOff: 0 };
      try {
        const r = leavesReport(leavesStore, u.id, year, month);
        leavesSummary = {
          approved:  r.byStatus.approved  ?? 0,
          pending:   r.byStatus.pending   ?? 0,
          rejected:  r.byStatus.rejected  ?? 0,
          cancelled: r.byStatus.cancelled ?? 0,
          approvedDaysOff: r.approvedDaysOff,
        };
      } catch {}
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        hoursThisMonth: hours,
        leaves: leavesSummary,
      };
    });

    res.json({
      year, month,
      employees: rows,
    });
  }));

  // --------------------------------------------------------------------------
  // Team hours (employer only).
  //
  // Cross-employee table for a single time window. Three windows
  // selectable via the `period` query parameter:
  //   - today: the current calendar day [today, today]
  //   - week:  the ISO week containing today (Mon-Sun)
  //   - month: the current calendar month [1st, last day]
  //
  // For each employee returns the period boundaries plus their
  // worked hours (computed from punches, accurate to ±0.1h) and
  // their scheduled hours for the same window (computed from the
  // org's working-time settings, applying any per-employee
  // override).
  //
  // Scheduled hours computation:
  //   today:    dailyHours
  //   week:     weeklyHours
  //   month:    dailyHours × number-of-weekdays-in-the-month
  //             (excluding Saturday and Sunday — matches the most
  //              common European workweek expectation; doesn't yet
  //              account for public holidays)
  //
  // Both numbers are rounded to one decimal place to match the
  // hoursReport convention.
  // --------------------------------------------------------------------------
  router.get('/api/reports/team-hours', requireRole('employer')((req, res) => {
    const period = (req.query?.period || 'month').toLowerCase();
    if (!['today', 'week', 'month'].includes(period)) {
      return res.badRequest("period must be 'today', 'week' or 'month'", { errorCode: 'invalid_value' });
    }

    const now = new Date();
    const { from, to, label, weekdays } = computePeriod(period, now);

    // Build name + picture map by reading the employee profile list
    // (encrypted; reads decrypt at this layer). Avoids leaking PII to
    // employees because the route is employer-only above.
    const profiles = new Map();
    if (employeesStore && typeof employeesStore.list === 'function') {
      for (const e of employeesStore.list()) {
        profiles.set(e.id, e);
      }
    }

    const rows = usersStore.list().map((u) => {
      const profile = profiles.get(u.id);
      const fullName = profile?.fullName ?? null;
      const hasPicture = !!profile?.hasPicture;

      // Worked hours via the existing helper. Total only — we don't
      // need the per-bucket breakdown for this view.
      let worked = 0;
      try {
        worked = hoursReport(punchesStore, u.id, from, to, 'day').totalHours;
      } catch {
        // Defensive: if a single user's punches can't be read, skip
        // them rather than tanking the whole table.
      }

      // Scheduled hours from org settings (with per-user overrides).
      const wt = orgSettingsStore?.resolveWorkingTimeFor
        ? orgSettingsStore.resolveWorkingTimeFor(u.id)
        : { dailyHours: 8, weeklyHours: 40 };
      let scheduled;
      if (period === 'today') scheduled = wt.dailyHours;
      else if (period === 'week') scheduled = wt.weeklyHours;
      else scheduled = round1(wt.dailyHours * weekdays);

      return {
        id: u.id,
        username: u.username,
        role: u.role,
        fullName,
        hasPicture,
        scheduled,
        worked,
      };
    });

    // Sort by name then username, alphabetical, for stable display.
    rows.sort((a, b) => {
      const an = (a.fullName || a.username).toLowerCase();
      const bn = (b.fullName || b.username).toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });

    res.json({ period, label, from, to, rows });
  }));

  // --------------------------------------------------------------------------
  // Query parsing helpers
  // --------------------------------------------------------------------------

  function parseHoursQuery(q) {
    return {
      from:    q.from    || firstOfMonthYmd(),
      to:      q.to      || todayYmd(),
      groupBy: q.groupBy || 'day',
    };
  }

  function parseMonthQuery(q) {
    const now = thisYearMonth();
    const year  = q.year  ? Number(q.year)  : now.year;
    const month = q.month ? Number(q.month) : now.month;
    return { year, month };
  }

  // Mark unused hook as used to silence linters; kept for future per-route guards.
  void requireAuth;
}

// ---- Local helpers -------------------------------------------------------

function round1(h) { return Math.round(h * 10) / 10; }
