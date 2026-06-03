/**
 * Zero-dependency SVG charts for the Reports dashboard. Pure functions that
 * return SVG strings; the caller injects them with innerHTML. Colors come from
 * CSS custom properties so charts follow the active theme. Each root carries an
 * accessible label.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Grouped bar chart: worked + on-leave per bucket, with a dashed target line.
 * @param {{ series:Array<{key,worked,onLeave,target}>, labels:string[],
 *           ariaLabel:string }} opts
 */
export function barChart({ series, labels, ariaLabel }) {
  const W = 640, H = 240, padL = 36, padB = 28, padT = 12, padR = 8;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxV = Math.max(8, ...series.map((s) => Math.max(s.worked + s.onLeave, s.target)));
  const y = (v) => padT + innerH - (v / maxV) * innerH;
  const bw = innerW / Math.max(1, series.length);
  const barW = Math.min(40, bw * 0.6);
  // With many buckets (e.g. a 30-day month) per-bar labels collide, so show
  // only every Nth — capped at ~12 labels across the axis.
  const labelStep = Math.max(1, Math.ceil(series.length / 12));

  let bars = '';
  series.forEach((s, i) => {
    const cx = padL + i * bw + (bw - barW) / 2;
    const wH = (s.worked / maxV) * innerH;
    const lH = (s.onLeave / maxV) * innerH;
    bars += `<rect x="${cx}" y="${y(s.worked)}" width="${barW}" height="${wH}" class="bar bar--worked" rx="3"/>`;
    if (s.onLeave > 0) bars += `<rect x="${cx}" y="${y(s.worked + s.onLeave)}" width="${barW}" height="${lH}" class="bar bar--leave" rx="3"/>`;
    if (i % labelStep === 0) bars += `<text x="${cx + barW / 2}" y="${H - 8}" class="chart-axis" text-anchor="middle">${esc(labels[i] ?? '')}</text>`;
  });

  // Dashed target line at a full bucket's target (the max across buckets, so
  // weekend/zero buckets don't drag it down). Day buckets → one weekday (8h);
  // month buckets → a full month. The period's *total* target lives on the KPI
  // card; this line is the per-bar goal each bar is measured against.
  const tgt = series.length ? Math.max(0, ...series.map((s) => s.target)) : 0;
  const targetLine = tgt > 0
    ? `<line x1="${padL}" y1="${y(tgt)}" x2="${W - padR}" y2="${y(tgt)}" class="chart-target"/>
       <text x="${W - padR}" y="${y(tgt) - 4}" text-anchor="end" class="chart-axis chart-target-lbl">${Math.round(tgt)}h</text>`
    : '';

  const gridY = [0, 0.5, 1].map((f) => {
    const v = maxV * f, yy = y(v);
    return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" class="chart-grid"/>
            <text x="${padL - 6}" y="${yy + 3}" text-anchor="end" class="chart-axis">${Math.round(v)}h</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="xMidYMid meet">${gridY}${bars}${targetLine}</svg>`;
}

/**
 * Donut chart of slices with a center total.
 * @param {{ slices:Array<{label,value,cls}>, centerValue:string|number,
 *           centerLabel:string, ariaLabel:string }} opts
 */
export function donutChart({ slices, centerValue, centerLabel, ariaLabel }) {
  const size = 180, r = 70, cx = size / 2, cy = size / 2, stroke = 22;
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const ring = slices.filter((s) => s.value > 0).map((s) => {
    const frac = s.value / total, len = frac * C;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}"
      class="donut-seg ${s.cls}" stroke-dasharray="${len} ${C - len}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len; return seg;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="${esc(ariaLabel)}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}" class="donut-track"/>
    ${ring}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-num">${esc(centerValue)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-lbl">${esc(centerLabel)}</text>
  </svg>`;
}

/** Inline vs-target progress bar (0–100+, clamped visual at 100%). */
export function miniBar(pct) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const label = pct == null ? '—' : `${Math.round(pct)}%`;
  return `<span class="minibar"><span class="minibar__fill" style="width:${p}%"></span></span>` +
         `<span class="minibar__lbl">${esc(label)}</span>`;
}
