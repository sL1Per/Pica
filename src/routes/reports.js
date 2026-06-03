import {
  hoursReport, leavesRangeReport, hoursMatrix, leavesMatrix,
  timesheetSingleCsv, timesheetMatrixCsv, leavesSingleCsv, leavesMatrixCsv,
  approxDaysOff,
} from '../storage/reports.js';
import { resolvePeriod, defaultAnchor } from '../storage/period.js';
import { isUuid } from '../util/validators.js';
import { buildOverview } from '../storage/report-overview.js';
import { LEAVE_TYPES_LIST } from '../storage/leaves.js';

/**
 * Reports endpoints — scope-aware timesheets and leaves.
 *
 *   GET /api/reports/timesheets?scope=me|all&id=<uid>&type=day|week|month|year&anchor=YYYY-MM-DD[&format=csv]
 *   GET /api/reports/leaves?scope=me|all&id=<uid>&type=...&anchor=...[&format=csv]
 *
 * The MAIN RULE (security-critical): the SERVER decides scope, never the
 * client. An employer sees everyone; an employee only ever sees
 * themselves. `scope=all` from a non-employer is a 403 with no data.
 * A `?id=` from a non-employer is ignored — it is coerced to the
 * caller's own id. We never trust client-supplied scope/id.
 */

const TYPES = ['day', 'week', 'month', 'year'];

export function registerReportRoutes(router, {
  punchesStore,
  leavesStore,
  usersStore,
  employeesStore,
  orgSettingsStore,
  // server.js also passes requireRole/requireOwnerOrEmployer;
  // accepted for call-site compatibility but access is enforced inline below
  // (the role check is simpler and self-contained than the generic wrappers).
  requireAuth,
  requireRole,
  requireOwnerOrEmployer,
}) {
  void requireRole;
  void requireOwnerOrEmployer;

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

  /**
   * Parse the shared query (type/anchor/scope/id) and resolve the access
   * decision. Returns null after writing an error response; otherwise
   * { period, scope, targetId, format }.
   *
   * targetId is null for scope=all. For scope=me it is the caller's own
   * id UNLESS the caller is an employer who explicitly passed ?id=, in
   * which case it is that id (so an employer can view one employee).
   */
  function parseCommon(req, res) {
    const q = req.query || {};
    const type = (q.type || 'month').toLowerCase();
    if (!TYPES.includes(type)) {
      res.badRequest('type must be day|week|month|year', { errorCode: 'invalid_value' });
      return null;
    }
    const anchor = q.anchor || defaultAnchor(type);
    let period;
    try {
      period = resolvePeriod(type, anchor);
    } catch {
      res.badRequest('bad anchor', { errorCode: 'invalid_value' });
      return null;
    }

    const isEmployer = req.user.role === 'employer';
    const wantAll = q.scope === 'all';
    if (wantAll && !isEmployer) {
      res.forbidden('Employer only', { errorCode: 'forbidden' });
      return null;
    }
    const scope = wantAll ? 'all' : 'me';
    // Server-decided target: only an employer's explicit ?id is honored;
    // everyone else is pinned to their own id regardless of ?id.
    const targetId = scope === 'all'
      ? null
      : (isEmployer && q.id ? q.id : req.user.id);
    if (targetId && !isUuid(targetId)) {
      res.badRequest('bad id', { errorCode: 'invalid_value' });
      return null;
    }
    return { period, scope, targetId, format: q.format };
  }

  /** Employer-facing user list with display names, sorted by name. */
  function employerUserList() {
    const profiles = new Map();
    if (employeesStore && typeof employeesStore.list === 'function') {
      for (const e of employeesStore.list()) profiles.set(e.id, e);
    }
    return usersStore.list()
      .map((u) => ({ id: u.id, name: profiles.get(u.id)?.fullName || u.username }))
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  }

  /** Resolve a single user id to { user, name }, or null if unknown. */
  function singleName(userId) {
    const u = usersStore.findById(userId);
    if (!u) return null;
    const p = employeesStore && typeof employeesStore.list === 'function'
      ? employeesStore.list().find((e) => e.id === userId)
      : null;
    return { user: u, name: p?.fullName || u.username };
  }

  // --------------------------------------------------------------------------
  // Timesheets (hours)
  // --------------------------------------------------------------------------
  router.get('/api/reports/timesheets', requireAuth((req, res) => {
    const c = parseCommon(req, res);
    if (!c) return;
    const { period, scope, targetId, format } = c;
    const { from, to, bucketBy, label } = period;

    if (scope === 'all') {
      const m = hoursMatrix(punchesStore, employerUserList(), from, to, bucketBy);
      if (format === 'csv') {
        return sendCsv(res, `pica-timesheets-all-${label}.csv`,
          timesheetMatrixCsv(m, { periodLabel: label }));
      }
      return res.json({ scope, period, ...m });
    }

    const who = singleName(targetId);
    if (!who) return res.notFound('Employee not found', { errorCode: 'not_found' });
    let report;
    try {
      report = hoursReport(punchesStore, who.user.id, from, to, bucketBy);
    } catch (e) {
      return res.badRequest(e.message, { errorCode: 'invalid_value' });
    }
    if (format === 'csv') {
      return sendCsv(res, `pica-timesheets-${who.user.username}-${label}.csv`,
        timesheetSingleCsv(report, { employeeName: who.name, periodLabel: label }));
    }
    return res.json({ scope, period, employeeId: who.user.id, name: who.name, ...report });
  }));

  // --------------------------------------------------------------------------
  // Leaves
  // --------------------------------------------------------------------------
  router.get('/api/reports/leaves', requireAuth((req, res) => {
    const c = parseCommon(req, res);
    if (!c) return;
    const { period, scope, targetId, format } = c;
    const { from, to, bucketBy, label } = period;

    if (scope === 'all') {
      const m = leavesMatrix(leavesStore, employerUserList(), from, to, bucketBy);
      if (format === 'csv') {
        return sendCsv(res, `pica-leaves-all-${label}.csv`,
          leavesMatrixCsv(m, { periodLabel: label }));
      }
      return res.json({ scope, period, ...m });
    }

    const who = singleName(targetId);
    if (!who) return res.notFound('Employee not found', { errorCode: 'not_found' });
    const report = leavesRangeReport(leavesStore, who.user.id, from, to);
    if (format === 'csv') {
      return sendCsv(res, `pica-leaves-${who.user.username}-${label}.csv`,
        leavesSingleCsv(report, { employeeName: who.name, periodLabel: label }));
    }
    return res.json({ scope, period, employeeId: who.user.id, name: who.name, ...report });
  }));

  // --------------------------------------------------------------------------
  // Overview (dashboard aggregation)
  // --------------------------------------------------------------------------
  router.get('/api/reports/overview', requireAuth((req, res) => {
    const c = parseCommon(req, res);
    if (!c) return;
    const { period, scope, targetId } = c;
    const { from, to, bucketBy, label } = period;

    let people;
    if (scope === 'all') {
      people = employerUserList().map((u) => ({
        id: u.id, name: u.name,
        role: usersStore.findById(u.id)?.role ?? 'employee',
      }));
    } else {
      const who = singleName(targetId);
      if (!who) return res.notFound('Employee not found', { errorCode: 'not_found' });
      people = [{ id: who.user.id, name: who.name, role: who.user.role }];
    }

    const orgSettings = orgSettingsStore.get();
    const result = buildOverview({
      punchesStore, leavesStore, people, from, to, bucketBy, label,
      workingTimeFor: (uid) => orgSettingsStore.resolveWorkingTimeFor(uid),
      leaveCtx: { orgSettings, leaveTypes: LEAVE_TYPES_LIST, daysOf: approxDaysOff },
      scope,
    });
    return res.json(result);
  }));
}
