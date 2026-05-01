import {
  hoursReport, leavesReport,
  hoursReportToCsv, leavesReportToCsv,
} from '../storage/reports.js';

/**
 * Reports endpoints. All require authentication. Access follows the
 * same pattern as employees/leaves: owner or employer.
 *
 * Routes:
 *   GET /api/reports/hours/:id[.csv]?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|week|month
 *   GET /api/reports/leaves/:id[.csv]?year=YYYY&month=MM
 *   GET /api/reports/summary                          — employer only
 */
export function registerReportRoutes(router, {
  punchesStore,
  leavesStore,
  usersStore,
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
    if (!user) return res.notFound('Employee not found');
    const { from, to, groupBy } = parseHoursQuery(req.query);
    try {
      const report = hoursReport(punchesStore, user.id, from, to, groupBy);
      const fname = `pica-hours-${user.username}-${from}-to-${to}-${groupBy}.csv`;
      sendCsv(res, fname, hoursReportToCsv(report));
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  // Hours — JSON
  // --------------------------------------------------------------------------
  router.get('/api/reports/hours/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found');
    const { from, to, groupBy } = parseHoursQuery(req.query);
    try {
      const report = hoursReport(punchesStore, user.id, from, to, groupBy);
      res.json({ ...report, username: user.username });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  // Leaves — CSV export (before JSON route, same reason)
  // --------------------------------------------------------------------------
  router.get('/api/reports/leaves/:id.csv', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found');
    const { year, month } = parseMonthQuery(req.query);
    try {
      const report = leavesReport(leavesStore, user.id, year, month);
      const fname = `pica-leaves-${user.username}-${year}-${String(month).padStart(2,'0')}.csv`;
      sendCsv(res, fname, leavesReportToCsv(report));
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  // Leaves — JSON
  // --------------------------------------------------------------------------
  router.get('/api/reports/leaves/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found');
    const { year, month } = parseMonthQuery(req.query);
    try {
      const report = leavesReport(leavesStore, user.id, year, month);
      res.json({ ...report, username: user.username });
    } catch (err) {
      return res.badRequest(err.message);
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
