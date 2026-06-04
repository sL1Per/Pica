import { EMPLOYEE_EDITABLE, ALL_EDITABLE } from '../storage/employees.js';
import { hoursReport } from '../storage/reports.js';
import { computePeriod, ymdOf } from '../storage/period.js';
import { auditContext } from '../storage/audit.js';
import { isUuid, sniffImageType } from '../util/validators.js';

/**
 * Employee management endpoints.
 *
 * Authorization:
 *   list / create / delete    → employer only
 *   read / update / picture   → owner or employer
 *   summary                   → employer only
 *
 * Field filtering on update:
 *   Employees can only modify a whitelisted subset of their own fields.
 *   Employers can modify everything.
 */
export function registerEmployeeRoutes(router, {
  usersStore,
  employeesStore,
  punchesStore,
  leavesStore,
  correctionsStore,
  orgSettingsStore,
  passwordLimiter,
  requireRole,
  requireOwnerOrEmployer,
  auditStore = null,
  mailer = null,
}) {
  const MAX_PICTURE_BYTES = 2 * 1024 * 1024; // 2 MB — client should resize first

  /**
   * Reject early when `:id` in the URL isn't a UUID. The storage layer
   * also enforces this (defense in depth), but doing it at the route
   * gives us a clean 400 with errorCode rather than a 500 from a thrown
   * storage call.
   *
   * Returns true if the response was sent (caller should `return`); false
   * if the id is valid and the handler may proceed.
   */
  function rejectIfBadId(req, res) {
    if (!isUuid(req.params.id)) {
      res.badRequest('Invalid employee id', { errorCode: 'invalid_id' });
      return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // GET /api/employees — list all employees (employer only)
  //
  // Response merges each user's basic info (username, role) with profile
  // summary (fullName, position, hasPicture) so the list view can render
  // without a second request per row.
  // --------------------------------------------------------------------------
  router.get('/api/employees', requireRole('employer')(async (req, res) => {
    const users = usersStore.list();
    const profiles = new Map(employeesStore.list().map((p) => [p.id, p]));

    const rows = users.map((u) => {
      const p = profiles.get(u.id);
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        active: u.active !== false,
        hasProfile: !!p,
        fullName: p?.fullName ?? null,
        position: p?.position ?? null,
        hasPicture: p?.hasPicture ?? false,
        createdAt: u.createdAt,
      };
    });

    res.json({ employees: rows });
  }));

  // --------------------------------------------------------------------------
  // POST /api/employees — create a user + initial profile (employer only)
  //
  // Transactional: if profile creation fails for any reason, the user is
  // rolled back so we don't leave an orphan account.
  // --------------------------------------------------------------------------
  router.post('/api/employees', requireRole('employer')(async (req, res) => {
    const { username, password, role = 'employee', ...profileFields } = req.body ?? {};

    if (role !== 'employee' && role !== 'employer') {
      return res.badRequest('role must be "employee" or "employer"', { errorCode: 'invalid_value' });
    }

    let user;
    try {
      user = await usersStore.create({ username, password, role });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }

    try {
      employeesStore.create(user.id, profileFields);
    } catch (err) {
      // Rollback the user so we don't leave an orphan account.
      usersStore.deleteById(user.id);
      // Missing-required-field is a user-correctable input bug; surface
      // it as 400 with the offending field so the UI can highlight.
      if (err.code === 'missing_required_field') {
        return res.badRequest(err.message, { errorCode: 'missing_required_field' });
      }
      return res.json({ error: `Failed to create profile: ${err.message}`, errorCode: 'profile_create_failed' }, 500);
    }

    const profile = employeesStore.readProfile(user.id);
    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'employee.created',
      target: { userId: user.id, username: user.username },
      details: { role: user.role },
    });
    res.json({ ok: true, employee: { ...user, profile } });
  }));

  // --------------------------------------------------------------------------
  // GET /api/employees/:id — read one profile (owner or employer)
  // --------------------------------------------------------------------------
  router.get('/api/employees/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    if (rejectIfBadId(req, res)) return;
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });
    const profile = employeesStore.readProfile(user.id);
    const hasPicture = employeesStore.hasPicture(user.id);
    // Surface hasPicture as part of the profile so the UI can render the
    // avatar without a second request. Null profile still reports picture
    // state — an uploaded picture lives on disk even without a profile file.
    const profileWithPic = profile
      ? { ...profile, hasPicture }
      : (hasPicture ? { hasPicture } : null);
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active !== false,
      createdAt: user.createdAt,
      profile: profileWithPic,
    });
  }));

  // --------------------------------------------------------------------------
  // GET /api/employees/:id/summary — employer dashboard for one employee.
  //
  // Aggregates everything the employer-facing summary page needs in a
  // single response:
  //   - profile (same shape as GET /api/employees/:id)
  //   - week: { from, to, hours, scheduled, missing } for the current ISO
  //     week (Mon-Sun containing today). `missing` is max(0, scheduled-hours).
  //   - month: { from, to, hours, scheduled, missing } for the current
  //     calendar month, same shape.
  //   - upcomingLeaves[]: approved leaves whose date range either starts in
  //     the next 30 days or is currently in progress
  //   - pending: { leaves: [...], corrections: [...] } — items still
  //     awaiting employer decision
  //
  // `missing` is a raw scheduled-vs-worked delta. It does NOT subtract
  // approved leave hours from the scheduled target — operators should
  // cross-check the upcomingLeaves block when interpreting it.
  //
  // The earlier `bankHours` field was removed in 0.22.8 along with the
  // time-bank feature; `missing` replaces it as the "is this person
  // behind on hours" signal.
  //
  // Employer-only — the summary is the employer's lens on someone else's
  // activity. Employees viewing themselves should look at the dashboard
  // (which shows the same numbers from their own POV).
  // --------------------------------------------------------------------------
  router.get('/api/employees/:id/summary', requireRole('employer')((req, res) => {
    if (rejectIfBadId(req, res)) return;
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    // Profile with hasPicture decoration, mirroring GET /api/employees/:id.
    const profile = employeesStore.readProfile(user.id);
    const hasPicture = employeesStore.hasPicture(user.id);
    const profileWithPic = profile
      ? { ...profile, hasPicture }
      : (hasPicture ? { hasPicture } : null);

    // ISO week + calendar month windows.
    const now = new Date();
    const weekP  = computePeriod('week',  now);
    const monthP = computePeriod('month', now);

    // Worked hours per period. Defensive try/catch so a bad punches file
    // doesn't 500 the whole summary.
    function workedIn(from, to) {
      try {
        return hoursReport(punchesStore, user.id, from, to, 'day').totalHours;
      } catch {
        return 0;
      }
    }
    const weekHours  = workedIn(weekP.from,  weekP.to);
    const monthHours = workedIn(monthP.from, monthP.to);

    // Scheduled hours for this user (with per-employee override). For the
    // month view, scheduled = dailyHours × weekdays in the month (matching
    // the team-hours convention).
    const wt = orgSettingsStore?.resolveWorkingTimeFor
      ? orgSettingsStore.resolveWorkingTimeFor(user.id)
      : { dailyHours: 8, weeklyHours: 40 };
    const round1 = (n) => Math.round(n * 10) / 10;
    const weekScheduled  = wt.weeklyHours;
    const monthScheduled = round1(wt.dailyHours * (monthP.weekdays ?? 0));

    // Missing hours = positive shortfall vs scheduled. NOT adjusted for
    // approved leaves — operators should cross-check upcomingLeaves.
    const weekMissing  = round1(Math.max(0, weekScheduled  - weekHours));
    const monthMissing = round1(Math.max(0, monthScheduled - monthHours));

    // Upcoming leaves: approved, this user only, whose [start, end] window
    // intersects [today, today+30d]. Includes leaves currently in progress.
    const todayYmd = ymdOf(now);
    const horizon = new Date(now);
    horizon.setDate(now.getDate() + 30);
    const horizonYmd = ymdOf(horizon);

    const allLeaves = leavesStore.list({ employeeId: user.id });
    const upcomingLeaves = allLeaves
      .filter((l) => l.status === 'approved')
      .filter((l) => {
        const s = String(l.start).slice(0, 10);
        const e = String(l.end).slice(0, 10);
        // window-intersect test: range [s,e] overlaps [today, horizon]
        return s <= horizonYmd && e >= todayYmd;
      })
      .map((l) => ({
        id: l.id,
        type: l.type,
        unit: l.unit,
        start: l.start,
        end: l.end,
      }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    // Pending items, this user only.
    const pendingLeaves = allLeaves
      .filter((l) => l.status === 'pending')
      .map((l) => ({
        id: l.id,
        type: l.type,
        unit: l.unit,
        start: l.start,
        end: l.end,
      }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    const allCorrections = correctionsStore.list({ employeeId: user.id });
    const pendingCorrections = allCorrections
      .filter((c) => c.status === 'pending')
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        start: c.start,
        end: c.end,
        hours: c.hours,
      }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      profile: profileWithPic,
      week:  { from: weekP.from,  to: weekP.to,  hours: weekHours,  scheduled: weekScheduled,  missing: weekMissing },
      month: { from: monthP.from, to: monthP.to, hours: monthHours, scheduled: monthScheduled, missing: monthMissing },
      upcomingLeaves,
      pending: {
        leaves: pendingLeaves,
        corrections: pendingCorrections,
      },
    });
  }));

  // --------------------------------------------------------------------------
  // PUT /api/employees/:id — update profile (owner or employer).
  //
  // Employees get EMPLOYEE_EDITABLE; employers get ALL_EDITABLE.
  // --------------------------------------------------------------------------
  router.put('/api/employees/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    if (rejectIfBadId(req, res)) return;
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    const allowed = req.user.role === 'employer' ? ALL_EDITABLE : EMPLOYEE_EDITABLE;
    let profile;
    try {
      profile = employeesStore.update(user.id, req.body ?? {}, allowed);
    } catch (err) {
      if (err.code === 'missing_required_field') {
        return res.badRequest(err.message, { errorCode: 'missing_required_field' });
      }
      throw err;
    }
    res.json({ ok: true, profile });
  }));

  // --------------------------------------------------------------------------
  // DELETE /api/employees/:id — permanent erase (employer only).
  //
  // Gated behind deactivation: refuses unless the account is already
  // deactivated. This makes permanent loss a deliberate two-step
  // (deactivate → erase), never a one-click on an active employee.
  // Forbidden to delete self — avoids locking the employer out. This also
  // structurally protects the LAST employer: deleting any account requires
  // it be deactivated first and not be yourself, so the sole remaining
  // employer (always == the caller) can never be deleted.
  // --------------------------------------------------------------------------
  router.delete('/api/employees/:id', requireRole('employer')(async (req, res) => {
    if (rejectIfBadId(req, res)) return;
    if (req.params.id === req.user.id) {
      return res.badRequest('You cannot delete your own account', { errorCode: 'cannot_delete_self' });
    }
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });
    if (user.active !== false) {
      return res.badRequest('Deactivate the account before deleting it', { errorCode: 'not_deactivated' });
    }

    employeesStore.remove(user.id);
    usersStore.deleteById(user.id);

    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'employee.deleted',
      target: { userId: user.id, username: user.username },
      details: { role: user.role },
    });

    res.json({ ok: true });
  }));

  // POST /api/employees/:id/deactivate — block login + revoke sessions (employer).
  // --------------------------------------------------------------------------
  router.post('/api/employees/:id/deactivate', requireRole('employer')(async (req, res) => {
    if (rejectIfBadId(req, res)) return;
    if (req.params.id === req.user.id) {
      return res.badRequest('You cannot deactivate your own account', { errorCode: 'cannot_deactivate_self' });
    }
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    usersStore.setActive(user.id, false);
    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'employee.deactivated',
      target: { userId: user.id, username: user.username },
      details: { role: user.role },
    });
    res.json({ ok: true });
  }));

  // POST /api/employees/:id/reactivate — restore login (employer).
  // --------------------------------------------------------------------------
  router.post('/api/employees/:id/reactivate', requireRole('employer')(async (req, res) => {
    if (rejectIfBadId(req, res)) return;
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    usersStore.setActive(user.id, true);
    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'employee.reactivated',
      target: { userId: user.id, username: user.username },
      details: { role: user.role },
    });
    res.json({ ok: true });
  }));

  // --------------------------------------------------------------------------
  // GET /api/employees/:id/picture — stream decrypted JPEG (owner or employer).
  // --------------------------------------------------------------------------
  router.get('/api/employees/:id/picture', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    if (rejectIfBadId(req, res)) return;
    if (!employeesStore.hasPicture(req.params.id)) {
      return res.notFound('No picture', { errorCode: 'not_found' });
    }
    const bytes = employeesStore.readPicture(req.params.id);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': bytes.length,
      'Cache-Control': 'private, no-store', // don't let shared caches hold user photos
    });
    res.end(bytes);
  }));

  // --------------------------------------------------------------------------
  // PUT /api/employees/:id/picture — upload (owner or employer).
  //
  // Expects multipart/form-data with a single file part. The client is
  // responsible for resizing to a reasonable size before upload; server
  // rejects anything over 2 MB.
  // --------------------------------------------------------------------------
  router.put('/api/employees/:id/picture', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    if (rejectIfBadId(req, res)) return;
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.badRequest('No picture uploaded', { errorCode: 'required' });
    }
    const file = files[0];
    if (file.data.length > MAX_PICTURE_BYTES) {
      return res.badRequest(`Picture exceeds ${MAX_PICTURE_BYTES} bytes`, { errorCode: 'invalid_value' });
    }
    // Reject non-images by magic bytes (the picture is served with a pinned
    // image/jpeg Content-Type regardless; this is defense-in-depth + a clean
    // error rather than storing bytes that render as a broken image).
    if (!sniffImageType(file.data)) {
      return res.badRequest('Picture must be a PNG, JPEG, GIF, or WebP image', { errorCode: 'invalid_value' });
    }
    // A picture only makes sense once the profile exists: it's shown
    // next to profile data in the list/summary views, and an orphan
    // <id>.picture with no <id>.json never surfaces there. We used to
    // auto-create an empty profile here, but profile fields became
    // mandatory (0.22.6) so create({}) now throws missing_required_field
    // → an unhandled 500. Instead, ask the user to fill the profile
    // first, with a translated, actionable message.
    if (!employeesStore.exists(req.params.id)) {
      return res.badRequest(
        'Complete the required profile fields before uploading a picture.',
        { errorCode: 'profile_required' },
      );
    }
    // Defense-in-depth: never let a storage throw become a 500 here.
    try {
      employeesStore.writePicture(req.params.id, file.data);
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }
    res.json({ ok: true });
  }));

  // --------------------------------------------------------------------------
  // DELETE /api/employees/:id/picture — remove picture (owner or employer).
  // --------------------------------------------------------------------------
  router.delete('/api/employees/:id/picture', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    if (rejectIfBadId(req, res)) return;
    employeesStore.deletePicture(req.params.id);
    res.json({ ok: true });
  }));

  // --------------------------------------------------------------------------
  // POST /api/employees/:id/password-reset — employer-initiated password reset.
  //
  // The employer types a new temporary password (out-of-band UX: they
  // hand it to the employee via Slack/in-person/etc.). The user record's
  // mustChangePassword flag is set to true; on the employee's next login,
  // they're prompted to change it.
  //
  // Rate-limited per target user-id to slow brute-force scenarios where
  // an attacker has an employer session and is trying to reset many
  // accounts in sequence.
  //
  // Note: the employer cannot reset their own password through this
  // endpoint — that's an awkward edge case (you shouldn't ever need to).
  // Use the self-service /api/me/password instead.
  // --------------------------------------------------------------------------
  router.post('/api/employees/:id/password-reset', requireRole('employer')(async (req, res) => {
    if (rejectIfBadId(req, res)) return;
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.badRequest(
        'Cannot reset your own password — use self-service change instead.',
        { errorCode: 'cannot_reset_self' },
      );
    }

    if (passwordLimiter && !passwordLimiter.allow(`reset:${targetId}`)) {
      return res.json(
        { error: 'Too many password resets for this user. Try again later.', errorCode: 'rate_limited' },
        429,
      );
    }

    const user = usersStore.findById(targetId);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    const { newPassword } = req.body ?? {};
    if (typeof newPassword !== 'string') {
      return res.badRequest('newPassword is required', { errorCode: 'required' });
    }

    try {
      await usersStore.setPassword(targetId, newPassword, { mustChange: true });
    } catch (err) {
      const errorCode = err.code || 'invalid_value';
      return res.badRequest(err.message, { errorCode });
    }

    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'password.reset_by_employer',
      target: { userId: user.id, username: user.username },
      details: { mustChange: true },
    });

    res.json({ ok: true });
    // Fire-and-forget — response is already sent; notify never rejects.
    // passwordResetNotice bypasses org + user gating (it is a security notice).
    if (mailer) void mailer.notify('passwordResetNotice', {
      recipientUserId: targetId,
      vars: {},
    });
  }));
}
