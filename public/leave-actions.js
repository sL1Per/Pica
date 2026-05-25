// Pica — shared leave decide helpers (M15 Plan 5).
//
// The employer "approve / reject" actions used by BOTH the leaves list
// (leaves.js) and the calendar rail (leaves-calendar.js). DOM-free: callers
// own the buttons, messages, and reload. Approve runs the same concurrency
// check + confirm the detail page uses.

import { postJson } from '/app.js';
import { t } from '/i18n.js';

/**
 * Approve a pending leave, warning first if the policy forbids concurrent
 * leaves and approved overlaps exist.
 * @param {{id:string}} leave
 * @returns {Promise<{ ok:boolean, cancelled?:boolean, data?:object }>}
 *   `cancelled:true` when the user dismissed the concurrency confirm.
 */
export async function approveLeaveWithCheck(leave) {
  let overlaps = [];
  let concurrentAllowed = true;
  try {
    const r = await fetch(`/api/leaves/${leave.id}/overlaps`, { credentials: 'same-origin' });
    if (r.ok) {
      const j = await r.json();
      overlaps = j.overlaps ?? [];
      concurrentAllowed = j.concurrentAllowed !== false;
    }
  } catch { /* non-fatal — skip the warning if unreachable */ }

  if (overlaps.length > 0 && !concurrentAllowed) {
    const names = overlaps.map((o) => o.fullName || o.username || t('rlm.someone')).join(', ');
    if (!confirm(t('leaves.concurrentConfirm', { n: overlaps.length, names }))) {
      return { ok: false, cancelled: true };
    }
  }

  const res = await postJson(`/api/leaves/${leave.id}/approve`, {});
  return { ok: res.ok, data: res.data };
}

/**
 * Reject a pending leave with an optional employee-facing note.
 * @returns {Promise<{ ok:boolean, data?:object }>}
 */
export async function rejectLeave(id, notes) {
  const res = await postJson(`/api/leaves/${id}/reject`, { notes });
  return { ok: res.ok, data: res.data };
}
