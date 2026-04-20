import { postJson, showMessage, setBusy } from '/app.js';

import { mountTopBar } from '/topbar.js';
mountTopBar();

const $ = (id) => document.getElementById(id);
const statusBlock = $('status-block');
const statusLabel = $('status-label');
const statusMeta  = $('status-meta');
const commentEl   = $('comment');
const shareGeo    = $('share-geo');
const geoStatusEl = $('geo-status');
const actionBtn   = $('action-btn');
const messageEl   = $('message');
const listEl      = $('today-list');
const allLink     = $('all-today-link');

let isOpen = false;
let me = null;

// -------- Time formatting (24-hour HH:MM from an ISO timestamp) -------------

function formatTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function relative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// -------- Status block ------------------------------------------------------

function paintStatus({ open, lastPunch }) {
  isOpen = open;
  statusBlock.classList.remove('status-block--in', 'status-block--out', 'status-block--unknown');
  if (open) {
    statusBlock.classList.add('status-block--in');
    statusLabel.textContent = 'Clocked in';
    statusMeta.textContent = lastPunch ? `since ${formatTime(lastPunch.ts)} (${relative(lastPunch.ts)})` : '';
    actionBtn.textContent = 'Clock out';
    actionBtn.className = 'block punch-action punch-action--out';
  } else {
    statusBlock.classList.add('status-block--out');
    statusLabel.textContent = 'Clocked out';
    statusMeta.textContent = lastPunch ? `last: ${formatTime(lastPunch.ts)} (${relative(lastPunch.ts)})` : 'no punches yet';
    actionBtn.textContent = 'Clock in';
    actionBtn.className = 'block punch-action punch-action--in';
  }
  actionBtn.disabled = false;
}

// -------- Geolocation -------------------------------------------------------

function getGeo() {
  return new Promise((resolve) => {
    if (!shareGeo.checked) return resolve(null);
    if (!('geolocation' in navigator)) {
      geoStatusEl.textContent = 'Your browser does not support geolocation.';
      return resolve(null);
    }
    geoStatusEl.textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoStatusEl.textContent = '';
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        geoStatusEl.textContent = `Location unavailable: ${err.message}`;
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

// -------- Today list --------------------------------------------------------

function renderList(punches) {
  listEl.innerHTML = '';
  if (punches.length === 0) {
    const li = document.createElement('li');
    li.className = 'subtle';
    li.textContent = 'No punches yet today.';
    listEl.appendChild(li);
    return;
  }
  // Newest first — easier to scan on a phone.
  for (const p of [...punches].reverse()) {
    const li = document.createElement('li');
    li.className = 'punch-list__item';

    const badge = document.createElement('span');
    badge.className = `punch-list__badge punch-list__badge--${p.type}`;
    badge.textContent = p.type === 'in' ? 'In' : 'Out';

    const body = document.createElement('div');
    body.className = 'punch-list__body';
    const time = document.createElement('div');
    time.className = 'punch-list__time';
    time.textContent = formatTime(p.ts);
    body.appendChild(time);

    const meta = document.createElement('div');
    meta.className = 'punch-list__meta';
    const parts = [];
    if (p.comment) parts.push(escapeHtml(p.comment));
    if (p.geo) {
      parts.push(`<span class="punch-list__geo">${p.geo.lat.toFixed(4)}, ${p.geo.lng.toFixed(4)}</span>`);
    }
    meta.innerHTML = parts.join(' · ');
    if (parts.length > 0) body.appendChild(meta);

    li.appendChild(badge);
    li.appendChild(body);
    listEl.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// -------- Data refresh ------------------------------------------------------

async function refresh() {
  const [statusRes, todayRes] = await Promise.all([
    fetch('/api/punches/status',  { credentials: 'same-origin' }),
    fetch('/api/punches/today',   { credentials: 'same-origin' }),
  ]);
  if (statusRes.status === 401) { window.location.href = '/login'; return; }
  const status = await statusRes.json();
  paintStatus(status);

  const today = await todayRes.json();
  // For an employer, /today returns all users — on this page we only care
  // about the current user. Filter client-side.
  const mine = today.punches.filter((p) => p.employeeId === me.id);
  renderList(mine);
}

// -------- Action ------------------------------------------------------------

actionBtn.addEventListener('click', async () => {
  showMessage(messageEl, '');
  setBusy(actionBtn, true, 'Working…');

  const geo = await getGeo();
  const payload = {
    comment: commentEl.value.trim() || undefined,
    geo: geo || undefined,
  };

  const url = isOpen ? '/api/punches/clock-out' : '/api/punches/clock-in';
  const result = await postJson(url, payload);

  if (result.ok) {
    commentEl.value = '';
    showMessage(messageEl, isOpen ? 'Clocked out.' : 'Clocked in.', 'success');
    await refresh();
  } else {
    showMessage(messageEl, result.data.error || 'Action failed', 'error');
    setBusy(actionBtn, false);
  }
});

// -------- Bootstrap ---------------------------------------------------------

(async () => {
  const meRes = await fetch('/api/me', { credentials: 'same-origin' });
  if (meRes.status === 401) { window.location.href = '/login'; return; }
  me = await meRes.json();
  if (me.role === 'employer') allLink.hidden = false;
  await refresh();
})();
