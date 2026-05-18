import { LEAVE_TYPES_LIST, LEAVE_UNITS_LIST, findConcurrentApprovedLeave } from '../storage/leaves.js';
import { findBlockingRange } from '../storage/org-settings.js';
import { auditContext } from '../storage/audit.js';

// Justification attachment policy. One file per leave, ≤5 MB, only the
// document types a justification realistically needs. Served as a
// download (never inline) so even a hostile file can't execute in the
// viewer's browser.
export const LEAVE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_EXTS  = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'];
const ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Validate an uploaded multipart file part against the attachment
 * policy. Pure. Returns { ok:true, name, mime, size, data } or
 * { ok:false, errorCode, message }.
 */
export function validateAttachment(file) {
  if (!file || !Buffer.isBuffer(file.data)) {
    return { ok: false, errorCode: 'invalid_value', message: 'No file data' };
  }
  if (file.data.length > LEAVE_ATTACHMENT_MAX_BYTES) {
    return { ok: false, errorCode: 'attachment_too_large',
             message: `Attachment exceeds ${LEAVE_ATTACHMENT_MAX_BYTES} bytes` };
  }
  const name = String(file.filename || 'attachment');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const mime = String(file.contentType || 'application/octet-stream').toLowerCase();
  const extOk = ATTACHMENT_EXTS.includes(ext);
  // Trust the extension as the gate; accept the matching mime or a
  // generic octet-stream (some browsers/proxies send that). A correct
  // mime that disagrees with a disallowed extension is still rejected.
  const mimeOk = ATTACHMENT_MIMES.includes(mime) || mime === 'application/octet-stream';
  if (!extOk || !mimeOk) {
    return { ok: false, errorCode: 'attachment_bad_type',
             message: 'Attachment must be a PDF or an image (JPG, PNG, GIF, WEBP)' };
  }
  return { ok: true, name, mime, size: file.data.length, data: file.data };
}

/**
 * Pull the leave fields + optional file part from a request body that
 * may be JSON (existing API/tests) or multipart/form-data (the new
 * form when a file is attached). Multipart shape:
 *   { fields:{...}, files:[{ field, filename, contentType, data }] }
 */
function readLeaveInput(body) {
  if (body && typeof body === 'object' && body.fields && Array.isArray(body.files)) {
    const file = body.files.find((f) => f.field === 'file') || body.files[0] || null;
    return { src: body.fields, file };
  }
  return { src: body ?? {}, file: null };
}

/**
 * Leaves endpoints.
 *
 * Route map:
 *   GET  /api/leaves                              — list (self / all depending on role)
 *   GET  /api/leaves/:id                          — one leave (owner or employer)
 *   GET  /api/leaves/:id/attachment               — download (owner or employer)
 *   PUT  /api/leaves/:id/attachment               — add/replace (owner or employer, pending)
 *   DELETE /api/leaves/:id/attachment             — remove (owner or employer, pending)
 *   POST /api/leaves                              — create (self); optional file part
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
  auditStore = null,
  mailer = null,
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
  // Privacy model (tightened in 0.22.4):
  //   - Employer: full data for every approved leave (name, type, dates).
  //   - Employee: full data for their OWN approved leaves; for everyone
  //     else's leaves, only id + start + end + unit + a flag
  //     `anonymized: true`. Identity (employeeId/username/fullName), the
  //     leave `type`, and `reason`/`notes` are stripped.
  //
  // The anonymized payload preserves enough for the calendar to render
  // "someone is unavailable on this day" capacity blocks without revealing
  // who or why. `reason`/`notes` are null for everyone — pending and
  // rejected leaves never appear at all.
  // --------------------------------------------------------------------------
  router.get('/api/leaves/approved', requireAuth((req, res) => {
    const users = usersByIdMap();
    const names = fullNameMap();
    const isEmployer = req.user.role === 'employer';
    const leaves = leavesStore.list()
      .filter((l) => l.status === 'approved')
      .map((l) => {
        if (isEmployer || l.employeeId === req.user.id) {
          const full = enrich(l, users, names);
          full.reason = null;
          full.notes = null;
          return full;
        }
        // Other employees' leaves: minimum needed to render a generic
        // capacity block on the calendar. No identity, no type.
        return {
          id: l.id,
          start: l.start,
          end: l.end,
          unit: l.unit,
          anonymized: true,
        };
      });
    // Blocked ranges are company policy, not personal data — every
    // authenticated user gets the full list so the calendar can mark
    // them. (Only the employer can WRITE them, via PUT /api/settings/org.)
    const blockedRanges = orgSettingsStore.get().leaves.blockedRanges ?? [];
    res.json({ leaves, blockedRanges });
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
      return res.forbidden('Not your balance', { errorCode: 'forbidden' });
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
    if (!leave) return res.notFound('Leave not found', { errorCode: 'not_found' });
    if (req.user.role !== 'employer' && leave.employeeId !== req.user.id) {
      return res.forbidden('Not your leave', { errorCode: 'forbidden' });
    }
    res.json({ leave: enrich(leave, usersByIdMap(), fullNameMap()) });
  }));

  // --------------------------------------------------------------------------
  // Attachment endpoints. Visibility rule (per the feature request):
  // ONLY the leave's owner or an employer — never another employee.
  // This is the same authz GET /api/leaves/:id already uses.
  // --------------------------------------------------------------------------
  function loadOwnLeaveOrEmployer(req, res) {
    const leave = leavesStore.findById(req.params.id);
    if (!leave) { res.notFound('Leave not found', { errorCode: 'not_found' }); return null; }
    if (req.user.role !== 'employer' && leave.employeeId !== req.user.id) {
      res.forbidden('Not your leave', { errorCode: 'forbidden' });
      return null;
    }
    return leave;
  }

  // GET — download the decrypted file. Always Content-Disposition:
  // attachment so even a hostile upload cannot execute in the browser.
  router.get('/api/leaves/:id/attachment', requireAuth((req, res) => {
    const leave = loadOwnLeaveOrEmployer(req, res);
    if (!leave) return;
    if (!leave.attachment) return res.notFound('No attachment', { errorCode: 'not_found' });
    let att;
    try {
      att = leavesStore.readAttachment(req.params.id);
    } catch {
      return res.notFound('No attachment', { errorCode: 'not_found' });
    }
    if (!att) return res.notFound('No attachment', { errorCode: 'not_found' });
    // Strip anything path-like / quote-breaking from the download name.
    const safeName = String(att.name).replace(/[\r\n"\\/]+/g, '_').slice(0, 200);
    res.writeHead(200, {
      'Content-Type': att.mime || 'application/octet-stream',
      'Content-Length': att.data.length,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.end(att.data);
  }));

  // PUT — add or replace (owner or employer, only while pending). The
  // store enforces pending; we surface a clean errorCode.
  router.put('/api/leaves/:id/attachment', requireAuth((req, res) => {
    const leave = loadOwnLeaveOrEmployer(req, res);
    if (!leave) return;
    const body = req.body;
    const file = body && Array.isArray(body.files)
      ? (body.files.find((f) => f.field === 'file') || body.files[0])
      : null;
    if (!file) return res.badRequest('No file uploaded', { errorCode: 'required' });
    const v = validateAttachment(file);
    if (!v.ok) return res.badRequest(v.message, { errorCode: v.errorCode });
    try {
      const updated = leavesStore.setAttachment(req.params.id, {
        name: v.name, mime: v.mime, size: v.size, data: v.data,
      });
      res.json({ ok: true, leave: enrich(updated, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // DELETE — remove (owner or employer, only while pending).
  router.delete('/api/leaves/:id/attachment', requireAuth((req, res) => {
    const leave = loadOwnLeaveOrEmployer(req, res);
    if (!leave) return;
    try {
      const updated = leavesStore.removeAttachment(req.params.id);
      res.json({ ok: true, leave: enrich(updated, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves', requireAuth((req, res) => {
    const { src, file } = readLeaveInput(req.body);
    const { type, unit, start, end, hours, reason } = src;

    // Validate the optional file BEFORE creating the leave, so a bad
    // upload never leaves a leave behind with no attachment.
    let attachment = null;
    if (file) {
      const v = validateAttachment(file);
      if (!v.ok) return res.badRequest(v.message, { errorCode: v.errorCode });
      attachment = v;
    }

    if (!LEAVE_TYPES_LIST.includes(type)) {
      return res.badRequest(`type must be one of: ${LEAVE_TYPES_LIST.join(', ')}`, { errorCode: 'invalid_value' });
    }
    if (!LEAVE_UNITS_LIST.includes(unit)) {
      return res.badRequest(`unit must be one of: ${LEAVE_UNITS_LIST.join(', ')}`, { errorCode: 'invalid_value' });
    }

    // Blocked-day enforcement. The employer is never blocked (they set the
    // policy and may need to book on a company day themselves). Sick leave
    // is exempt because it is non-discretionary — you cannot choose not to
    // be ill on an all-hands day. Every other type is refused if it touches
    // an employer-blocked range.
    if (req.user.role !== 'employer' && type !== 'sick') {
      const blocked = findBlockingRange(
        { unit, start, end },
        orgSettingsStore.get().leaves.blockedRanges,
      );
      if (blocked) {
        const span = blocked.start === blocked.end
          ? blocked.start
          : `${blocked.start} → ${blocked.end}`;
        const named = blocked.label ? `${blocked.label} (${span})` : span;
        return res.badRequest(
          `Leave cannot be booked: ${named} is blocked by your employer.`,
          { errorCode: 'leave_day_blocked' },
        );
      }
    }

    // Concurrent-leave enforcement. When the org has "allow multiple
    // employees on leave at the same time" turned OFF, an employee may
    // not book a leave that shares a calendar day with another
    // employee's APPROVED leave. Exemptions mirror the blocked-days
    // policy: the employer is never blocked (they have the final call —
    // same principle as the approval-time advisory), and sick leave is
    // non-discretionary so it is never refused for coverage reasons.
    // start must be a string here; if it isn't, skip and let
    // store.create() produce the proper validation error.
    if (req.user.role !== 'employer'
        && type !== 'sick'
        && typeof start === 'string'
        && orgSettingsStore.get().leaves.concurrentAllowed === false) {
      const clash = findConcurrentApprovedLeave(
        { start, end: end ?? start },
        req.user.id,
        leavesStore.list(),
      );
      if (clash) {
        return res.badRequest(
          'Cannot book leave: another employee already has approved leave on ' +
          'one or more of these days, and concurrent leave is disabled.',
          { errorCode: 'leave_overlaps' },
        );
      }
    }

    // Cap enforcement: refuse to create if approving this request would push
    // booked days over the configured allowance for this type. allowance===0
    // means "no cap" (existing semantic from org-settings).
    try {
      const additional = daysOf({ unit, start, end, hours });
      const year = (start ?? new Date().toISOString()).slice(0, 4);
      const check = leavesStore.wouldExceedCap({
        userId: req.user.id,
        type,
        additionalDays: additional,
        year: Number(year),
        orgSettings: orgSettingsStore.get(),
        daysOf,
      });
      if (check.exceeds) {
        return res.badRequest(
          `Cannot book leave: allowance for ${type} is ${check.allowance} days; ` +
          `you currently have ${check.currentBooked} booked, this request adds ${additional} ` +
          `(would total ${check.wouldBe}).`,
          { errorCode: 'leave_cap_exceeded' }
        );
      }
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }

    try {
      let leave = leavesStore.create({
        employeeId: req.user.id,
        type, unit, start, end, hours, reason,
      });
      if (attachment) {
        leave = leavesStore.setAttachment(leave.id, {
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          data: attachment.data,
        });
      }
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  // GET /api/leaves/:id/overlaps — for the concurrent-leaves warning. Returns
  // approved leaves of OTHER users that overlap with this leave's date range.
  // The frontend calls this before showing the approve confirmation; if
  // overlaps exist AND orgSettings.leaves.concurrentAllowed is false, show a
  // warning. The setting governs whether the warning fires, not whether
  // approval is allowed — employer always has the final call.
  router.get('/api/leaves/:id/overlaps', requireRole('employer')((req, res) => {
    const target = leavesStore.findById(req.params.id);
    if (!target) return res.notFound('Leave not found', { errorCode: 'not_found' });

    // Date-range overlap: [aStart, aEnd] overlaps [bStart, bEnd] iff
    // aStart ≤ bEnd AND bStart ≤ aEnd.
    const ts = target.start;
    const te = target.end ?? target.start;

    const others = leavesStore.list()
      .filter((l) => l.status === 'approved')
      .filter((l) => l.id !== target.id)
      .filter((l) => l.employeeId !== target.employeeId)
      .filter((l) => {
        const ls = l.start;
        const le = l.end ?? l.start;
        return ls <= te && ts <= le;
      });

    const users = usersByIdMap();
    const names = fullNameMap();
    const enriched = others.map((l) => enrich(l, users, names));
    res.json({
      overlaps: enriched,
      concurrentAllowed: orgSettingsStore.get().leaves.concurrentAllowed,
    });
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves/:id/approve', requireRole('employer')(async (req, res) => {
    const existing = leavesStore.findById(req.params.id);
    if (!existing) return res.notFound('Leave not found', { errorCode: 'not_found' });

    // Cap enforcement at approval time. The pending request might have been
    // created when the cap had room, then someone else's request got approved
    // first — now this one would push booked over.
    try {
      const additional = daysOf({
        unit: existing.unit,
        start: existing.start,
        end: existing.end,
        hours: existing.hours,
      });
      const year = Number(existing.start.slice(0, 4));
      const check = leavesStore.wouldExceedCap({
        userId: existing.employeeId,
        type: existing.type,
        additionalDays: additional,
        year,
        orgSettings: orgSettingsStore.get(),
        daysOf,
      });
      if (check.exceeds) {
        return res.badRequest(
          `Cannot approve: allowance for ${existing.type} is ${check.allowance} days; ` +
          `employee currently has ${check.currentBooked} booked, this leave adds ${additional} ` +
          `(would total ${check.wouldBe}).`,
          { errorCode: 'leave_cap_exceeded' }
        );
      }
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }

    try {
      const leave = leavesStore.approve(req.params.id, req.user.id);
      auditStore?.appendRecord({
        ...auditContext(req),
        event: 'leave.decision',
        target: { leaveId: leave.id, employeeId: leave.employeeId },
        details: { decision: 'approved', type: leave.type, start: leave.start, end: leave.end },
      });
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
      // Fire-and-forget — response is already sent; notify never rejects.
      if (mailer) void mailer.notify('leaveDecision', {
        recipientUserId: leave.employeeId,
        vars: { status: 'approved', type: leave.type, start: leave.start, end: leave.end, unit: leave.unit },
      });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves/:id/reject', requireRole('employer')(async (req, res) => {
    const existing = leavesStore.findById(req.params.id);
    if (!existing) return res.notFound('Leave not found', { errorCode: 'not_found' });
    const notes = req.body?.notes;
    try {
      const leave = leavesStore.reject(req.params.id, req.user.id, notes);
      auditStore?.appendRecord({
        ...auditContext(req),
        event: 'leave.decision',
        target: { leaveId: leave.id, employeeId: leave.employeeId },
        details: { decision: 'rejected', type: leave.type, hasNotes: !!notes },
      });
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
      // Fire-and-forget — response is already sent; notify never rejects.
      if (mailer) void mailer.notify('leaveDecision', {
        recipientUserId: leave.employeeId,
        vars: { status: 'rejected', type: leave.type, start: leave.start, end: leave.end, unit: leave.unit },
      });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));

  // --------------------------------------------------------------------------
  router.post('/api/leaves/:id/cancel', requireAuth((req, res) => {
    const existing = leavesStore.findById(req.params.id);
    if (!existing) return res.notFound('Leave not found', { errorCode: 'not_found' });

    // Owner can cancel only while still pending.
    // Employer can cancel pending OR approved (not rejected/cancelled — transition() enforces).
    const isOwner = existing.employeeId === req.user.id;
    const isEmployer = req.user.role === 'employer';
    if (!isOwner && !isEmployer) return res.forbidden('Not your leave', { errorCode: 'forbidden' });
    if (isOwner && !isEmployer && existing.status !== 'pending') {
      return res.forbidden('You can only cancel leaves that are still pending', { errorCode: 'forbidden' });
    }

    try {
      const leave = leavesStore.cancel(req.params.id, req.user.id);
      // Only audit when an employer cancels someone else's leave —
      // self-cancellation of one's own pending leave is a routine
      // user action, not an access-level event.
      if (isEmployer && existing.employeeId !== req.user.id) {
        auditStore?.appendRecord({
          ...auditContext(req),
          event: 'leave.decision',
          target: { leaveId: leave.id, employeeId: leave.employeeId },
          details: { decision: 'cancelled_by_employer', type: leave.type, priorStatus: existing.status },
        });
      }
      res.json({ ok: true, leave: enrich(leave, usersByIdMap(), fullNameMap()) });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
  }));
}
