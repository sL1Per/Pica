/**
 * Time-correction routes.
 *
 *   GET  /api/corrections                     — list (employee: own; employer: all)
 *   GET  /api/corrections/bank                — current user's bank balance
 *   GET  /api/corrections/bank/:userId        — employer only
 *   GET  /api/corrections/:id                 — single, owner or employer
 *   POST /api/corrections                     — create, employee
 *   POST /api/corrections/:id/approve         — employer; materializes punches
 *   POST /api/corrections/:id/reject          — employer
 *   POST /api/corrections/:id/cancel          — owner if pending; employer any
 *
 * Approval flow:
 *   1. Validate transition is legal (storage layer enforces too).
 *   2. Materialize the correction as two punch records (in, out) using
 *      the punchesStore, with clientIds "correction:<id>:in" and
 *      "correction:<id>:out" so the punch idempotency check prevents
 *      double-materialization on re-approve.
 *   3. Persist the approved status.
 *
 * Bank semantics:
 *   - Approved + justified  → counted as worked time; bank unchanged.
 *   - Approved + unjustified → counted as worked time AND added to bank
 *     as "uncredited hours owed back to the company" (computed in storage).
 */

export function registerCorrectionRoutes(router, {
  correctionsStore,
  punchesStore,
  usersStore,
  employeesStore,
  requireAuth,
  requireRole,
}) {

  function fullNameMap() {
    if (!employeesStore) return new Map();
    try {
      return new Map(employeesStore.list().map((e) => [e.id, e.fullName ?? null]));
    } catch {
      return new Map();
    }
  }
  function usersByIdMap() {
    const map = new Map();
    for (const u of usersStore.list()) map.set(u.id, u);
    return map;
  }

  /** Add username + fullName for the UI. */
  function enrich(correction, users, names) {
    const user = users.get(correction.employeeId);
    return {
      ...correction,
      username: user?.username ?? null,
      fullName: names.get(correction.employeeId) ?? null,
    };
  }

  // --------------------------------------------------------------------------
  // Bank lookups (registered first to win route-matching against /:id)
  // --------------------------------------------------------------------------

  router.get('/api/corrections/bank', requireAuth((req, res) => {
    const hours = correctionsStore.computeBank({ userId: req.user.id });
    res.json({ userId: req.user.id, hours });
  }));

  router.get('/api/corrections/bank/:userId', requireRole('employer')((req, res) => {
    const hours = correctionsStore.computeBank({ userId: req.params.userId });
    res.json({ userId: req.params.userId, hours });
  }));

  // --------------------------------------------------------------------------
  // List + read
  // --------------------------------------------------------------------------

  router.get('/api/corrections', requireAuth((req, res) => {
    const filter = req.user.role === 'employer' ? {} : { employeeId: req.user.id };
    if (req.query.status) filter.status = req.query.status;
    const users = usersByIdMap();
    const names = fullNameMap();
    const corrections = correctionsStore.list(filter).map((c) => enrich(c, users, names));
    res.json({ corrections });
  }));

  router.get('/api/corrections/:id', requireAuth((req, res) => {
    const c = correctionsStore.findById(req.params.id);
    if (!c) return res.notFound('Correction not found');
    if (req.user.role !== 'employer' && c.employeeId !== req.user.id) {
      return res.forbidden('Not yours');
    }
    res.json({ correction: enrich(c, usersByIdMap(), fullNameMap()) });
  }));

  // --------------------------------------------------------------------------
  // Create (employee files a correction)
  // --------------------------------------------------------------------------

  router.post('/api/corrections', requireAuth((req, res) => {
    const { kind, start, end, justification } = req.body ?? {};
    try {
      const correction = correctionsStore.create({
        employeeId: req.user.id, kind, start, end, justification,
      });
      res.json({ ok: true, correction: enrich(correction, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  // Approve — materializes the correction as punch records
  // --------------------------------------------------------------------------

  router.post('/api/corrections/:id/approve', requireRole('employer')((req, res) => {
    const existing = correctionsStore.findById(req.params.id);
    if (!existing) return res.notFound('Correction not found');
    if (existing.status !== 'pending') {
      return res.badRequest(`Cannot approve a correction in status '${existing.status}'`);
    }

    // Materialize the punches BEFORE recording the approval, so a
    // crash mid-way leaves the correction pending (we can retry) rather
    // than approved-but-no-punches (we'd need manual cleanup).
    //
    // Each materialized punch carries a deterministic clientId derived
    // from the correction id, which makes the operation idempotent: a
    // retry caused by network flakiness won't create duplicates because
    // punchesStore.findByClientId() will catch them.
    //
    // Per kind:
    //   - 'both' → create both in (at start) and out (at end)
    //   - 'in'   → create just an in-punch at start
    //   - 'out'  → create just an out-punch at end
    const baseId = `correction:${existing.id}`;
    const commentForIn = existing.isJustified
      ? `Manual entry: ${existing.justification}`.slice(0, 500)
      : 'Manual entry (no justification)';
    const commentForOut = existing.isJustified
      ? `Manual entry: ${existing.justification}`.slice(0, 500)
      : 'Manual entry (no justification)';

    if (existing.kind === 'both' || existing.kind === 'in') {
      const inMeta = punchesStore.findByClientId(existing.employeeId, `${baseId}:in`);
      if (!inMeta) {
        punchesStore.append(existing.employeeId, {
          type: 'in',
          ts: existing.start,
          comment: commentForIn,
          clientId: `${baseId}:in`,
        });
      }
    }
    if (existing.kind === 'both' || existing.kind === 'out') {
      const outMeta = punchesStore.findByClientId(existing.employeeId, `${baseId}:out`);
      if (!outMeta) {
        punchesStore.append(existing.employeeId, {
          type: 'out',
          ts: existing.end,
          // Only put the comment on the OUT punch when this is an out-only
          // correction; for 'both' the comment already lives on the in punch.
          comment: existing.kind === 'out' ? commentForOut : null,
          clientId: `${baseId}:out`,
        });
      }
    }

    try {
      const correction = correctionsStore.approve(req.params.id, req.user.id);
      res.json({ ok: true, correction: enrich(correction, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  // --------------------------------------------------------------------------
  // Reject + cancel
  // --------------------------------------------------------------------------

  router.post('/api/corrections/:id/reject', requireRole('employer')((req, res) => {
    const existing = correctionsStore.findById(req.params.id);
    if (!existing) return res.notFound('Correction not found');
    try {
      const correction = correctionsStore.reject(req.params.id, req.user.id, req.body?.notes);
      res.json({ ok: true, correction: enrich(correction, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));

  router.post('/api/corrections/:id/cancel', requireAuth((req, res) => {
    const existing = correctionsStore.findById(req.params.id);
    if (!existing) return res.notFound('Correction not found');
    // Owner may cancel only while pending. Employer may cancel any state.
    if (req.user.role !== 'employer') {
      if (existing.employeeId !== req.user.id) return res.forbidden('Not yours');
      if (existing.status !== 'pending') {
        return res.badRequest('Only pending corrections can be cancelled by the owner');
      }
    }
    try {
      const correction = correctionsStore.cancel(req.params.id, req.user.id);
      res.json({ ok: true, correction: enrich(correction, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message);
    }
  }));
}
