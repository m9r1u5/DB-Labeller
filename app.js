/* DB Board Labeller — main app */
'use strict';
const VERSION = '1.0.3';
const APP_URL = 'https://m9r1u5.github.io/DB-Labeller/';
const APK_URL = 'https://github.com/m9r1u5/DB-Labeller/releases/latest/download/DB-Labeller.apk';
// Running inside the Android APK (Capacitor WebView)?
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const NP = name => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

const DEVICE_TYPES = ['MCB', 'CB – Circuit breaker', 'RCD / Earth leakage', 'RCBO', 'Isolator', 'Surge arrester', 'Main switch', 'Other'];
const DEVICE_SHORT = { 'MCB': 'MCB', 'CB – Circuit breaker': 'CB', 'RCD / Earth leakage': 'RCD', 'RCBO': 'RCBO', 'Isolator': 'Isolator', 'Surge arrester': 'SPD', 'Main switch': 'Main sw', 'Other': 'Other' };
const POLES = ['1P', '2P', '3P', '4P'];
const CURVES = ['B', 'C', 'D'];
const RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];
const MAS = [30, 100, 300, 500];
// Which fields apply to which device
const hasCurve = t => /^(MCB|RCBO|CB\b)/.test(t || '');
const hasMA = t => /RCD|RCBO/.test(t || '');
const CABLES = ['1.5', '2.5', '4', '6', '10', '16', '25', '35', '50'];
const DEFAULT_PICKS = ['Lights', 'Plugs', 'Geyser', 'Stove', 'Oven', 'Hob', 'Aircon', 'Pool pump', 'Gate motor',
  'Garage door', 'Borehole', 'Heat pump', 'Underfloor heating', 'Dishwasher', 'Washing machine', 'Tumble dryer',
  'Kitchen plugs', 'Bedroom plugs', 'Lights – bedrooms', 'Lights – living areas', 'Outside lights', 'Electric fence',
  'Alarm', 'Inverter', 'Solar PV', 'Surge protection', 'Earth leakage', 'Main switch', 'Spare'];
const DEFAULT_SETTINGS = {
  theme: 'auto', elecName: '', elecReg: '', moduleMM: 18, labelH: 12, labelMode: 'individual', labelRating: true,
  includePhoto: true, picks: DEFAULT_PICKS.slice()
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const natCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const fmtDate = s => { if (!s) return ''; const p = s.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; };
const safeName = s => String(s || 'file').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'file';

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function busy(msg) {
  const b = document.createElement('div');
  b.className = 'busy'; b.innerHTML = '<div>' + esc(msg || 'Working…') + '</div>';
  document.body.appendChild(b);
  return () => b.remove();
}

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('db-board-labeller', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' }).createIndex('jobId', 'jobId');
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _req(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode), s = tx.objectStore(store);
      const r = fn(s);
      tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Storage aborted (device storage full?)'));
    });
  },
  get(store, key) { return this._req(store, 'readonly', s => s.get(key)); },
  all(store) { return this._req(store, 'readonly', s => s.getAll()); },
  put(store, val) { return this._req(store, 'readwrite', s => s.put(val)); },
  del(store, key) { return this._req(store, 'readwrite', s => s.delete(key)); },
  boardsFor(jobId) { return this._req('boards', 'readonly', s => s.index('jobId').getAll(jobId)).then(b => b.sort((a, c) => (a.order || 0) - (c.order || 0))); }
};

let SETTINGS = Object.assign({}, DEFAULT_SETTINGS);
async function loadSettings() {
  const m = await DB.get('meta', 'settings');
  SETTINGS = Object.assign({}, DEFAULT_SETTINGS, m ? m.value : {});
  applyTheme();
}
async function saveSettings() { await DB.put('meta', { key: 'settings', value: SETTINGS }); applyTheme(); }
function applyTheme() {
  const t = SETTINGS.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('dbl-theme', t); } catch (e) {}
}

/* ---------- Modal / sheets ---------- */
const overlay = () => $('#overlay');
let sheetStack = [];

function openSheet(html, onMount, opts) {
  opts = opts || {};
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = '<div class="sheet" role="dialog"><div class="sheet-bar" title="Drag to move"><div class="grab"></div>' + (opts.bar || '') + '</div>' + html + '</div>';
  overlay().appendChild(scrim);
  const entry = { el: scrim, onClose: null };
  sheetStack.push(entry);
  history.pushState({ sheet: sheetStack.length }, '');
  scrim.addEventListener('click', e => { if (e.target === scrim && !opts.keepOpen) closeSheet(); });
  const sheet = scrim.querySelector('.sheet');
  entry.mover = makeSheetMovable(scrim, sheet);
  if (onMount) onMount(sheet, entry);
  return entry;
}
// Drag the sheet's top bar up/down to see what is behind it. Tap the bar to flip between open and tucked away.
function makeSheetMovable(scrim, sheet) {
  const bar = sheet.querySelector('.sheet-bar');
  let dy = 0, drag = null;
  const maxDy = () => Math.max(0, sheet.offsetHeight - bar.offsetHeight - 14);
  const setDy = (v, anim) => {
    dy = Math.max(0, Math.min(maxDy(), v));
    sheet.style.transition = anim ? 'transform .22s ease' : 'none';
    sheet.style.transform = dy ? 'translateY(' + dy + 'px)' : '';
    scrim.classList.toggle('peek', dy > 40);
    sheet.dispatchEvent(new CustomEvent('sheetmove', { detail: { dy, tucked: dy > 40 } }));
  };
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, input, select')) return;
    drag = { y: e.clientY, dy, moved: false };
    try { bar.setPointerCapture(e.pointerId); } catch (err) {}
  });
  bar.addEventListener('pointermove', e => {
    if (!drag) return;
    const d = e.clientY - drag.y;
    if (Math.abs(d) > 6) drag.moved = true;
    if (drag.moved) setDy(drag.dy + d);
  });
  const end = () => {
    if (!drag) return;
    if (!drag.moved) setDy(dy > 40 ? 0 : maxDy(), true);
    drag = null;
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  // Typing in a field while tucked away brings the form back up
  sheet.addEventListener('focusin', e => { if (dy > 40 && e.target.matches('input, select, textarea')) setDy(0, true); });
  return { tuck: () => setDy(maxDy(), true), open: () => setDy(0, true), isTucked: () => dy > 40 };
}
function closeSheet() { if (sheetStack.length) history.back(); }
// Close the top sheet and resolve once the history entry is gone (safe to navigate after)
function closeSheetAsync() {
  return new Promise(res => {
    const e = sheetStack[sheetStack.length - 1];
    if (!e) return res();
    e.after = res;
    history.back();
  });
}
function _popSheet() {
  const e = sheetStack.pop();
  if (!e) return false;
  e.el.remove();
  if (e.onClose) e.onClose();
  if (e.after) e.after();
  return true;
}
window.addEventListener('popstate', () => { if (sheetStack.length) _popSheet(); });

function modal(title, msg, buttons) {
  return new Promise(resolve => {
    const w = document.createElement('div');
    w.className = 'modal-wrap';
    w.innerHTML = '<div class="modal" role="alertdialog"><h3>' + esc(title) + '</h3>' + (msg ? '<p>' + esc(msg) + '</p>' : '') +
      '<div class="btn-row">' + buttons.map((b, i) => '<button class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + esc(b.label) + '</button>').join('') + '</div></div>';
    document.body.appendChild(w);
    w.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) { w.remove(); resolve(buttons[+b.dataset.i].value); }
    });
  });
}
const confirmDlg = (title, msg, okLabel = 'Delete', danger = true) =>
  modal(title, msg, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, cls: danger ? 'danger solid' : 'primary' }]);
const alertDlg = (title, msg) => modal(title, msg, [{ label: 'OK', value: true, cls: 'primary' }]);

/* ---------- File output (share / open / download) ---------- */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
// APK: write the file with the Filesystem plugin, then share or save it
function fileReadyNative(blob, name, title) {
  openSheet(
    '<h3>' + esc(title || 'File ready') + '</h3>' +
    '<p class="muted small" style="margin-top:-6px">' + esc(name) + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB</p>' +
    '<div class="menu-list">' +
    '<button class="btn primary block" data-a="share">Share / open / print… (WhatsApp, email, Drive, PDF viewer)</button>' +
    '<button class="btn block" data-a="save">Save to phone (Documents/DB Labeller)</button>' +
    '<button class="btn block" data-a="close">Close</button></div>',
    sheet => sheet.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const FS = NP('Filesystem'), SH = NP('Share');
      if (a.dataset.a === 'close') return closeSheet();
      const done = busy('Preparing file…');
      try {
        const data = await blobToBase64(blob);
        if (a.dataset.a === 'share') {
          const w = await FS.writeFile({ path: name, data, directory: 'CACHE' });
          done();
          try { await SH.share({ title: name, files: [w.uri], dialogTitle: 'Share ' + name }); }
          catch (err) { if (!/cancel/i.test(err && err.message || '')) toast('Share failed'); }
        } else {
          await FS.writeFile({ path: 'DB Labeller/' + name, data, directory: 'DOCUMENTS', recursive: true });
          done(); toast('Saved to Documents/DB Labeller', 3500);
        }
      } catch (err) { done(); alertDlg('Could not save file', (err && err.message || String(err)) + '\nTry Share instead and choose Drive or Files.'); }
    })
  );
}
function fileReady(blob, name, title) {
  if (IS_NATIVE && NP('Filesystem') && NP('Share')) return fileReadyNative(blob, name, title);
  const file = new File([blob], name, { type: blob.type });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const isPdf = blob.type === 'application/pdf';
  openSheet(
    '<h3>' + esc(title || 'File ready') + '</h3>' +
    '<p class="muted small" style="margin-top:-6px">' + esc(name) + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB</p>' +
    '<div class="menu-list">' +
    (canShare ? '<button class="btn primary block" data-a="share">Share… (WhatsApp, email, Drive)</button>' : '') +
    (isPdf ? '<button class="btn block" data-a="open">Open / Print</button>' : '') +
    '<button class="btn block" data-a="dl">Save to phone (download)</button>' +
    '<button class="btn block" data-a="close">Close</button></div>',
    sheet => sheet.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'share') {
        try { await navigator.share({ files: [file], title: name }); } catch (err) { if (err.name !== 'AbortError') toast('Share failed – try Save instead'); }
      } else if (a.dataset.a === 'open') {
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank');
        if (!w) location.href = url;
      } else if (a.dataset.a === 'dl') downloadBlob(blob, name);
      else closeSheet();
    })
  );
}

/* ---------- Images ---------- */
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read image')); i.src = src; });
}
async function compressImage(file, maxDim = 2000, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    return { data: c.toDataURL('image/jpeg', quality), w, h };
  } finally { URL.revokeObjectURL(url); }
}
async function makeThumb(dataUrl) {
  const img = await loadImage(dataUrl);
  const s = 160 / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
// Photo with numbered markers burned in
async function markedPhoto(board, maxDim = 1800) {
  if (!board.photo) return null;
  const img = await loadImage(board.photo);
  const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const r = Math.max(16, Math.round(Math.max(w, h) * 0.024));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  (board.markers || []).filter(m => m.x != null).forEach(m => {
    const x = m.x * w, y = m.y * h, label = String(m.n);
    ctx.font = '800 ' + Math.round(r * (label.length > 2 ? 0.8 : 1.05)) + 'px system-ui, sans-serif';
    const tw = ctx.measureText(label).width, bw = Math.max(r * 2, tw + r * 0.9);
    ctx.beginPath();
    if (bw > r * 2) { roundRect(ctx, x - bw / 2, y - r, bw, r * 2, r); } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc400'; ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.16); ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.08); ctx.strokeStyle = '#fff';
    ctx.beginPath();
    if (bw > r * 2) roundRect(ctx, x - bw / 2 - r * 0.12, y - r * 1.12, bw + r * 0.24, r * 2.24, r * 1.12); else ctx.arc(x, y, r * 1.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillText(label, x, y + 1);
  });
  return c.toDataURL('image/jpeg', 0.85);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ---------- Circuit helpers ---------- */
function nextNumber(board) {
  let max = 0;
  (board.markers || []).forEach(m => { const v = parseInt(m.n, 10); if (!isNaN(v) && v > max) max = v; });
  return String(max + 1);
}
function sortedMarkers(board) { return (board.markers || []).slice().sort((a, b) => natCmp(a.n, b.n)); }
function modulesOf(m) { const v = parseFloat(m.modules); if (v > 0) return v; return parseInt(m.poles, 10) || 1; }
function deviceLine(m) {
  const p = [];
  if (m.type) p.push(DEVICE_SHORT[m.type] || m.type);
  if (m.rating) p.push(m.rating + 'A');
  if (m.poles) p.push(m.poles);
  if (m.curve && hasCurve(m.type)) p.push(m.curve + '-curve');
  if (m.ma && hasMA(m.type)) p.push(m.ma + 'mA');
  if (m.cable) p.push(m.cable + 'mm²');
  if (m.points) p.push(m.points + ' pts');
  return p.join(' · ');
}
// Group markers into DIN rail rows (manual row wins, else cluster by y), each sorted left→right
function rowsOf(board) {
  const ms = (board.markers || []).slice();
  const auto = ms.filter(m => !m.row && m.x != null).sort((a, b) => a.y - b.y);
  const noPos = ms.filter(m => !m.row && m.x == null);
  const rows = {};
  let rowNo = 0, lastY = -1;
  auto.forEach(m => {
    if (lastY < 0 || m.y - lastY > 0.05) rowNo++;
    lastY = m.y;
    (rows[rowNo] = rows[rowNo] || []).push(m);
  });
  ms.filter(m => m.row).forEach(m => { const r = parseInt(m.row, 10); (rows[r] = rows[r] || []).push(m); });
  if (noPos.length) (rows[Math.max(rowNo, 0) + 1] = rows[Math.max(rowNo, 0) + 1] || []).push(...noPos);
  return Object.keys(rows).map(Number).sort((a, b) => a - b).map(k => ({
    row: k,
    items: rows[k].sort((a, b) => (a.x != null && b.x != null) ? a.x - b.x : natCmp(a.n, b.n))
  }));
}

/* ---------- Header & routing ---------- */
let navDepth = 0;
function setHeader(title, back, actionsHtml) {
  $('#title').textContent = title;
  $('#backBtn').classList.toggle('hidden', !back);
  $('#backBtn').dataset.parent = back || '';
  $('#hdrActions').innerHTML = actionsHtml || '';
}
$('#backBtn').addEventListener('click', () => {
  if (navDepth > 0) history.back(); else location.hash = $('#backBtn').dataset.parent || '#/';
});
function go(hash) { navDepth++; location.hash = hash; }
window.addEventListener('hashchange', () => { if (!sheetStack.length) render(); else { while (sheetStack.length) _popSheet(); render(); } });

let currentEditor = null;
async function render() {
  if (currentEditor) { currentEditor.destroy(); currentEditor = null; }
  const h = location.hash || '#/';
  const m = h.match(/^#\/(job|board)\/(.+)$/);
  window.scrollTo(0, 0);
  try {
    if (m && m[1] === 'job') await viewJob(decodeURIComponent(m[2]));
    else if (m && m[1] === 'board') await viewBoard(decodeURIComponent(m[2]));
    else if (h === '#/settings') await viewSettings();
    else await viewJobs();
  } catch (e) { console.error(e); $('#main').innerHTML = '<div class="empty">Something went wrong: ' + esc(e.message) + '</div>'; }
}

const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>';

/* ---------- Jobs list ---------- */
let jobSearch = '';
async function viewJobs() {
  setHeader('DB Board Labeller', null, '<button class="icon-btn" id="setBtn" aria-label="Settings">' + ICON_GEAR + '</button>');
  $('#setBtn').onclick = () => go('#/settings');
  const [jobs, boards] = await Promise.all([DB.all('jobs'), DB.all('boards')]);
  const counts = {};
  boards.forEach(b => { counts[b.jobId] = (counts[b.jobId] || 0) + 1; });
  jobs.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const main = $('#main');
  main.innerHTML =
    '<div class="search"><input class="in" id="q" type="search" placeholder="Search client, address, COC ref…" value="' + esc(jobSearch) + '"></div>' +
    '<div class="list" id="jobList"></div>' +
    '<div class="section-title">App</div><div class="app-bar">' +
    '<button class="btn" data-app="install">Install</button><button class="btn" data-app="update">Update</button><button class="btn" data-app="share">Share App</button></div>' +
    '<p class="muted small" style="text-align:center;margin-top:14px">v' + VERSION + ' · data is stored only on this phone</p>' +
    '<button class="fab" id="newJob">+ New Job</button>';
  const list = $('#jobList');
  const draw = () => {
    const q = jobSearch.trim().toLowerCase();
    const f = jobs.filter(j => !q || [j.client, j.address, j.ref, j.elecName].join(' ').toLowerCase().includes(q));
    list.innerHTML = f.length ? f.map(j =>
      '<div class="item" data-id="' + esc(j.id) + '"><div class="grow"><div class="t">' + esc(j.client || 'Untitled job') + '</div>' +
      '<div class="s">' + esc([j.ref && ('Ref ' + j.ref), fmtDate(j.date)].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="s">' + esc(j.address || '') + '</div></div>' +
      '<span class="badge">' + (counts[j.id] || 0) + ' DB</span>' +
      '<button class="icon-btn" data-menu="' + esc(j.id) + '" aria-label="Job options">' + ICON_DOTS + '</button></div>').join('')
      : '<div class="empty">' + (jobs.length ? 'No jobs match your search.' : 'No jobs yet.<br>Tap <b>+ New Job</b> to start.') + '</div>';
  };
  draw();
  $('#q').addEventListener('input', e => { jobSearch = e.target.value; draw(); });
  list.addEventListener('click', e => {
    const mb = e.target.closest('[data-menu]');
    if (mb) { e.stopPropagation(); jobMenu(jobs.find(j => j.id === mb.dataset.menu)); return; }
    const it = e.target.closest('.item'); if (it) go('#/job/' + encodeURIComponent(it.dataset.id));
  });
  $('#newJob').onclick = () => editJob(null);
  bindAppButtons(main);
}

function jobMenu(job) {
  openSheet('<h3>' + esc(job.client || 'Job') + '</h3><div class="menu-list">' +
    '<button class="btn block" data-a="open">Open</button><button class="btn block" data-a="edit">Edit details</button>' +
    '<button class="btn block" data-a="dup">Duplicate</button><button class="btn danger block" data-a="del">Delete</button>' +
    '<button class="btn block" data-a="x">Cancel</button></div>', sheet => sheet.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    if (act === 'x') return closeSheet();
    await closeSheetAsync();
    if (act === 'open') go('#/job/' + encodeURIComponent(job.id));
    else if (act === 'edit') editJob(job);
    else if (act === 'dup') { await duplicateJob(job); render(); }
    else if (act === 'del') { if (await deleteJob(job)) render(); }
  }));
}

function editJob(job) {
  const isNew = !job;
  job = job || { id: uid(), client: '', address: '', ref: '', date: today(), elecName: SETTINGS.elecName, elecReg: SETTINGS.elecReg, created: Date.now() };
  openSheet('<h3>' + (isNew ? 'New Job' : 'Edit Job') + '</h3><form id="jf">' +
    '<label class="f"><span>Client name *</span><input class="in" name="client" required value="' + esc(job.client) + '" autocomplete="off"></label>' +
    '<label class="f"><span>Site address</span><textarea class="in" name="address" rows="2">' + esc(job.address) + '</textarea></label>' +
    '<div class="row2"><label class="f"><span>Job / COC ref no.</span><input class="in" name="ref" value="' + esc(job.ref) + '" autocomplete="off"></label>' +
    '<label class="f"><span>Date</span><input class="in" type="date" name="date" value="' + esc(job.date) + '"></label></div>' +
    '<label class="f"><span>Electrician name</span><input class="in" name="elecName" value="' + esc(job.elecName) + '"></label>' +
    '<label class="f"><span>Registration number</span><input class="in" name="elecReg" value="' + esc(job.elecReg) + '"></label>' +
    '<div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>',
  sheet => {
    $('[data-x]', sheet).onclick = closeSheet;
    $('#jf', sheet).addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      ['client', 'address', 'ref', 'date', 'elecName', 'elecReg'].forEach(k => { job[k] = String(fd.get(k) || '').trim(); });
      job.updated = Date.now();
      await DB.put('jobs', job);
      if (isNew && !SETTINGS.elecName && job.elecName) { SETTINGS.elecName = job.elecName; SETTINGS.elecReg = job.elecReg; saveSettings(); }
      await closeSheetAsync();
      if (isNew) go('#/job/' + encodeURIComponent(job.id)); else render();
    });
    if (isNew) setTimeout(() => $('[name=client]', sheet).focus(), 250);
  });
}

async function duplicateJob(job) {
  const done = busy('Duplicating…');
  try {
    const nj = Object.assign({}, job, { id: uid(), client: (job.client || 'Job') + ' (copy)', created: Date.now(), updated: Date.now() });
    await DB.put('jobs', nj);
    for (const b of await DB.boardsFor(job.id)) {
      await DB.put('boards', Object.assign({}, b, { id: uid(), jobId: nj.id, markers: (b.markers || []).map(m => Object.assign({}, m, { id: uid() })) }));
    }
    toast('Job duplicated');
    return nj;
  } finally { done(); }
}
async function deleteJob(job) {
  const boards = await DB.boardsFor(job.id);
  if (!await confirmDlg('Delete job?', '“' + (job.client || 'Untitled') + '” and its ' + boards.length + ' board(s), photos and circuits will be permanently deleted.')) return false;
  for (const b of boards) await DB.del('boards', b.id);
  await DB.del('jobs', job.id);
  toast('Job deleted');
  return true;
}
async function touchJob(jobId) { const j = await DB.get('jobs', jobId); if (j) { j.updated = Date.now(); await DB.put('jobs', j); } }

/* ---------- Job view ---------- */
async function viewJob(id) {
  const job = await DB.get('jobs', id);
  if (!job) { location.replace('#/'); return; }
  setHeader(job.client || 'Job', '#/', '<button class="icon-btn" id="jm" aria-label="Job options">' + ICON_DOTS + '</button>');
  const boards = await DB.boardsFor(id);
  const total = boards.reduce((s, b) => s + (b.markers || []).length, 0);
  $('#main').innerHTML =
    '<div class="card"><dl class="kv">' +
    '<dt>Client</dt><dd>' + esc(job.client) + '</dd><dt>Address</dt><dd>' + esc(job.address || '—') + '</dd>' +
    '<dt>COC ref</dt><dd>' + esc(job.ref || '—') + '</dd><dt>Date</dt><dd>' + esc(fmtDate(job.date) || '—') + '</dd>' +
    '<dt>Electrician</dt><dd>' + esc(job.elecName || '—') + '</dd><dt>Reg. no.</dt><dd>' + esc(job.elecReg || '—') + '</dd></dl>' +
    '<div class="btn-row" style="margin-top:12px"><button class="btn" id="editJob">Edit details</button></div></div>' +
    '<div class="section-title">Boards (' + boards.length + ')</div>' +
    '<div class="list" id="boardList">' + (boards.length ? boards.map(b =>
      '<button class="item" data-id="' + esc(b.id) + '">' + (b.thumb ? '<img class="thumb" src="' + b.thumb + '" alt="">' : '<div class="thumb">⚡</div>') +
      '<div class="grow"><div class="t">' + esc(b.name || 'Board') + '</div><div class="s">' + esc(b.location || '') + '</div>' +
      '<div class="s">' + esc([b.supply && ('Fed from ' + b.supply), b.mainRating && ('Main ' + b.mainRating + 'A')].filter(Boolean).join(' · ')) + '</div></div>' +
      '<span class="badge">' + (b.markers || []).length + '</span></button>').join('') : '<div class="empty">No boards yet. Add the main DB first.</div>') + '</div>' +
    '<button class="btn accent block" id="addBoard" style="margin-top:12px">+ Add Board</button>' +
    '<div class="section-title">Job outputs</div><div class="card"><div class="menu-list">' +
    '<button class="btn primary block" id="oReport"' + (total ? '' : ' disabled') + '>Combined job report (PDF)</button>' +
    '<button class="btn block" id="oLabels"' + (total ? '' : ' disabled') + '>Labels for all boards (PDF)</button>' +
    '<button class="btn block" id="oCsv"' + (total ? '' : ' disabled') + '>Schedule as CSV</button></div>' +
    '<p class="muted small" style="margin:10px 0 0">' + total + ' circuit(s) across ' + boards.length + ' board(s).</p></div>';
  $('#editJob').onclick = () => editJob(job);
  $('#jm').onclick = () => openSheet('<h3>Job options</h3><div class="menu-list"><button class="btn block" data-a="edit">Edit details</button>' +
    '<button class="btn block" data-a="dup">Duplicate job</button><button class="btn danger block" data-a="del">Delete job</button><button class="btn block" data-a="x">Cancel</button></div>',
  sheet => sheet.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') return closeSheet();
    await closeSheetAsync();
    if (a.dataset.a === 'edit') editJob(job);
    else if (a.dataset.a === 'dup') { const nj = await duplicateJob(job); go('#/job/' + encodeURIComponent(nj.id)); }
    else if (a.dataset.a === 'del') { if (await deleteJob(job)) location.replace('#/'); }
  }));
  $('#boardList').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) go('#/board/' + encodeURIComponent(it.dataset.id)); });
  $('#addBoard').onclick = () => editBoard(null, job, boards);
  $('#oReport').onclick = () => outputOptions('report', job, boards);
  $('#oLabels').onclick = () => outputOptions('labels', job, boards);
  $('#oCsv').onclick = () => fileReady(scheduleCSV(job, boards), safeName((job.ref || job.client) + '_schedule') + '.csv', 'CSV ready');
}

function editBoard(board, job, existing) {
  const isNew = !board;
  const n = (existing || []).length;
  board = board || { id: uid(), jobId: job.id, name: n ? 'DB' + (n + 1) : 'Main DB', location: '', supply: '', mainRating: '', markers: [], order: Date.now(), photo: null };
  openSheet('<h3>' + (isNew ? 'New Board' : 'Board details') + '</h3><form id="bf">' +
    '<label class="f"><span>Board name *</span><input class="in" name="name" required value="' + esc(board.name) + '" placeholder="e.g. DB2 Kitchen"></label>' +
    '<label class="f"><span>Location</span><input class="in" name="location" value="' + esc(board.location) + '" placeholder="e.g. Garage, left of door"></label>' +
    '<label class="f"><span>Supply source (fed from which board / breaker)</span><input class="in" name="supply" value="' + esc(board.supply) + '" placeholder="e.g. Main DB circuit 12, or Eskom meter"></label>' +
    '<label class="f"><span>Main switch rating (A)</span><input class="in" name="mainRating" inputmode="decimal" list="ratingList" value="' + esc(board.mainRating) + '"></label>' +
    '<datalist id="ratingList">' + RATINGS.map(r => '<option value="' + r + '">').join('') + '</datalist>' +
    '<div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>',
  sheet => {
    $('[data-x]', sheet).onclick = closeSheet;
    $('#bf', sheet).addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      ['name', 'location', 'supply', 'mainRating'].forEach(k => { board[k] = String(fd.get(k) || '').trim(); });
      await DB.put('boards', board); await touchJob(board.jobId);
      await closeSheetAsync();
      if (isNew) go('#/board/' + encodeURIComponent(board.id)); else render();
    });
  });
}

/* ---------- Board view ---------- */
async function viewBoard(id) {
  const board = await DB.get('boards', id);
  if (!board) { location.replace('#/'); return; }
  const job = await DB.get('jobs', board.jobId);
  board.markers = board.markers || [];
  setHeader(board.name || 'Board', '#/job/' + encodeURIComponent(board.jobId), '<button class="icon-btn" id="bm" aria-label="Board options">' + ICON_DOTS + '</button>');
  const main = $('#main');
  main.innerHTML =
    '<div class="muted small" style="margin:0 4px 8px">' + esc([job && job.client, board.location].filter(Boolean).join(' · ')) + '</div>' +
    '<div id="photoArea"></div>' +
    '<div class="section-title" id="circTitle"></div><div class="list" id="circList"></div>' +
    '<button class="btn block" id="addNoPhoto" style="margin-top:10px">+ Add circuit without tapping photo</button>' +
    '<div class="section-title">Board outputs</div><div class="card"><div class="menu-list" id="outs">' +
    '<button class="btn primary block" data-o="labels">Breaker labels (PDF)</button>' +
    '<button class="btn block" data-o="schedule">Circuit schedule (PDF)</button>' +
    '<button class="btn block" data-o="csv">Schedule as CSV</button>' +
    '<button class="btn block" data-o="photo">Marked-up photo (JPG)</button></div></div>' +
    '<input type="file" id="camIn" accept="image/*" capture="environment" hidden><input type="file" id="galIn" accept="image/*" hidden>';

  const save = async () => { board.updated = Date.now(); await DB.put('boards', board); touchJob(board.jobId); };

  const drawList = () => {
    const ms = sortedMarkers(board);
    $('#circTitle').textContent = 'Circuits (' + ms.length + ')';
    $('#circList').innerHTML = ms.length ? ms.map(m =>
      '<button class="item circ" data-id="' + esc(m.id) + '"><span class="num">' + esc(m.n) + '</span><div class="grow"><div class="t">' + esc(m.desc || '(no description)') +
      '</div><div class="s">' + esc(deviceLine(m) || 'Tap to fill in details') + '</div></div></button>').join('')
      : '<div class="empty">' + (board.photo ? 'Tap each breaker on the photo to add it.' : 'Take a photo of the board, then tap each breaker.') + '</div>';
    $$('[data-o]', main).forEach(b => { b.disabled = !ms.length && b.dataset.o !== 'photo'; });
    $('[data-o=photo]', main).disabled = !board.photo;
  };

  const onMarkerOpen = (m, isNew) => circuitForm(board, m, isNew, async () => { await save(); if (currentEditor) currentEditor.drawMarkers(); drawList(); });

  const drawPhoto = () => {
    if (currentEditor) { currentEditor.destroy(); currentEditor = null; }
    const pa = $('#photoArea');
    if (!board.photo) {
      pa.innerHTML = '<div class="no-photo"><p style="margin-top:0"><b>Photograph the board</b><br><span class="muted small">Open the cover, stand square-on, get all rows in.</span></p>' +
        '<div class="btn-grid"><button class="btn accent" id="takeP">📷 Take photo</button><button class="btn" id="pickP">🖼 Gallery</button></div></div>';
      $('#takeP').onclick = () => $('#camIn').click();
      $('#pickP').onclick = () => $('#galIn').click();
      return;
    }
    pa.innerHTML = '<div class="stage" id="stage"><div class="layer" id="layer"><img id="pimg" alt="Board photo"></div>' +
      '<div class="hint" id="hint">Tap a breaker to add a marker. Pinch to zoom, drag to pan.</div>' +
      '<div class="zoom-btns"><button id="zin" aria-label="Zoom in">+</button><button id="zout" aria-label="Zoom out">−</button><button id="zfit" aria-label="Fit" style="font-size:15px">Fit</button></div></div>' +
      '<div class="stage-tools"><button class="btn on" id="tapMode">Tap adds: ON</button><button class="btn" id="showMk">Markers: shown</button><button class="btn" id="replP">Replace photo</button></div>';
    currentEditor = new BoardEditor($('#stage'), board, {
      onAdd: (x, y) => { const m = newMarker(board, x, y); board.markers.push(m); currentEditor.drawMarkers(m.id); onMarkerOpen(m, true); },
      onOpen: m => onMarkerOpen(m, false),
      onMoved: async () => { await save(); }
    });
    $('#tapMode').onclick = e => {
      currentEditor.tapAdd = !currentEditor.tapAdd;
      e.target.classList.toggle('on', currentEditor.tapAdd);
      e.target.textContent = 'Tap adds: ' + (currentEditor.tapAdd ? 'ON' : 'OFF');
    };
    $('#showMk').onclick = e => {
      const st = $('#stage'); st.classList.toggle('hide-mk');
      e.target.textContent = 'Markers: ' + (st.classList.contains('hide-mk') ? 'hidden' : 'shown');
    };
    $('#replP').onclick = () => openSheet('<h3>Replace photo</h3><p class="muted">Markers keep their position on the new photo — use a photo taken from the same angle, or drag them into place.</p><div class="menu-list">' +
      '<button class="btn accent block" data-a="cam">📷 Take new photo</button><button class="btn block" data-a="gal">🖼 Choose from gallery</button>' +
      '<button class="btn danger block" data-a="rm">Remove photo</button><button class="btn block" data-a="x">Cancel</button></div>',
    sheet => sheet.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'cam') $('#camIn').click();
      if (a.dataset.a === 'gal') $('#galIn').click();
      if (a.dataset.a === 'rm') {
        closeSheet();
        if (await confirmDlg('Remove photo?', 'The photo will be removed. Your circuits are kept.', 'Remove')) {
          board.photo = null; board.thumb = null; await save(); drawPhoto(); drawList();
        }
        return;
      }
      closeSheet();
    }));
  };

  const onFile = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    const done = busy('Compressing photo…');
    try {
      const r = await compressImage(f);
      board.photo = r.data; board.photoW = r.w; board.photoH = r.h; board.thumb = await makeThumb(r.data);
      await save(); drawPhoto(); drawList();
    } catch (err) { alertDlg('Photo error', err.message); } finally { done(); }
  };
  $('#camIn').onchange = onFile; $('#galIn').onchange = onFile;

  $('#circList').addEventListener('click', e => {
    const it = e.target.closest('[data-id]'); if (!it) return;
    const m = board.markers.find(x => x.id === it.dataset.id);
    if (m) { if (currentEditor) currentEditor.drawMarkers(m.id); onMarkerOpen(m, false); }
  });
  $('#addNoPhoto').onclick = () => { const m = newMarker(board, null, null); board.markers.push(m); onMarkerOpen(m, true); };
  $('#outs').addEventListener('click', async e => {
    const o = e.target.closest('[data-o]'); if (!o) return;
    if (o.dataset.o === 'labels') outputOptions('labels', job, [board]);
    else if (o.dataset.o === 'schedule') outputOptions('schedule', job, [board]);
    else if (o.dataset.o === 'csv') fileReady(scheduleCSV(job, [board]), safeName((job.ref || job.client) + '_' + board.name) + '.csv', 'CSV ready');
    else if (o.dataset.o === 'photo') {
      const done = busy('Preparing photo…');
      try {
        const d = await markedPhoto(board, 2400);
        const blob = await (await fetch(d)).blob();
        fileReady(blob, safeName((job.ref || job.client) + '_' + board.name) + '_marked.jpg', 'Photo ready');
      } finally { done(); }
    }
  });

  $('#bm').onclick = () => openSheet('<h3>' + esc(board.name) + '</h3><div class="menu-list">' +
    '<button class="btn block" data-a="edit">Edit board details</button>' +
    '<button class="btn block" data-a="seq"' + (board.markers.length ? '' : ' disabled') + '>Renumber 1, 2, 3… by position</button>' +
    '<button class="btn danger block" data-a="clr"' + (board.markers.length ? '' : ' disabled') + '>Delete all circuits</button>' +
    '<button class="btn danger block" data-a="del">Delete board</button><button class="btn block" data-a="x">Cancel</button></div>',
  sheet => sheet.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a;
    await closeSheetAsync();
    if (act === 'edit') editBoard(board, job);
    else if (act === 'seq') {
      if (!await confirmDlg('Renumber circuits?', 'Circuits will be numbered 1, 2, 3… row by row, top to bottom, left to right.', 'Renumber', false)) return;
      let i = 1; rowsOf(board).forEach(r => r.items.forEach(m => { m.n = String(i++); }));
      await save(); if (currentEditor) currentEditor.drawMarkers(); drawList(); toast('Renumbered');
    } else if (act === 'clr') {
      if (!await confirmDlg('Delete all circuits?', 'All ' + board.markers.length + ' circuits on this board will be deleted. The photo is kept.')) return;
      board.markers = []; await save(); if (currentEditor) currentEditor.drawMarkers(); drawList();
    } else if (act === 'del') {
      if (!await confirmDlg('Delete board?', '“' + board.name + '” with its photo and ' + board.markers.length + ' circuit(s) will be permanently deleted.')) return;
      await DB.del('boards', board.id); await touchJob(board.jobId); location.replace('#/job/' + encodeURIComponent(board.jobId));
    }
  }));

  drawPhoto(); drawList();
}

function newMarker(board, x, y) {
  const last = sortedMarkers(board).slice(-1)[0];
  return {
    id: uid(), n: nextNumber(board), x, y, desc: '', type: last ? last.type : 'MCB', rating: '', poles: '1P',
    curve: last && last.curve ? last.curve : 'C', ma: '', cable: '', points: '', notes: '', modules: '', row: ''
  };
}

/* ---------- Circuit form ---------- */
function circuitForm(board, m, isNew, onSaved) {
  const sel = (name, opts, val, blank) => '<select class="in" name="' + name + '">' + (blank ? '<option value="">' + blank + '</option>' : '') +
    opts.map(o => '<option' + (String(o) === String(val) ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  let saved = false;
  const entry = openSheet('<form id="cf" autocomplete="off">' +
    '<div class="row2"><label class="f"><span>Circuit no.</span><input class="in" name="n" value="' + esc(m.n) + '" inputmode="text"></label>' +
    '<label class="f"><span>Device type</span>' + sel('type', DEVICE_TYPES, m.type) + '</label></div>' +
    '<label class="f"><span>Description / what it feeds</span><input class="in" name="desc" value="' + esc(m.desc) + '" placeholder="e.g. Kitchen plugs"></label>' +
    '<div class="chips scroll" id="picks"></div>' +
    '<div class="row2"><label class="f"><span>Rating (A)</span><input class="in" name="rating" inputmode="decimal" list="rl" value="' + esc(m.rating) + '"></label>' +
    '<label class="f"><span>Poles</span>' + sel('poles', POLES, m.poles) + '</label></div>' +
    '<datalist id="rl">' + RATINGS.map(r => '<option value="' + r + '">').join('') + '</datalist>' +
    '<div class="row2"><label class="f" id="curveF"><span>Trip curve</span>' + sel('curve', CURVES, m.curve, '—') + '</label>' +
    '<label class="f" id="maF"><span>RCD sensitivity (mA)</span><input class="in" name="ma" inputmode="numeric" list="mal" value="' + esc(m.ma) + '"></label></div>' +
    '<datalist id="mal">' + MAS.map(r => '<option value="' + r + '">').join('') + '</datalist>' +
    '<div class="row2"><label class="f"><span>Cable size (mm²)</span><input class="in" name="cable" inputmode="decimal" list="cl" value="' + esc(m.cable) + '"></label>' +
    '<label class="f"><span>No. of points</span><input class="in" name="points" inputmode="numeric" value="' + esc(m.points) + '"></label></div>' +
    '<datalist id="cl">' + CABLES.map(r => '<option value="' + r + '">').join('') + '</datalist>' +
    '<label class="f"><span>Notes</span><textarea class="in" name="notes" rows="2">' + esc(m.notes) + '</textarea></label>' +
    '<div class="row2"><label class="f"><span>Label width (modules)</span><input class="in" name="modules" inputmode="decimal" placeholder="Auto = poles" value="' + esc(m.modules) + '"></label>' +
    '<label class="f"><span>DIN rail row</span>' + sel('row', [1, 2, 3, 4, 5, 6], m.row, 'Auto') + '</label></div>' +
    '<div class="actions">' + (isNew ? '' : '<button type="button" class="btn danger" data-del>Delete</button>') +
    '<button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Save</button></div></form>',
  (sheet, ent) => {
    const f = $('#cf', sheet);
    // "View photo": tuck the form down and zoom the photo onto this breaker
    const peekBtn = $('[data-peek]', sheet);
    if (peekBtn) {
      peekBtn.onclick = () => {
        if (ent.mover.isTucked()) { ent.mover.open(); return; }
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        ent.mover.tuck();
        const st = $('#stage');
        if (st) {
          const hdr = $('header.app').offsetHeight;
          window.scrollTo({ top: st.getBoundingClientRect().top + window.scrollY - hdr - 6, behavior: 'smooth' });
          if (currentEditor && m.x != null) setTimeout(() => currentEditor.focusOn(m), 250);
        }
      };
      sheet.addEventListener('sheetmove', e => {
        peekBtn.textContent = e.detail.tucked ? '📝 Back to form' : '👁 View photo';
        peekBtn.classList.toggle('accent', e.detail.tucked);
      });
    }
    const picksEl = $('#picks', sheet);
    const drawPicks = () => {
      picksEl.innerHTML = '<button type="button" class="chip" data-addp>＋ Save typed</button>' +
        SETTINGS.picks.map(p => '<button type="button" class="chip" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('');
    };
    drawPicks();
    picksEl.addEventListener('click', async e => {
      const p = e.target.closest('[data-p]');
      if (p) {
        const cur = f.desc.value.trim();
        // Tapping a second pick appends (e.g. "Lights – bedrooms"); tapping same replaces
        f.desc.value = cur && !SETTINGS.picks.includes(cur) && !cur.endsWith(p.dataset.p) ? cur + ' – ' + p.dataset.p : p.dataset.p;
        return;
      }
      if (e.target.closest('[data-addp]')) {
        const v = f.desc.value.trim();
        if (!v) return toast('Type a description first');
        if (SETTINGS.picks.some(x => x.toLowerCase() === v.toLowerCase())) return toast('Already in quick-picks');
        SETTINGS.picks.push(v); await saveSettings(); drawPicks(); toast('Added “' + v + '”');
      }
    });
    const syncType = () => {
      const t = f.type.value;
      $('#curveF', sheet).style.display = hasCurve(t) ? '' : 'none';
      $('#maF', sheet).style.display = hasMA(t) ? '' : 'none';
    };
    f.type.addEventListener('change', () => {
      const t = f.type.value;
      if (/RCD/.test(t) && !f.ma.value) f.ma.value = '30';
      if (/RCD|Main|Isolator|Surge/.test(t) && f.poles.value === '1P') f.poles.value = '2P';
      if (hasCurve(t) && !f.curve.value) f.curve.value = 'C';
      syncType();
    });
    syncType();
    $('[data-x]', sheet).onclick = closeSheet;
    const del = $('[data-del]', sheet);
    if (del) del.onclick = async () => {
      if (!await confirmDlg('Delete circuit ' + m.n + '?', m.desc || '')) return;
      board.markers = board.markers.filter(x => x.id !== m.id);
      saved = true; closeSheet(); onSaved();
    };
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const newN = f.n.value.trim() || nextNumber(board);
      const clash = board.markers.find(x => x.id !== m.id && String(x.n).toLowerCase() === newN.toLowerCase());
      if (clash) {
        const r = await modal('Circuit ' + newN + ' already exists', 'Swap numbers with “' + (clash.desc || 'circuit ' + newN) + '”, or keep both as ' + newN + '?',
          [{ label: 'Back', value: 'back' }, { label: 'Keep both', value: 'keep' }, { label: 'Swap', value: 'swap', cls: 'primary' }]);
        if (r === 'back') return;
        if (r === 'swap') clash.n = m.n;
      }
      m.n = newN;
      ['desc', 'type', 'rating', 'poles', 'curve', 'ma', 'cable', 'points', 'notes', 'modules', 'row'].forEach(k => { m[k] = String(f[k].value || '').trim(); });
      if (!hasCurve(m.type)) m.curve = '';
      if (!hasMA(m.type)) m.ma = '';
      saved = true; closeSheet(); onSaved();
    });
    ent.onClose = () => {
      // A brand-new marker that was cancelled is removed
      if (isNew && !saved) { board.markers = board.markers.filter(x => x.id !== m.id); onSaved(); }
    };
    if (isNew) setTimeout(() => f.desc.focus({ preventScroll: true }), 300);
  }, {
    keepOpen: true,
    bar: '<div class="bar-row"><h3>' + (isNew ? 'New circuit' : 'Circuit ' + esc(m.n)) + '</h3>' +
      (board.photo ? '<button type="button" class="btn small-btn" data-peek>👁 View photo</button>' : '') + '</div>' +
      (board.photo ? '<div class="muted small bar-tip">Drag this bar or tap “View photo” to see the board behind</div>' : '')
  });
  return entry;
}

/* ---------- Photo editor (zoom / pan / markers) ---------- */
class BoardEditor {
  constructor(stage, board, cb) {
    this.stage = stage; this.board = board; this.cb = cb; this.tapAdd = true;
    this.layer = $('#layer', stage); this.img = $('#pimg', stage);
    this.s = 1; this.tx = 0; this.ty = 0; this.fitS = 1;
    this.ptrs = new Map(); this.g = null; this.selId = null;
    this.img.onload = () => {
      this.W = this.img.naturalWidth; this.H = this.img.naturalHeight;
      this.layer.style.width = this.W + 'px'; this.layer.style.height = this.H + 'px';
      this.fit(); this.drawMarkers();
    };
    this.img.src = board.photo;
    this.h = {
      down: e => this.down(e), move: e => this.move(e), up: e => this.up(e),
      wheel: e => this.wheel(e), resize: () => this.fit()
    };
    stage.addEventListener('pointerdown', this.h.down);
    stage.addEventListener('pointermove', this.h.move);
    stage.addEventListener('pointerup', this.h.up);
    stage.addEventListener('pointercancel', this.h.up);
    stage.addEventListener('wheel', this.h.wheel, { passive: false });
    window.addEventListener('resize', this.h.resize);
    $('#zin', stage).onclick = () => this.zoomBy(1.5);
    $('#zout', stage).onclick = () => this.zoomBy(1 / 1.5);
    $('#zfit', stage).onclick = () => this.fit();
    ['pointerdown', 'pointerup'].forEach(t => $$('.zoom-btns button', stage).forEach(b => b.addEventListener(t, e => e.stopPropagation())));
  }
  destroy() { window.removeEventListener('resize', this.h.resize); }
  fit() {
    if (!this.W) return;
    const r = this.stage.getBoundingClientRect();
    this.fitS = Math.min(r.width / this.W, r.height / this.H);
    this.s = this.fitS; this.tx = (r.width - this.W * this.s) / 2; this.ty = (r.height - this.H * this.s) / 2;
    this.apply();
  }
  apply() {
    this.layer.style.transform = 'translate(' + this.tx + 'px,' + this.ty + 'px) scale(' + this.s + ')';
    this.layer.style.setProperty('--inv', 1 / this.s);
  }
  clampS(s) { return Math.max(this.fitS * 0.7, Math.min(Math.max(this.fitS * 10, 3), s)); }
  zoomAt(px, py, ns) {
    ns = this.clampS(ns);
    const ix = (px - this.tx) / this.s, iy = (py - this.ty) / this.s;
    this.s = ns; this.tx = px - ix * ns; this.ty = py - iy * ns; this.apply();
  }
  // Zoom in on a marker and centre it in the photo window
  focusOn(m) {
    if (!this.W || m.x == null) return;
    const r = this.stage.getBoundingClientRect();
    const ns = this.clampS(Math.max(this.s, this.fitS * 2.5));
    this.layer.style.transition = 'transform .25s ease';
    this.s = ns; this.tx = r.width / 2 - m.x * this.W * ns; this.ty = r.height / 2 - m.y * this.H * ns;
    this.apply();
    setTimeout(() => { this.layer.style.transition = ''; }, 300);
  }
  zoomBy(f) { const r = this.stage.getBoundingClientRect(); this.zoomAt(r.width / 2, r.height / 2, this.s * f); }
  wheel(e) { e.preventDefault(); const p = this.local(e); this.zoomAt(p.x, p.y, this.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }
  local(e) { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  toImg(p) { return { x: (p.x - this.tx) / this.s / this.W, y: (p.y - this.ty) / this.s / this.H }; }
  drawMarkers(selId) {
    if (selId !== undefined) this.selId = selId;
    $$('.mk', this.layer).forEach(el => el.remove());
    if (!this.W) return;
    (this.board.markers || []).filter(m => m.x != null).forEach(m => {
      const el = document.createElement('button');
      el.className = 'mk' + (String(m.n).length > 2 ? ' long' : '') + (m.id === this.selId ? ' sel' : '');
      el.dataset.id = m.id; el.textContent = m.n; el.type = 'button';
      el.style.left = (m.x * this.W) + 'px'; el.style.top = (m.y * this.H) + 'px';
      this.layer.appendChild(el);
    });
  }
  down(e) {
    const p = this.local(e);
    this.stage.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1) {
      const mk = e.target.closest('.mk');
      this.g = { start: p, t0: Date.now(), tx: this.tx, ty: this.ty, moved: false, multi: false, mk: mk ? mk.dataset.id : null, mkEl: mk };
      const hint = $('#hint', this.stage); if (hint) hint.remove();
    } else if (this.ptrs.size === 2 && this.g) {
      const [a, b] = [...this.ptrs.values()];
      this.g.multi = true; this.g.moved = true;
      this.g.d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; this.g.s0 = this.s;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.g.ip = { x: (mid.x - this.tx) / this.s, y: (mid.y - this.ty) / this.s };
    }
  }
  move(e) {
    if (!this.ptrs.has(e.pointerId) || !this.g) return;
    const p = this.local(e); this.ptrs.set(e.pointerId, p);
    const g = this.g;
    if (this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.s = this.clampS(g.s0 * d / g.d0);
      this.tx = mid.x - g.ip.x * this.s; this.ty = mid.y - g.ip.y * this.s; this.apply();
      return;
    }
    if (g.multi) return;
    const dx = p.x - g.start.x, dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
    if (!g.moved) return;
    if (g.mk) {
      const m = this.board.markers.find(x => x.id === g.mk);
      const ip = this.toImg(p);
      m.x = Math.min(1, Math.max(0, ip.x)); m.y = Math.min(1, Math.max(0, ip.y));
      g.mkEl.style.left = (m.x * this.W) + 'px'; g.mkEl.style.top = (m.y * this.H) + 'px';
      g.dragged = true;
    } else {
      this.tx = g.tx + dx; this.ty = g.ty + dy; this.apply();
    }
  }
  up(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    const g = this.g;
    if (!g) return;
    if (this.ptrs.size > 0) {
      // finger lifted during pinch: re-base remaining finger for panning
      const p = [...this.ptrs.values()][0];
      g.start = p; g.tx = this.tx; g.ty = this.ty; g.mk = null; g.multi = false;
      return;
    }
    this.g = null;
    if (e.type === 'pointercancel') return;
    if (g.dragged) { this.cb.onMoved(); return; }
    if (g.moved || g.multi || Date.now() - g.t0 > 700) return;
    if (sheetStack.length) return; // a form is open over the photo: only pan/zoom
    if (g.mk) {
      const m = this.board.markers.find(x => x.id === g.mk);
      if (m) { this.drawMarkers(m.id); this.cb.onOpen(m); }
      return;
    }
    if (!this.tapAdd) return;
    const ip = this.toImg(g.start);
    if (ip.x < 0 || ip.x > 1 || ip.y < 0 || ip.y > 1) return;
    this.cb.onAdd(ip.x, ip.y);
  }
}

/* ---------- Output options ---------- */
function outputOptions(kind, job, boards) {
  const S = SETTINGS;
  let html;
  if (kind === 'labels') {
    html = '<h3>Breaker labels</h3><form id="of">' +
      '<label class="f"><span>Layout</span><div class="seg" id="segMode"><button type="button" data-v="individual">Individual labels</button><button type="button" data-v="strip">Strip per DIN row</button></div></label>' +
      '<div class="row2"><label class="f"><span>Module width (mm)</span><input class="in" name="moduleMM" inputmode="decimal" value="' + esc(S.moduleMM) + '"></label>' +
      '<label class="f"><span>Label height (mm)</span><input class="in" name="labelH" inputmode="decimal" value="' + esc(S.labelH) + '"></label></div>' +
      '<label class="switch"><span>Show rating on label</span><input type="checkbox" name="labelRating"' + (S.labelRating ? ' checked' : '') + '></label>' +
      '<p class="muted small">Multi-pole devices get wider labels (width = modules × module width). Print at 100% / “Actual size”, not “Fit to page”.</p>' +
      '<div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Create PDF</button></div></form>';
  } else {
    html = '<h3>' + (kind === 'report' ? 'Combined job report' : 'Circuit schedule') + '</h3><form id="of">' +
      '<label class="switch"><span>Include marked-up board photo</span><input type="checkbox" name="includePhoto"' + (S.includePhoto ? ' checked' : '') + '></label>' +
      '<p class="muted small">A4 landscape, per SANS 10142-1 schedule details, with signature block — ready to attach to the COC.</p>' +
      '<div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Create PDF</button></div></form>';
  }
  openSheet(html, sheet => {
    $('[data-x]', sheet).onclick = closeSheet;
    let mode = S.labelMode;
    const seg = $('#segMode', sheet);
    const drawSeg = () => seg && $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === mode));
    if (seg) { drawSeg(); seg.onclick = e => { const b = e.target.closest('button'); if (b) { mode = b.dataset.v; drawSeg(); } }; }
    $('#of', sheet).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (kind === 'labels') {
        S.moduleMM = Math.min(40, Math.max(8, parseFloat(f.moduleMM.value) || 18));
        S.labelH = Math.min(40, Math.max(6, parseFloat(f.labelH.value) || 12));
        S.labelRating = f.labelRating.checked; S.labelMode = mode;
      } else S.includePhoto = f.includePhoto.checked;
      await saveSettings();
      await closeSheetAsync();
      const done = busy('Creating PDF…');
      try {
        const full = [];
        for (const b of boards) full.push(await DB.get('boards', b.id) || b);
        let blob, name;
        const base = safeName(job.ref || job.client);
        if (kind === 'labels') { blob = labelsPDF(job, full, S); name = base + (full.length === 1 ? '_' + safeName(full[0].name) : '') + '_labels.pdf'; }
        else if (kind === 'schedule') { blob = await schedulePDF(job, full, S.includePhoto, false); name = base + '_' + safeName(full[0].name) + '_schedule.pdf'; }
        else { blob = await schedulePDF(job, full, S.includePhoto, true); name = base + '_DB_report.pdf'; }
        done();
        fileReady(blob, name, 'PDF ready');
      } catch (err) { done(); console.error(err); alertDlg('Could not create PDF', err.message); }
    });
  });
}

/* ---------- PDF: labels ---------- */
function labelsPDF(job, boards, opt) {
  const doc = new MiniPDF.Doc().addPage('p');
  const M = 10, PW = 210, PH = 297, gap = 2.5, mw = opt.moduleMM, lh = opt.labelH;
  let y = M;
  const footer = () => {
    doc.font(false, 7).text('DB Board Labeller · ' + (job.client || '') + (job.ref ? ' · Ref ' + job.ref : '') + ' · print at 100% scale', PW / 2, PH - 5, { align: 'center', color: '#666666' });
  };
  footer();
  const newPage = () => { doc.addPage('p'); footer(); y = M; };
  const ensure = h => { if (y + h > PH - 10) newPage(); };
  const drawLabel = (m, x, yy, w) => {
    doc.lineWidth(0.25).stroke('#777777').rect(x, yy, w, lh);
    const pad = 0.8, innerW = w - pad * 2;
    const num = String(m.n), rating = opt.labelRating && m.rating ? m.rating + 'A' + (m.poles && m.poles !== '1P' ? ' ' + m.poles : '') : '';
    let ns = Math.min(10, Math.max(5, lh * 0.75));
    const head = () => MiniPDF.textWidth(num, ns, true) + (rating ? 1.2 + MiniPDF.textWidth(rating, ns * 0.75, false) : 0);
    while (head() > innerW && ns > 4.5) ns -= 0.5;
    const headH = ns * 0.3528;
    const hx = x + w / 2 - head() / 2, hy = yy + pad + headH * 0.85;
    doc.font(true, ns).text(num, hx, hy, { color: '#000000' });
    if (rating) doc.font(false, ns * 0.75).text(rating, hx + MiniPDF.textWidth(num, ns, true) + 1.2, hy);
    const desc = (m.desc || '').trim();
    if (!desc) return;
    const top = yy + pad + headH + 0.6, availH = yy + lh - pad - top;
    let ds = Math.min(8, ns), lines;
    for (; ds >= 4.5; ds -= 0.25) {
      const lineH = ds * 0.3528 * 1.12;
      const maxLines = Math.max(1, Math.floor(availH / lineH));
      lines = doc.wrap(desc, innerW, ds, false);
      if (lines.length <= maxLines && lines.every(l => MiniPDF.textWidth(l, ds, false) <= innerW)) break;
    }
    if (ds < 4.5) {
      ds = 4.5;
      const maxLines = Math.max(1, Math.floor(availH / (ds * 0.3528 * 1.12)));
      lines = doc.wrap(desc, innerW, ds, false).slice(0, maxLines);
    }
    const lineH = ds * 0.3528 * 1.12, blockH = lines.length * lineH;
    let ly = top + (availH - blockH) / 2 + ds * 0.3528 * 0.85;
    doc.font(false, ds);
    lines.forEach(l => { doc.text(l, x + w / 2, ly, { align: 'center' }); ly += lineH; });
  };
  boards.forEach((b, bi) => {
    const ms = b.markers || [];
    if (!ms.length) return;
    ensure(8 + lh);
    if (bi > 0) y += 3;
    doc.font(true, 10).text(b.name + (b.location ? ' – ' + b.location : ''), M, y + 4, { color: '#000000' });
    doc.font(false, 7).text(opt.labelMode === 'strip' ? 'Strip per DIN rail row · cut along outer edge' : 'Cut along the grey lines', PW - M, y + 4, { align: 'right', color: '#666666' });
    y += 7;
    if (opt.labelMode === 'strip') {
      rowsOf(b).forEach(r => {
        ensure(lh + 6);
        doc.font(true, 7).text('Row ' + r.row, M, y + 2.5, { color: '#333333' });
        y += 4;
        let x = M;
        r.items.forEach(m => {
          const w = modulesOf(m) * mw;
          if (x + w > PW - M + 0.01) { x = M; y += lh + 3; ensure(lh); }
          drawLabel(m, x, y, w); x += w;
        });
        y += lh + 4;
      });
    } else {
      let x = M;
      ensure(lh);
      sortedMarkers(b).forEach(m => {
        const w = modulesOf(m) * mw;
        if (x + w > PW - M + 0.01) { x = M; y += lh + gap; ensure(lh); }
        drawLabel(m, x, y, w); x += w + gap;
      });
      y += lh + gap;
    }
  });
  return doc.output();
}

/* ---------- PDF: schedule & report ---------- */
const COLS = [
  { k: 'n', t: 'Cct', w: 11, a: 'center' }, { k: 'desc', t: 'Description', w: 52 }, { k: 'type', t: 'Device', w: 22 },
  { k: 'rating', t: 'Rating (A)', w: 15, a: 'center' }, { k: 'poles', t: 'Poles', w: 11, a: 'center' }, { k: 'curve', t: 'Curve', w: 11, a: 'center' },
  { k: 'ma', t: 'RCD mA', w: 13, a: 'center' }, { k: 'cable', t: 'Cable mm²', w: 15, a: 'center' }, { k: 'points', t: 'Pts', w: 9, a: 'center' }, { k: 'notes', t: 'Notes', w: 31 }
];
function cellVal(m, k) { return k === 'type' ? (DEVICE_SHORT[m.type] || m.type || '') : (m[k] == null ? '' : String(m[k])); }

async function schedulePDF(job, boards, includePhoto, combined) {
  const doc = new MiniPDF.Doc();
  const M = 10, PW = 297, PH = 210, BOT = PH - 12;
  const title = (t, sub) => {
    doc.fill('#ffb300').rect(M, M, PW - 2 * M, 1.6, 'F');
    doc.font(true, 15).text(t, M, M + 9, { color: '#000000' });
    doc.font(false, 8).text(sub || 'SANS 10142-1 · Distribution board circuit schedule', PW - M, M + 9, { align: 'right', color: '#444444' });
    return M + 13;
  };
  const kvBlock = (pairs, x, y, w, cols) => {
    const cw = w / cols, rowH = 5.2;
    const rows = Math.ceil(pairs.length / cols);
    doc.lineWidth(0.2).stroke('#999999').fill('#f2f3f5').rect(x, y, w, rows * rowH + 2, 'FD');
    pairs.forEach((p, i) => {
      const c = i % cols, r = Math.floor(i / cols), cx = x + 2 + c * cw, cy = y + 4.6 + r * rowH;
      doc.font(true, 7.5).text(p[0] + ':', cx, cy, { color: '#555555' });
      const lw = MiniPDF.textWidth(p[0] + ':', 7.5, true) + 1.5;
      let v = String(p[1] || '—');
      const max = cw - lw - 4;
      while (MiniPDF.textWidth(v, 8.5, false) > max && v.length > 3) v = v.slice(0, -2) + '…';
      doc.font(false, 8.5).text(v, cx + lw, cy, { color: '#000000' });
    });
    return y + rows * rowH + 2;
  };
  const jobPairs = [['Client', job.client], ['COC ref', job.ref], ['Date', fmtDate(job.date)], ['Site address', (job.address || '').replace(/\s*\n\s*/g, ', ')],
    ['Electrician', job.elecName], ['Reg. no.', job.elecReg]];

  const drawTable = (rows, x, y, w, header, wNext) => {
    let cols;
    const setW = ww => { w = ww; const sc = ww / COLS.reduce((s, c) => s + c.w, 0); cols = COLS.map(c => Object.assign({}, c, { w: c.w * sc })); };
    setW(w);
    const fs = 8, lineH = fs * 0.3528 * 1.2, padY = 1.4, padX = 1.2;
    const drawHead = () => {
      const hh = 7;
      doc.fill('#1d2430').rect(x, y, w, hh, 'F');
      let cx = x;
      cols.forEach(c => {
        doc.font(true, 7.5);
        const tx = c.a === 'center' ? cx + c.w / 2 : cx + padX;
        doc.text(c.t, tx, y + 4.7, { align: c.a === 'center' ? 'center' : 'left', color: '#ffffff' });
        cx += c.w;
      });
      y += hh;
    };
    drawHead();
    rows.forEach((m, i) => {
      let cells = cols.map(c => doc.wrap(cellVal(m, c.k), c.w - padX * 2, fs, c.k === 'n'));
      let h = Math.max(...cells.map(l => l.length)) * lineH + padY * 2;
      if (y + h > BOT) {
        doc.addPage('l'); y = header();
        if (wNext && wNext !== w) setW(wNext);
        drawHead();
        cells = cols.map(c => doc.wrap(cellVal(m, c.k), c.w - padX * 2, fs, c.k === 'n'));
        h = Math.max(...cells.map(l => l.length)) * lineH + padY * 2;
      }
      if (i % 2) doc.fill('#f4f5f7').rect(x, y, w, h, 'F');
      doc.lineWidth(0.15).stroke('#b0b5bd');
      let cx = x;
      cols.forEach((c, ci) => {
        doc.rect(cx, y, c.w, h);
        doc.font(c.k === 'n', fs);
        let ty = y + padY + fs * 0.3528 * 0.9;
        cells[ci].forEach(l => {
          doc.text(l, c.a === 'center' ? cx + c.w / 2 : cx + padX, ty, { align: c.a === 'center' ? 'center' : 'left', color: '#000000' });
          ty += lineH;
        });
        cx += c.w;
      });
      y += h;
    });
    return { y, w };
  };

  if (combined) {
    doc.addPage('l');
    let y = title('DISTRIBUTION BOARD SCHEDULES', 'Job report · SANS 10142-1');
    y = kvBlock(jobPairs, M, y + 2, PW - 2 * M, 3) + 8;
    doc.font(true, 11).text('Boards on this installation', M, y, { color: '#000000' }); y += 3;
    const bc = [['Board', 70], ['Location', 70], ['Supply from', 80], ['Main switch', 30], ['Circuits', 27]];
    const tw = PW - 2 * M;
    doc.fill('#1d2430').rect(M, y, tw, 7, 'F');
    let cx = M;
    bc.forEach(c => { doc.font(true, 8).text(c[0], cx + 1.5, y + 4.7, { color: '#ffffff' }); cx += c[1]; });
    y += 7;
    boards.forEach((b, i) => {
      if (y + 7 > BOT) { doc.addPage('l'); y = title('DISTRIBUTION BOARD SCHEDULES', 'Job report (cont.)'); }
      if (i % 2) doc.fill('#f4f5f7').rect(M, y, tw, 6.5, 'F');
      const vals = [b.name, b.location, b.supply, b.mainRating ? b.mainRating + ' A' : '', String((b.markers || []).length)];
      cx = M;
      bc.forEach((c, ci) => {
        let v = vals[ci] || '—';
        while (MiniPDF.textWidth(v, 8.5, ci === 0) > c[1] - 3 && v.length > 3) v = v.slice(0, -2) + '…';
        doc.font(ci === 0, 8.5).text(v, cx + 1.5, y + 4.4, { color: '#000000' }); cx += c[1];
      });
      doc.lineWidth(0.15).stroke('#b0b5bd').line(M, y + 6.5, M + tw, y + 6.5);
      y += 6.5;
    });
    y += 6;
    doc.font(false, 8.5).text('Total circuits: ' + boards.reduce((s, b) => s + (b.markers || []).length, 0) + '   ·   Board schedules follow on the next pages.', M, y, { color: '#333333' });
    signBlock(doc, job, M, Math.max(y + 12, BOT - 22), PW - 2 * M);
  }

  for (const b of boards) {
    doc.addPage('l');
    const boardPairs = jobPairs.concat([['Board', b.name], ['Location', b.location], ['Supply from', b.supply], ['Main switch', b.mainRating ? b.mainRating + ' A' : '']]);
    const header = () => {
      const yy = title('CIRCUIT SCHEDULE – ' + (b.name || 'Board').toUpperCase());
      return kvBlock(boardPairs, M, yy + 1, PW - 2 * M, 4) + 4;
    };
    let y = header();
    const rows = sortedMarkers(b);
    let photo = null;
    if (includePhoto && b.photo) photo = await markedPhoto(b, 1600);
    let tableW = PW - 2 * M, photoBottom = 0;
    const firstPageOf = doc.pageIndex;
    if (photo) {
      // Photo in a right-hand column beside the table
      const info = doc.imageSize(photo);
      const pw = 92, maxH = BOT - y - 4;
      let w = pw, h = pw * info.h / info.w;
      if (h > maxH) { h = maxH; w = h * info.w / info.h; }
      const px = PW - M - pw + (pw - w) / 2;
      doc.image(photo, px, y, w, h);
      doc.lineWidth(0.3).stroke('#000000').rect(px, y, w, h);
      doc.font(false, 7).text('Marked-up board photo – numbers match circuit numbers', PW - M - pw / 2, Math.min(y + h + 4, BOT), { align: 'center', color: '#444444' });
      tableW = PW - 2 * M - pw - 5;
      photoBottom = y + h + 6;
    }
    const res = drawTable(rows, M, y, tableW, () => header(), PW - 2 * M);
    let endY = res.y;
    if (photo && doc.pageIndex === firstPageOf) endY = Math.max(endY, photoBottom);
    if (endY + 24 > BOT) { doc.addPage('l'); endY = header(); }
    signBlock(doc, job, M, endY + 6, res.w);
  }

  // footers
  const total = doc.pages.length;
  for (let i = 0; i < total; i++) {
    doc.setPage(i);
    doc.lineWidth(0.2).stroke('#bbbbbb').line(M, PH - 9, PW - M, PH - 9);
    doc.font(false, 7).text([job.client, job.ref && 'Ref ' + job.ref].filter(Boolean).join(' · '), M, PH - 5.5, { color: '#555555' });
    doc.text('Generated ' + fmtDate(today()) + ' with DB Board Labeller v' + VERSION, PW / 2, PH - 5.5, { align: 'center' });
    doc.text('Page ' + (i + 1) + ' of ' + total, PW - M, PH - 5.5, { align: 'right' });
  }
  return doc.output();
}
function signBlock(doc, job, x, y, w) {
  doc.font(true, 8.5).text('Registered person', x, y, { color: '#000000' });
  y += 6;
  const third = w / 3;
  doc.font(false, 8.5).text('Name: ' + (job.elecName || ''), x, y);
  doc.text('Reg. no.: ' + (job.elecReg || ''), x + third, y);
  y += 9;
  doc.lineWidth(0.25).stroke('#000000');
  doc.text('Signature:', x, y); doc.line(x + 16, y + 0.6, x + third - 6, y + 0.6);
  doc.text('Date:', x + third, y); doc.line(x + third + 9, y + 0.6, x + 2 * third - 6, y + 0.6);
}

/* ---------- CSV ---------- */
function scheduleCSV(job, boards) {
  const q = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [['Client', 'COC Ref', 'Board', 'Board Location', 'Supply From', 'Circuit No', 'Description', 'Device Type', 'Rating (A)', 'Poles', 'Curve', 'RCD mA', 'Cable mm²', 'Points', 'Notes'].map(q).join(',')];
  boards.forEach(b => sortedMarkers(b).forEach(m => {
    lines.push([job.client, job.ref, b.name, b.location, b.supply, m.n, m.desc, m.type, m.rating, m.poles, m.curve, m.ma, m.cable, m.points, m.notes].map(q).join(','));
  }));
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
}

/* ---------- Backup ---------- */
async function exportBackup() {
  const done = busy('Preparing backup…');
  try {
    const data = { app: 'db-board-labeller', format: 1, version: VERSION, exported: new Date().toISOString(),
      jobs: await DB.all('jobs'), boards: await DB.all('boards'), settings: SETTINGS };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    done();
    fileReady(blob, 'DB-Labeller-backup-' + today() + '.json', 'Backup ready (' + data.jobs.length + ' jobs)');
  } catch (e) { done(); alertDlg('Backup failed', e.message); }
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return alertDlg('Not a backup file', 'That file could not be read as a DB Labeller backup.'); }
  if (!data || data.app !== 'db-board-labeller' || !Array.isArray(data.jobs)) return alertDlg('Not a backup file', 'That file is not a DB Board Labeller backup.');
  const existing = new Set((await DB.all('jobs')).map(j => j.id));
  const dupes = data.jobs.filter(j => existing.has(j.id)).length;
  const ok = await confirmDlg('Import backup?', data.jobs.length + ' job(s) and ' + (data.boards || []).length + ' board(s) from ' + (data.exported || '').slice(0, 10) + '.' +
    (dupes ? '\n' + dupes + ' job(s) already on this phone will be replaced with the backup copy.' : '\nNothing on this phone will be deleted.'), 'Import', false);
  if (!ok) return;
  const done = busy('Importing…');
  try {
    for (const j of data.jobs) await DB.put('jobs', j);
    for (const b of data.boards || []) await DB.put('boards', b);
    if (data.settings && Array.isArray(data.settings.picks)) {
      const set = new Set(SETTINGS.picks.map(p => p.toLowerCase()));
      data.settings.picks.forEach(p => { if (!set.has(String(p).toLowerCase())) SETTINGS.picks.push(p); });
      if (!SETTINGS.elecName && data.settings.elecName) { SETTINGS.elecName = data.settings.elecName; SETTINGS.elecReg = data.settings.elecReg || ''; }
      await saveSettings();
    }
    done(); toast('Imported ' + data.jobs.length + ' job(s)');
  } catch (e) { done(); alertDlg('Import failed', e.message); }
}

/* ---------- Settings ---------- */
async function viewSettings() {
  setHeader('Settings', '#/');
  const S = SETTINGS;
  const main = $('#main');
  let est = '';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = Math.round((e.usage || 0) / 1048576 * 10) / 10 + ' MB used'; } } catch (e) {}
  let persisted = false;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) {}
  main.innerHTML =
    '<div class="section-title">Appearance</div><div class="card"><div class="seg" id="theme">' +
    ['auto', 'light', 'dark'].map(t => '<button data-v="' + t + '"' + (S.theme === t ? ' class="on"' : '') + '>' + (t === 'auto' ? 'System' : t[0].toUpperCase() + t.slice(1)) + '</button>').join('') + '</div></div>' +
    '<div class="section-title">Electrician defaults (new jobs)</div><div class="card">' +
    '<label class="f"><span>Name</span><input class="in" id="sName" value="' + esc(S.elecName) + '"></label>' +
    '<label class="f" style="margin:0"><span>Registration number</span><input class="in" id="sReg" value="' + esc(S.elecReg) + '"></label></div>' +
    '<div class="section-title">Labels</div><div class="card"><div class="row2">' +
    '<label class="f" style="margin:0"><span>Module width (mm)</span><input class="in" id="sMM" inputmode="decimal" value="' + esc(S.moduleMM) + '"></label>' +
    '<label class="f" style="margin:0"><span>Label height (mm)</span><input class="in" id="sLH" inputmode="decimal" value="' + esc(S.labelH) + '"></label></div></div>' +
    '<div class="section-title">Quick-pick descriptions</div><div class="card"><div class="chips" id="pk"></div>' +
    '<div style="display:flex;gap:8px"><input class="in" id="newPick" placeholder="Add a description…"><button class="btn primary" id="addPick">Add</button></div>' +
    '<button class="btn block" id="resetPicks" style="margin-top:10px">Restore default list</button></div>' +
    '<div class="section-title">Backup & restore</div><div class="card"><div class="menu-list">' +
    '<button class="btn primary block" id="bk">Export backup (all jobs + photos)</button>' +
    '<button class="btn block" id="rs">Import backup file</button></div>' +
    '<p class="muted small" style="margin:10px 0 0">Data lives only on this phone. Export a backup regularly and keep it in Drive, iCloud or email.' +
    (est ? ' Storage: ' + esc(est) + '.' : '') + (persisted ? ' Storage is protected from automatic clean-up.' : '') + '</p>' +
    '<input type="file" id="rsIn" accept=".json,application/json" hidden></div>' +
    '<div class="section-title">App</div><div class="card"><div class="menu-list">' +
    '<button class="btn block" data-app="install">Install app</button><button class="btn block" data-app="update">Check for update</button>' +
    '<button class="btn block" data-app="share">Share App</button>' +
    (IS_NATIVE || isIOS() ? '' : '<button class="btn block" data-app="apk">Download Android APK</button>') + '</div>' +
    '<p style="margin:14px 0 0"><b>DB Board Labeller</b> · version ' + VERSION + '</p><p class="muted small" style="margin:4px 0 0">Works fully offline. No accounts, no servers.</p></div>';

  $('#theme').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    S.theme = b.dataset.v; await saveSettings();
    $$('#theme button').forEach(x => x.classList.toggle('on', x === b));
  };
  const saveField = (id, key, num) => $(id).addEventListener('change', async e => {
    S[key] = num ? (parseFloat(e.target.value) || DEFAULT_SETTINGS[key]) : e.target.value.trim(); await saveSettings(); toast('Saved');
  });
  saveField('#sName', 'elecName'); saveField('#sReg', 'elecReg'); saveField('#sMM', 'moduleMM', true); saveField('#sLH', 'labelH', true);
  const drawPicks = () => { $('#pk').innerHTML = S.picks.map((p, i) => '<button class="chip x" data-i="' + i + '">' + esc(p) + ' <span aria-hidden="true">✕</span></button>').join(''); };
  drawPicks();
  $('#pk').onclick = async e => {
    const c = e.target.closest('[data-i]'); if (!c) return;
    const p = S.picks[+c.dataset.i];
    if (!await confirmDlg('Remove quick-pick?', '“' + p + '”', 'Remove')) return;
    S.picks.splice(+c.dataset.i, 1); await saveSettings(); drawPicks();
  };
  const addPick = async () => {
    const v = $('#newPick').value.trim(); if (!v) return;
    if (!S.picks.some(x => x.toLowerCase() === v.toLowerCase())) { S.picks.push(v); await saveSettings(); }
    $('#newPick').value = ''; drawPicks();
  };
  $('#addPick').onclick = addPick;
  $('#newPick').addEventListener('keydown', e => { if (e.key === 'Enter') addPick(); });
  $('#resetPicks').onclick = async () => {
    if (!await confirmDlg('Restore defaults?', 'Your quick-pick list will be replaced with the default list.', 'Restore', false)) return;
    S.picks = DEFAULT_PICKS.slice(); await saveSettings(); drawPicks();
  };
  $('#bk').onclick = exportBackup;
  $('#rs').onclick = () => $('#rsIn').click();
  $('#rsIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importBackup(f); };
  bindAppButtons(main);
}

/* ---------- Install / Update / Share ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('App installed'); });
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => IS_NATIVE || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function bindAppButtons(root) {
  $$('[data-app]', root).forEach(b => {
    if (b.dataset.app === 'install' && isStandalone()) { b.textContent = 'Installed ✓'; b.disabled = true; }
    b.onclick = () => ({ install: installApp, update: updateApp, share: shareApp, apk: () => { location.href = APK_URL; } })[b.dataset.app]();
  });
}
async function installApp() {
  if (isStandalone()) return toast('Already installed');
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice; deferredPrompt = null;
    if (r && r.outcome === 'accepted') toast('Installing…');
    return;
  }
  if (isIOS()) {
    openSheet('<h3>Install on iPhone</h3><ol class="steps"><li>Open this page in <b>Safari</b>.</li>' +
      '<li>Tap the <b>Share</b> button (square with an up arrow) at the bottom of the screen.</li>' +
      '<li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open DB Labeller from your home screen.</li></ol>' +
      '<button class="btn primary block" data-x>Got it</button>', s => { $('[data-x]', s).onclick = closeSheet; });
    return;
  }
  openSheet('<h3>Install the app</h3><ol class="steps"><li>Open this page in <b>Chrome</b> or <b>Samsung Internet</b>.</li>' +
    '<li>Tap the menu (<b>⋮</b> or <b>≡</b>).</li><li>Tap <b>Install app</b> or <b>Add page to → Home screen</b>.</li></ol>' +
    '<button class="btn primary block" data-x>Got it</button>', s => { $('[data-x]', s).onclick = closeSheet; });
}
let reloading = false;
// Compare two versions like 1.0.10 vs 1.0.9
function newerVersion(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
async function updateAppNative() {
  const done = busy('Checking for update…');
  let latest;
  try {
    const r = await fetch(APP_URL + 'version.json?t=' + Date.now(), { cache: 'no-store' });
    latest = (await r.json()).version;
  } catch (e) { done(); return toast('Could not check – are you online?'); }
  done();
  if (!latest || !newerVersion(latest, VERSION)) return toast('You have the latest version (v' + VERSION + ')');
  const ok = await confirmDlg('Update available', 'Version ' + latest + ' is available (you have ' + VERSION + ').\n\nThe new APK will download in your browser. Open it and tap Install – your jobs are kept.', 'Download', false);
  if (ok) location.href = APK_URL;
}
// Wait for a new service worker to finish installing (or give up after ms)
function waitForWaiting(reg, ms) {
  return new Promise(res => {
    if (reg.waiting) return res(reg.waiting);
    const t = setTimeout(() => res(reg.waiting || null), ms);
    const watch = w => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') { clearTimeout(t); res(reg.waiting || w); }
        if (w.state === 'redundant') { clearTimeout(t); res(null); }
      });
    };
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  });
}
// Last resort: throw away the cached app files (NOT your jobs) and load fresh from the server
async function hardRefresh() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('db-labeller-')).map(k => caches.delete(k)));
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  } catch (e) {}
  reloading = true;
  location.replace(location.pathname + '?v=' + Date.now() + location.hash);
}
async function latestVersion() {
  const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('server answered ' + r.status);
  const v = (await r.json()).version;
  if (!v) throw new Error('no version in version.json');
  return v;
}
async function updateApp() {
  if (IS_NATIVE) return updateAppNative();
  const done = busy('Checking for update…');
  let latest;
  try { latest = await latestVersion(); }
  catch (e) {
    done();
    return alertDlg('Could not check for updates', (navigator.onLine === false ? 'This device is offline.' : 'The update server (github.io) could not be reached: ' + e.message + '.') +
      '\nIf you are on a work network it may be blocking github.io – try on mobile data or another network.');
  }
  if (!newerVersion(latest, VERSION)) { done(); return toast('You have the latest version (v' + VERSION + ')'); }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) {
      await reg.update().catch(() => {});
      const w = await waitForWaiting(reg, 20000);
      if (w) {
        done(); toast('Updating to v' + latest + '…');
        w.postMessage('SKIP_WAITING');
        setTimeout(() => { if (!reloading) hardRefresh(); }, 4000);
        return;
      }
    }
  } catch (e) {}
  done(); toast('Updating to v' + latest + '…');
  hardRefresh();
}
// Show a bar when a new version has downloaded in the background
function updateBanner(worker) {
  if ($('#updBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updBar'; bar.className = 'upd-bar';
  bar.innerHTML = '<span>A new version is ready</span><button class="btn accent small-btn">Update now</button>';
  bar.querySelector('button').onclick = () => { bar.remove(); worker.postMessage('SKIP_WAITING'); setTimeout(() => { if (!reloading) hardRefresh(); }, 4000); };
  document.body.appendChild(bar);
}
async function shareApp() {
  const url = APP_URL;
  const data = { title: 'DB Board Labeller', text: 'Photograph a DB board, tag breakers and print labels + circuit schedules for the COC. Free, works offline:', url };
  if (IS_NATIVE && NP('Share')) {
    data.text += ' ' + url + '\nAndroid APK: ' + APK_URL;
    try { await NP('Share').share({ title: data.title, text: data.text, dialogTitle: 'Share DB Labeller' }); } catch (e) {}
    return;
  }
  if (navigator.share) { try { await navigator.share(data); } catch (e) {} return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { alertDlg('Share this link', url); }
}

/* ---------- Boot ---------- */
document.addEventListener('gesturestart', e => e.preventDefault());
(async function boot() {
  try {
    await DB.open();
    await loadSettings();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    $('#main').innerHTML = '<div class="empty">Could not open storage: ' + esc(e.message) + '<br>Private/incognito mode is not supported.</div>';
    return;
  }
  history.replaceState(null, '');
  render();
  if (!IS_NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const hadController = !!navigator.serviceWorker.controller;
      if (reg.waiting && hadController) updateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBanner(w); });
      });
    }).catch(e => console.warn('SW', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  }
})();
