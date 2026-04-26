/**
 * Punches — clock in / out and day listings.
 *
 * Route map:
 *   GET  /api/punches/status              — is the current user clocked in?
 *   POST /api/punches/clock-in            — clock in (self)
 *   POST /api/punches/clock-out           — clock out (self)
 *   GET  /api/punches/today               — today's punches (self or all for employer)
 *   GET  /api/punches/by-employee/:id     — a day or month of one employee's punches
 *                                             (owner or employer)
 *
 * Request body for clock-in / clock-out (all optional):
 *   { "comment": "...", "geo": { "lat": 38.7, "lng": -9.1, "accuracy": 20 } }
 */

export function registerPunchRoutes(router, {
  punchesStore,
  usersStore,
  requireAuth,
  requireOwnerOrEmployer,
}) {

  function todayYmd(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function validGeo(g) {
    if (g == null) return null;
    if (typeof g !== 'object') return null;
    const lat = Number(g.lat), lng = Number(g.lng);
    if (!Number.isFinite(lat) || lat < -90  || lat > 90)  return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    const acc = Number(g.accuracy);
    return {
      lat, lng,
      accuracy: Number.isFinite(acc) && acc > 0 ? acc : null,
    };
  }

  function validGeoSkipReason(r) {
    // Whitelist of allowed reasons. Free strings are dropped to keep the
    // field a clean enum for any future audit/reporting.
    const ok = new Set(['denied', 'timeout', 'unavailable', 'unsupported']);
    return typeof r === 'string' && ok.has(r) ? r : null;
  }

  function validComment(c) {
    if (c == null) return null;
    if (typeof c !== 'string') return null;
    const trimmed = c.trim();
    if (trimmed === '') return null;
    if (trimmed.length > 500) return trimmed.slice(0, 500);
    return trimmed;
  }

  // --------------------------------------------------------------------------
  router.get('/api/punches/status', requireAuth((req, res) => {
    const open = punchesStore.hasOpenPunch(req.user.id);
    const last = punchesStore.latest(req.user.id);
    res.json({
      open,
      lastPunch: last ? { ts: last.ts, type: last.type } : null,
    });
  }));

  // --------------------------------------------------------------------------
  router.post('/api/punches/clock-in', requireAuth((req, res) => {
    if (punchesStore.hasOpenPunch(req.user.id)) {
      return res.badRequest('You are already clocked in');
    }
    const ts = new Date().toISOString();
    const record = punchesStore.append(req.user.id, {
      type: 'in',
      ts,
      comment: validComment(req.body?.comment),
      geo: validGeo(req.body?.geo),
      geoSkipReason: validGeoSkipReason(req.body?.geoSkipReason),
    });
    res.json({ ok: true, punch: record });
  }));

  // --------------------------------------------------------------------------
  router.post('/api/punches/clock-out', requireAuth((req, res) => {
    if (!punchesStore.hasOpenPunch(req.user.id)) {
      return res.badRequest('You are not currently clocked in');
    }
    const ts = new Date().toISOString();
    const record = punchesStore.append(req.user.id, {
      type: 'out',
      ts,
      comment: validComment(req.body?.comment),
      geo: validGeo(req.body?.geo),
      geoSkipReason: validGeoSkipReason(req.body?.geoSkipReason),
    });
    res.json({ ok: true, punch: record });
  }));

  // --------------------------------------------------------------------------
  // Today's punches.
  //   Employees: only their own.
  //   Employers: all employees today, grouped by employee id.
  // --------------------------------------------------------------------------
  router.get('/api/punches/today', requireAuth((req, res) => {
    const ymd = todayYmd();
    if (req.user.role === 'employer') {
      const all = punchesStore.listDayAll(ymd);
      const usersById = new Map(usersStore.list().map((u) => [u.id, u]));
      const enriched = all.map((p) => ({
        ...p,
        username: usersById.get(p.employeeId)?.username ?? null,
      }));
      return res.json({ date: ymd, punches: enriched });
    }
    res.json({ date: ymd, punches: punchesStore.listDay(req.user.id, ymd) });
  }));

  // --------------------------------------------------------------------------
  // One employee's punches. Accepts either ?date=YYYY-MM-DD (one day) or
  // ?year=YYYY&month=MM (a whole month). Defaults to today.
  // --------------------------------------------------------------------------
  router.get('/api/punches/by-employee/:id', requireOwnerOrEmployer((req) => req.params.id)((req, res) => {
    const { date, year, month } = req.query;

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.badRequest('date must be YYYY-MM-DD');
      return res.json({
        date,
        punches: punchesStore.listDay(req.params.id, date),
      });
    }

    if (year || month) {
      const y = Number(year), m = Number(month);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) return res.badRequest('year must be a 4-digit year');
      if (!Number.isInteger(m) || m < 1 || m > 12)      return res.badRequest('month must be 1–12');
      return res.json({
        year: y, month: m,
        punches: punchesStore.listMonth(req.params.id, y, m),
      });
    }

    const ymd = todayYmd();
    res.json({ date: ymd, punches: punchesStore.listDay(req.params.id, ymd) });
  }));
}
