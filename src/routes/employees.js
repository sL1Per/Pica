import { EMPLOYEE_EDITABLE, ALL_EDITABLE } from '../storage/employees.js';
import { hoursReport } from '../storage/reports.js';
import { computePeriod, ymdOf } from '../storage/period.js';

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
  requireAuth,
  requireRole,
  requireOwnerOrEmployer,
}) {
  const MAX_PICTURE_BYTES = 2 * 1024 * 1024; // 2 MB — client should resize first

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
      return res.json({ error: `Failed to create profile: ${err.message}`, errorCode: 'profile_create_failed' }, 500);
    }

    const profile = employeesStore.readProfile(user.id);
    res.json({ ok: true, employee: { ...user, profile } });
  }));

  // --------------------------------------------------------------------------
  // GET /api/employees/:id — read one profile (owner or employer)
  // --------------------------------------------------------------------------
  router.get('/api/employees/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
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
  //   - weekHours: hours worked in the current ISO week (Mon-Sun containing today)
  //   - weekScheduled: scheduled hours for the same window (from working-time settings)
  //   - bankHours: current time-bank balance
  //   - upcomingLeaves[]: approved leaves whose date range either starts in
  //     the next 30 days or is currently in progress
  //   - pending: { leaves: [...], corrections: [...] } — items still
  //     awaiting employer decision
  //
  // Employer-only — the summary is the employer's lens on someone else's
  // activity. Employees viewing themselves should look at the dashboard
  // (which shows the same numbers from their own POV).
  // --------------------------------------------------------------------------
  router.get('/api/employees/:id/summary', requireRole('employer')((req, res) => {
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    // Profile with hasPicture decoration, mirroring GET /api/employees/:id.
    const profile = employeesStore.readProfile(user.id);
    const hasPicture = employeesStore.hasPicture(user.id);
    const profileWithPic = profile
      ? { ...profile, hasPicture }
      : (hasPicture ? { hasPicture } : null);

    // ISO week boundaries (Monday → Sunday) containing today.
    const now = new Date();
    const week = computePeriod('week', now);
    const weekFrom = week.from;
    const weekTo   = week.to;

    // Worked hours this week. Defensive try/catch so a bad punches file
    // doesn't 500 the whole summary.
    let weekHours = 0;
    try {
      weekHours = hoursReport(punchesStore, user.id, weekFrom, weekTo, 'day').totalHours;
    } catch {
      weekHours = 0;
    }

    // Scheduled hours for this user (with per-employee override).
    const wt = orgSettingsStore?.resolveWorkingTimeFor
      ? orgSettingsStore.resolveWorkingTimeFor(user.id)
      : { dailyHours: 8, weeklyHours: 40 };
    const weekScheduled = wt.weeklyHours;

    // Bank balance.
    let bankHours = 0;
    try {
      bankHours = correctionsStore.computeBank({ userId: user.id });
    } catch {
      bankHours = 0;
    }

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
      week: { from: weekFrom, to: weekTo, hours: weekHours, scheduled: weekScheduled },
      bankHours,
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
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    const allowed = req.user.role === 'employer' ? ALL_EDITABLE : EMPLOYEE_EDITABLE;
    const profile = employeesStore.update(user.id, req.body ?? {}, allowed);
    res.json({ ok: true, profile });
  }));

  // --------------------------------------------------------------------------
  // DELETE /api/employees/:id — remove employee (employer only).
  //
  // Forbidden to delete self — avoids locking the employer out of their
  // own app. TODO(M11): prevent deleting the last employer account.
  // --------------------------------------------------------------------------
  router.delete('/api/employees/:id', requireRole('employer')(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.badRequest('You cannot delete your own account', { errorCode: 'cannot_delete_self' });
    }
    const user = usersStore.findById(req.params.id);
    if (!user) return res.notFound('Employee not found', { errorCode: 'not_found' });

    employeesStore.remove(user.id);
    usersStore.deleteById(user.id);

    res.json({ ok: true });
  }));

  // --------------------------------------------------------------------------
  // GET /api/employees/:id/picture — stream decrypted JPEG (owner or employer).
  // --------------------------------------------------------------------------
  router.get('/api/employees/:id/picture', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
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
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.badRequest('No picture uploaded', { errorCode: 'required' });
    }
    const file = files[0];
    if (file.data.length > MAX_PICTURE_BYTES) {
      return res.badRequest(`Picture exceeds ${MAX_PICTURE_BYTES} bytes`, { errorCode: 'invalid_value' });
    }
    if (!employeesStore.exists(req.params.id)) {
      // Create an empty profile first, so the picture has something to attach to.
      employeesStore.create(req.params.id, {});
    }
    employeesStore.writePicture(req.params.id, file.data);
    res.json({ ok: true });
  }));

  // --------------------------------------------------------------------------
  // DELETE /api/employees/:id/picture — remove picture (owner or employer).
  // --------------------------------------------------------------------------
  router.delete('/api/employees/:id/picture', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    employeesStore.deletePicture(req.params.id);
    res.json({ ok: true });
  }));

  // --------------------------------------------------------------------------
  // GET /api/me (enhanced) — overridden here so it includes profile.
  // Note: the plain /api/me from auth.js is still registered; this one
  // adds profile data for UI convenience.
  // --------------------------------------------------------------------------
  // Intentionally NOT re-registering /api/me here — keep single source of truth.
  // The client fetches /api/me, then /api/employees/<me.id> when needed.

  // Unused imports suppressed:
  void requireAuth;
}
