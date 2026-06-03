// leave-format.js — pure formatting helpers for a leave object, shared by the
// leave detail page (leave.js) and the leave detail modal (leave-detail-modal.js).
//
// These five functions were byte-identical copies in both files; extracted in
// 0.52.4 (M16 / finding F5) so the page and the modal can't drift. They are
// pure — no DOM, no module state — and safe to import anywhere. The *renderers*
// (renderMiniCal / renderActivity) deliberately stay in each file: they use
// different CSS namespaces (ldet-* vs ldm-*) and different DOM contracts
// (write-into-host vs return-detached-node), so they are not shared.

import { tn, fmtHours } from '/i18n.js';

export function pad2(n) { return String(n).padStart(2, '0'); }
export function ymd(s) { return String(s).slice(0, 10); }
export function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); }

export function formatWhen(l) {
  if (l.unit === 'days') {
    return l.start === l.end ? l.start : `${l.start} → ${l.end}`;
  }
  const s = new Date(l.start);
  const e = new Date(l.end);
  const sameDay = s.toDateString() === e.toDateString();
  const ds = s.toISOString().slice(0, 10);
  const hs = `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
  const he = `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
  return sameDay ? `${ds}, ${hs}–${he}` : `${l.start} → ${l.end}`;
}

export function formatDuration(l) {
  if (l.unit === 'hours' && typeof l.hours === 'number') {
    return tn('leave.durHours', l.hours, { count: fmtHours(l.hours) });
  }
  const s = new Date(l.start);
  const e = new Date(l.end);
  const days = Math.round((e - s) / 86_400_000) + 1;
  return tn('leave.durDays', days, { count: days });
}
