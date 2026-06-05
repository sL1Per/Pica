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

import { isUuid } from '../util/validators.js';
import { auditContext } from '../storage/audit.js';

export function registerPunchRoutes(router, {
  punchesStore,
  usersStore,
  auditStore,
  requireAuth,
  requireOwnerOrEmployer,
}) {

  // A punch whose honored client time diverges from the server receipt by more
  // than this is flagged as back/forward-dated (M17 S3). 120s absorbs normal
  // network latency + client clock skew, so live punches never trip it.
  const BACKDATE_THRESHOLD_MS = 120 * 1000;

  /**
   * Best-effort audit of a back/forward-dated punch. `ts` is the recorded punch
   * instant (possibly client-supplied), `recvTs` the server-receipt time. Emits
   * `punch.backdated` only when the two diverge beyond the threshold — so a live
   * punch (ts === recvTs) or a rejected/within-skew clientTs stays silent. Never
   * throws; carries no comment/geo (privacy — only the timing delta).
   */
  function auditBackdate(req, type, ts, recvTs) {
    const delta = Math.abs(new Date(recvTs).getTime() - new Date(ts).getTime());
    if (!(delta > BACKDATE_THRESHOLD_MS)) return;
    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'punch.backdated',
      target: { employeeId: req.user.id, type },
      details: { claimedTs: ts, recvTs, deltaSeconds: Math.round(delta / 1000) },
    });
  }

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

  function validClientId(id) {
    if (typeof id !== 'string') return null;
    if (id.length === 0 || id.length > 64) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    return id;
  }

  /**
   * If the client supplied a timestamp (offline-replay scenario), honor it
   * provided it parses cleanly AND falls within +/- 7 days of now. The
   * +/- bound limits how far a punch can be back/forward-dated, but the
   * timestamp is NOT cryptographically signed, so a user can still fabricate
   * times within that window. This is a known trade-off for offline support.
   * M17 S3 mitigation (0.54.3): the caller pairs every honored value with a
   * server-receipt `recvTs` and audits any divergence > 120s via auditBackdate,
   * so back-dating is recorded even though it is still possible. Signed client
   * punches (preventing the forgery) remain future hardening. Returns the ISO
   * string or null.
   */
  function validClientTs(ts) {
    if (typeof ts !== 'string') return null;
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return null;
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Math.abs(now - t) > sevenDays) return null;
    return new Date(t).toISOString();
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
    const clientId = validClientId(req.body?.clientId);

    // Idempotency — if this clientId already maps to a stored punch, return
    // it as-is. Lets the offline queue safely retry without creating dupes.
    if (clientId) {
      const prior = punchesStore.findByClientId(req.user.id, clientId);
      if (prior) return res.json({ ok: true, punch: prior, duplicate: true });
    }

    if (punchesStore.hasOpenPunch(req.user.id)) {
      return res.badRequest('You are already clocked in', { errorCode: 'already_clocked_in' });
    }
    // Offline replays may carry a clientTs. Honor it if reasonable; otherwise
    // stamp server-side. `recvTs` always records the server-receipt instant, so
    // a backdated offline punch is detectable (and audited below) — M17 S3.
    const recvTs = new Date().toISOString();
    const ts = validClientTs(req.body?.clientTs) ?? recvTs;
    const record = punchesStore.append(req.user.id, {
      type: 'in',
      ts,
      recvTs,
      comment: validComment(req.body?.comment),
      geo: validGeo(req.body?.geo),
      geoSkipReason: validGeoSkipReason(req.body?.geoSkipReason),
      clientId,
    });
    auditBackdate(req, 'in', ts, recvTs);
    res.json({ ok: true, punch: record });
  }));

  // --------------------------------------------------------------------------
  router.post('/api/punches/clock-out', requireAuth((req, res) => {
    const clientId = validClientId(req.body?.clientId);

    if (clientId) {
      const prior = punchesStore.findByClientId(req.user.id, clientId);
      if (prior) return res.json({ ok: true, punch: prior, duplicate: true });
    }

    if (!punchesStore.hasOpenPunch(req.user.id)) {
      return res.badRequest('You are not currently clocked in', { errorCode: 'not_clocked_in' });
    }
    const recvTs = new Date().toISOString();
    const ts = validClientTs(req.body?.clientTs) ?? recvTs;
    const record = punchesStore.append(req.user.id, {
      type: 'out',
      ts,
      recvTs,
      comment: validComment(req.body?.comment),
      geo: validGeo(req.body?.geo),
      geoSkipReason: validGeoSkipReason(req.body?.geoSkipReason),
      clientId,
    });
    auditBackdate(req, 'out', ts, recvTs);
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
    // Validate the id shape at the edge: it becomes a path segment in the
    // punch store. Reject non-UUIDs with a clean 400 (the store also throws as
    // defense-in-depth). Closes the path-traversal class flagged as M17 S1.
    if (!isUuid(req.params.id)) {
      return res.badRequest('Invalid employee id', { errorCode: 'invalid_id' });
    }
    const { date, year, month } = req.query;

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.badRequest('date must be YYYY-MM-DD', { errorCode: 'invalid_date' });
      return res.json({
        date,
        punches: punchesStore.listDay(req.params.id, date),
      });
    }

    if (year || month) {
      const y = Number(year), m = Number(month);
      if (!Number.isInteger(y) || y < 2000 || y > 2100) return res.badRequest('year must be a 4-digit year', { errorCode: 'invalid_value' });
      if (!Number.isInteger(m) || m < 1 || m > 12)      return res.badRequest('month must be 1–12', { errorCode: 'invalid_value' });
      return res.json({
        year: y, month: m,
        punches: punchesStore.listMonth(req.params.id, y, m),
      });
    }

    const ymd = todayYmd();
    res.json({ date: ymd, punches: punchesStore.listDay(req.params.id, ymd) });
  }));
}
