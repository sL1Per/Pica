import { LEAVE_TYPES_LIST, LEAVE_UNITS_LIST } from '../storage/leaves.js';

/**
 * Leaves endpoints.
 *
 * Route map:
 *   GET  /api/leaves                              — list (self / all depending on role)
 *   GET  /api/leaves/:id                          — one leave (owner or employer)
 *   POST /api/leaves                              — create (self)
 *   POST /api/leaves/:id/approve                  — employer only, pending → approved
 *   POST /api/leaves/:id/reject                   — employer only, pending → rejected
 *   POST /api/leaves/:id/cancel                   — owner if pending, employer any
 */
export function registerLeaveRoutes(router, {
  leavesStore,
  usersStore,
  employeesStore,
  orgSettingsStore,
  leaveTypes,
  daysOf,
  requireAuth,
  requireRole,
}) {

  /** Return a Map(userId → fullName|null) by scanning employee profiles. */
  function fullNameMap() {
    if (!employeesStore) return new Map();
    try {
      return new Map(employeesStore.list().map((e) => [e.id, e.fullName ?? null]));
    } catch {
      return new Map();
    }
  }

  function enrich(leave, usersById, namesById) {
    if (!leave) return leave;
    const u = usersById.get(leave.employeeId);
    return {
      ...leave,
      username: u?.username ?? null,
      fullName: namesById.get(leave.employeeId) ?? null,
      _partition: undefined,
    };
  }

  function usersByIdMap() {
    return new Map(usersStore.list().map((u) => [u.id, u]));
  }

  // --------------------------------------------------------------------------
  // GET /api/leaves/approved — a team-visible view of approved leaves only.
  //
  // Designed for the calendar: every authenticated user (employee or
  // employer) can see who's on approved leave and when, so they can plan
  // around each other. The `reason` and `notes` fields are stripped for
  // everyone — pending and rejected leaves never appear at all.
  // --------------------------------------------------------------------------
  router.get('/api/leaves/approved', requireAuth((req, res) => {
    const users = usersByIdMap();
    const names = fullNameMap();
    const leaves = leavesStore.list()
      .filter((l) => l.status === 'approved')
      .map((l) => {
        const redacted = enrich(l, users, names);
        redacted.reason = null;
        redacted.notes = null;
        return redacted;
      });
    res.json({ leaves });
  }));

  // --------------------------------------------------------------------------
  // GET /api/leaves/balances?year=YYYY — employer only, matrix across all
  // employees. Returns { year, rows: [{userId, username, fullName,
  // balances:[{type,allowance,pending,booked,remaining}]}, ...] }.
  // --------------------------------------------------------------------------
  router.get('/api/leaves/balances', requireRole('employer')((req, res) => {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const settings = orgSettingsStore.get();
    const users = usersStore.list();
    const names = fullNameMap();
    const rows = users.map((u) => ({
      userId: u.id,
      username: u.username,
      fullName: names.get(u.id) ?? null,
      role: u.role,
      balances: leavesStore.computeBalances({
        userId: u.id, year, orgSettings: settings, leaveTypes, daysOf,
      }),
    }));
    res.json({ year, rows });
  }));

  // --------------------------------------------------------------------------
  // GET /api/leaves/balances/:userId?year=YYYY — employees can hit their own;
  // employers can hit anyone's. Returns { year, userId, balances: [...] }.
  // --------------------------------------------------------------------------
  router.get('/api/leaves/balances/:userId', requireAuth((req, res) => {
    const { userId } = req.params;
    if (req.user.role !== 'employer' && req.user.id !== userId) {
      return res.forbidden('Not your balance');
    }
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const settings = orgSettingsStore.get();
    const balances = leavesStore.computeBalances({
      userId, year, orgSettings: settings, leaveTypes, daysOf,
    });
    res.json({ year, userId, balances });
  }));

  // --------------------------------------------------------------------------
  router.get('/api/leaves', requireAuth((req, res) => {
    const users = usersByIdMap();
    const names = fullNameMap();
    const filter = req.user.role === 'employer' ? {} : { employeeId: req.user.id };
    const leaves = leavesStore.list(filter).map((l) => enrich(l, users, names));
    res.json({ leaves });
  }));

  // --------------------------------------------------------------------------
  router.get('/api/leaves/:id', requireAuth((req, res) => {
    const leave = leavesStore.findById(req.params.id);
    if (!leave) return res.notFound('Leave not found');
    if (req.user.role !== 'employer' && leave.employeeId !== req.user.id) {
      return res.forbidden('Not your leave');
    }
    res.json({ leave: enrich(leave, usersByIdMap(), fullNameMap()) });
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves', requireAuth((req, res) => {
    const { type, unit, start, end, hours, reason } = req.body ?? {};

    if (!LEAVE_TYPES_LIST.includes(type)) {
      return res.badRequest(`type must be one of: ${LEAVE_TYPES_LIST.join(', ')}`);
    }
    if (!LEAVE_UNITS_LIST.includes(unit)) {
      return res.badRequest(`unit must be one of: ${LEAVE_UNITS_LIST.join(', ')}`);
    }

    try {
      const leave = leavesStore.create({
        employeeId: req.user.id,
        type, unit, start, end, hours, reason,
      });
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves/:id/approve', requireRole('employer')(async (req, res) => {
    const existing = leavesStore.findById(req.params.id);
    if (!existing) return res.notFound('Leave not found');
    try {
      const leave = leavesStore.approve(req.params.id, req.user.id);
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves/:id/reject', requireRole('employer')(async (req, res) => {
    const existing = leavesStore.findById(req.params.id);
    if (!existing) return res.notFound('Leave not found');
    const notes = req.body?.notes;
    try {
      const leave = leavesStore.reject(req.params.id, req.user.id, notes);
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves/:id/cancel', requireAuth((req, res) => {
    const existing = leavesStore.findById(req.params.id);
    if (!existing) return res.notFound('Leave not found');

    // Owner can cancel only while still pending.
    // Employer can cancel pending OR approved (not rejected/cancelled — transition() enforces).
    const isOwner = existing.employeeId === req.user.id;
    const isEmployer = req.user.role === 'employer';
    if (!isOwner && !isEmployer) return res.forbidden('Not your leave');
    if (isOwner && !isEmployer && existing.status !== 'pending') {
      return res.forbidden('You can only cancel leaves that are still pending');
    }

    try {
      const leave = leavesStore.cancel(req.params.id, req.user.id);
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));
}
