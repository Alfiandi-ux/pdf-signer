'use strict';

/* =====================================================================
   PDF Signer — aplikasi tanda tangan PDF 100% offline (client-side)
   Dibuat untuk Termux + browser lokal.
   ===================================================================== */

/* ---------------------------- Util ---------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function isMobile() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let toastTimer = 0;
function toast(message, type = '') {
  const el = els.toast;
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast' + (type ? ' ' + type : '');
  }, 2600);
}

/* --------------------------- Elemen --------------------------- */

const els = {
  // topbar
  btnOpen: $('#btnOpen'),
  btnDownload: $('#btnDownload'),
  btnClosePanel: $('#btnClosePanel'),
  btnScan: $('#btnScan'),
  btnScanEmpty: $('#btnScanEmpty'),
  btnOpenEmpty: $('#btnOpenEmpty'),
  // navigasi bawah (HP)
  navScan: $('#navScan'),
  navOpen: $('#navOpen'),
  navSign: $('#navSign'),
  navDownload: $('#navDownload'),
  // panel
  panel: $('#panel'),
  backdrop: $('#backdrop'),
  pad: $('#pad'),
  padHint: $('#padHint'),
  penWidth: $('#penWidth'),
  btnUndo: $('#btnUndo'),
  btnClearPad: $('#btnClearPad'),
  typeText: $('#typeText'),
  typeFont: $('#typeFont'),
  typeSize: $('#typeSize'),
  fileImg: $('#fileImg'),
  cleanWhite: $('#cleanWhite'),
  uploadPreview: $('#uploadPreview'),
  uploadPreviewImg: $('#uploadPreviewImg'),
  btnUse: $('#btnUse'),
  sigPreview: $('#sigPreview'),
  sigPreviewImg: $('#sigPreviewImg'),
  // toolbar
  viewer: $('#viewer'),
  pages: $('#pages'),
  emptyState: $('#emptyState'),
  zoomLabel: $('#zoomLabel'),
  pageLabel: $('#pageLabel'),
  sigCount: $('#sigCount'),
  fileName: $('#fileName'),
  btnZoomIn: $('#btnZoomIn'),
  btnZoomOut: $('#btnZoomOut'),
  btnFit: $('#btnFit'),
  btnPrevPage: $('#btnPrevPage'),
  btnNextPage: $('#btnNextPage'),
  btnDeleteSig: $('#btnDeleteSig'),
  // lain-lain
  filePdf: $('#filePdf'),
  hint: $('#hint'),
  btnCancelPlace: $('#btnCancelPlace'),
  toast: $('#toast'),
};

/* ---------------------------- State --------------------------- */

const state = {
  pdfjs: null,
  pdfBytes: null,
  fileName: 'dokumen',
  pageViews: [],
  signatures: [],
  maxPageWidth: 0,
  fitScale: 1,
  scale: 1,
  zoom: 1,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  placing: null,      // stamp yang sedang akan ditempel
  stamp: null,        // stamp terakhir yang dibuat
  uploadedStamp: null,
  selectedId: null,
  sigSeq: 0,
  activeTab: 'draw',
  lastSigPointer: 0,
  uploadFile: null,
  lastViewerWidth: 0,
  exported: false,
};

const padState = {
  strokes: [],
  current: null,
  color: '#111827',
  width: 3.5,
};

/* =====================================================================
   1. Pad gambar tanda tangan
   ===================================================================== */

const padCanvas = els.pad;
const padCtx = padCanvas.getContext('2d', { willReadFrequently: true });

function padPointFromEvent(e) {
  const r = padCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (padCanvas.width / r.width),
    y: (e.clientY - r.top) * (padCanvas.height / r.height),
  };
}

function redrawPad() {
  const w = padCanvas.width;
  const h = padCanvas.height;
  padCtx.clearRect(0, 0, w, h);
  padCtx.lineCap = 'round';
  padCtx.lineJoin = 'round';

  for (const stroke of padState.strokes) {
    const pts = stroke.points;
    padCtx.strokeStyle = stroke.color;
    padCtx.fillStyle = stroke.color;
    padCtx.lineWidth = stroke.width;

    if (pts.length === 1) {
      padCtx.beginPath();
      padCtx.arc(pts[0].x, pts[0].y, Math.max(stroke.width / 2, 0.8), 0, Math.PI * 2);
      padCtx.fill();
      continue;
    }

    padCtx.beginPath();
    padCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      padCtx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    padCtx.lineTo(last.x, last.y);
    padCtx.stroke();
  }

  els.padHint.classList.toggle('hide', padState.strokes.length > 0);
}

let padRaf = 0;
function schedulePadRedraw() {
  if (padRaf) return;
  padRaf = requestAnimationFrame(() => {
    padRaf = 0;
    redrawPad();
  });
}

padCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  try { padCanvas.setPointerCapture(e.pointerId); } catch (_) {}
  padState.current = {
    color: padState.color,
    width: padState.width,
    points: [padPointFromEvent(e)],
  };
  padState.strokes.push(padState.current);
  schedulePadRedraw();
});

padCanvas.addEventListener('pointermove', (e) => {
  if (!padState.current) return;
  e.preventDefault();
  const p = padPointFromEvent(e);
  const pts = padState.current.points;
  const last = pts[pts.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
  pts.push(p);
  schedulePadRedraw();
});

function endPadStroke() {
  padState.current = null;
}
padCanvas.addEventListener('pointerup', endPadStroke);
padCanvas.addEventListener('pointercancel', endPadStroke);
padCanvas.addEventListener('pointerleave', (e) => {
  if (e.buttons === 0) endPadStroke();
});

els.btnUndo.addEventListener('click', () => {
  if (!padState.strokes.length) return;
  padState.strokes.pop();
  redrawPad();
});

els.btnClearPad.addEventListener('click', () => {
  padState.strokes = [];
  padState.current = null;
  redrawPad();
});

els.penWidth.addEventListener('input', () => {
  padState.width = Number(els.penWidth.value) || 3.5;
});

$$('.swatch').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.swatch').forEach((b) => b.classList.toggle('active', b === btn));
    padState.color = btn.dataset.color;
  });
});

/* =====================================================================
   2. Membuat gambar tanda tangan (PNG transparan)
   ===================================================================== */

/**
 * Potong canvas ke area yang berisi piksel (buang ruang kosong),
 * lalu kembalikan PNG data URL + rasio tinggi/lebar.
 */
function cropToStamp(canvas, padding = 10, maxWidth = 1600) {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return null;

  let data;
  try {
    data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  } catch (_) {
    return null;
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w - 1, maxX + padding);
  maxY = Math.min(h - 1, maxY + padding);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const factor = Math.min(1, maxWidth / cw);
  const outW = Math.max(1, Math.round(cw * factor));
  const outH = Math.max(1, Math.round(ch * factor));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, minX, minY, cw, ch, 0, 0, outW, outH);

  return {
    dataUrl: out.toDataURL('image/png'),
    aspect: outH / outW, // tinggi / lebar
  };
}

function stampFromPad() {
  if (!padState.strokes.length) return null;
  return cropToStamp(padCanvas, 14, 1400);
}

async function stampFromText() {
  const text = els.typeText.value.trim();
  if (!text) {
    toast('Isi nama atau teks dulu');
    return null;
  }

  const size = Number(els.typeSize.value) || 110;
  const family = els.typeFont.value;
  const familyCss = family === 'cursive' ? 'cursive' : `"${family}"`;
  const font = `${size}px ${familyCss}`;

  try {
    await document.fonts.load(font, text);
  } catch (_) { /* pakai fallback */ }

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const metrics = measure.measureText(text);
  const width = Math.ceil(metrics.width) + Math.ceil(size * 0.6);
  const height = Math.ceil(size * 1.75);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = padState.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.06);

  return cropToStamp(canvas, Math.round(size * 0.1), 1600);
}

function removeWhiteBackground(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= 235) {
      d[i + 3] = 0;
    } else if (lum > 180) {
      const t = (235 - lum) / 55; // 1 di 180 → 0 di 235
      d[i + 3] = Math.min(a, Math.round(255 * Math.pow(t, 0.85)));
    }
  }
  ctx.putImageData(img, 0, 0);
}

async function stampFromImageFile(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) {
    toast('File harus berupa gambar', 'error');
    return null;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    try {
      bitmap = await createImageBitmap(file);
    } catch (_) {
      toast('Gambar tidak bisa dibaca', 'error');
      return null;
    }
  }

  const maxDim = 1600;
  const factor = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * factor));
  const h = Math.max(1, Math.round(bitmap.height * factor));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  if (els.cleanWhite.checked) {
    try { removeWhiteBackground(ctx, w, h); } catch (_) {}
  }

  return cropToStamp(canvas, 6, 1600);
}

/* =====================================================================
   3. Buka & render PDF
   ===================================================================== */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

const pageObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const v = state.pageViews[Number(entry.target.dataset.index)];
    if (v) renderPage(v);
  }
}, { root: els.viewer, rootMargin: '900px 0px' });

function resetDocument() {
  for (const v of state.pageViews) {
    if (v.task) {
      try { v.task.cancel(); } catch (_) {}
      v.task = null;
    }
  }
  pageObserver.disconnect();

  if (state.pdfjs) {
    try { state.pdfjs.destroy(); } catch (_) {}
  }

  state.pdfjs = null;
  state.pdfBytes = null;
  state.pageViews = [];
  state.signatures = [];
  state.selectedId = null;
  state.placing = null;
  state.maxPageWidth = 0;
  state.zoom = 1;
  state.exported = false;

  document.body.classList.remove('placing');
  els.hint.hidden = true;
  els.pages.innerHTML = '';
  els.emptyState.hidden = false;
  setDownloadEnabled(false);
  els.pageLabel.textContent = '– / –';
  els.zoomLabel.textContent = '100%';
  els.fileName.textContent = '';
  els.fileName.title = '';
  document.title = 'PDF Signer — Tanda Tangan PDF';
  select(null);
  updateSigCount();
}

async function openPdfFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    toast('File harus PDF', 'error');
    return;
  }
  if (file.size > 120 * 1024 * 1024) {
    toast('File terlalu besar (maksimal 120 MB)', 'error');
    return;
  }

  if (state.signatures.length) {
    const ok = window.confirm('Buka PDF baru? Semua tanda tangan yang belum diunduh akan hilang.');
    if (!ok) return;
  }

  toast('Membuka PDF…');

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    console.error(err);
    toast('File tidak bisa dibaca', 'error');
    return;
  }

  const name = (file.name || 'dokumen.pdf').replace(/\.pdf$/i, '') || 'dokumen';
  await loadPdfBytes(bytes, name);
}

/**
 * Muat PDF dari byte (dipakai untuk file biasa maupun hasil scan).
 */
async function loadPdfBytes(bytes, name) {
  if (!bytes || !bytes.length) {
    toast('PDF kosong', 'error');
    return false;
  }

  let doc;
  try {
    doc = await pdfjsLib.getDocument({
      data: bytes.slice(0),
      isEvalSupported: false,
      standardFontDataUrl: 'vendor/standard_fonts/',
      cMapUrl: 'vendor/cmaps/',
      cMapPacked: true,
    }).promise;
  } catch (err) {
    console.error(err);
    if (err && (err.name === 'PasswordException' || err.code === 1)) {
      toast('PDF terkunci password. Buka passwordnya dulu, lalu coba lagi.', 'error');
    } else {
      toast('Gagal membuka PDF. File mungkin rusak atau terenkripsi.', 'error');
    }
    return false;
  }

  if (!doc.numPages) {
    toast('PDF tidak memiliki halaman', 'error');
    return false;
  }

  resetDocument();
  state.pdfjs = doc;
  state.pdfBytes = bytes;
  state.fileName = (name || 'dokumen').replace(/\.pdf$/i, '') || 'dokumen';
  document.title = `${state.fileName}.pdf — PDF Signer`;
  els.fileName.textContent = `${state.fileName}.pdf`;
  els.fileName.title = `${state.fileName}.pdf`;
  els.emptyState.hidden = true;

  try {
    await buildPages();
  } catch (err) {
    console.error(err);
    try { doc.destroy(); } catch (_) {}
    pageObserver.disconnect();
    state.pdfjs = null;
    state.pdfBytes = null;
    state.pageViews = [];
    els.pages.innerHTML = '';
    els.emptyState.hidden = false;
    setDownloadEnabled(false);
    toast('Sebagian halaman gagal dimuat', 'error');
    return false;
  }

  els.emptyState.hidden = true;
  setDownloadEnabled(true);
  els.viewer.scrollTop = 0;
  updatePageLabel();
  toast(`PDF siap · ${doc.numPages} halaman`, 'success');
  return true;
}

function computeFitScale() {
  const padding = isMobile() ? 18 : 64;
  const avail = Math.max(240, els.viewer.clientWidth - padding);
  state.fitScale = Math.min(avail / (state.maxPageWidth || 595), 2);
}

async function buildPages() {
  const doc = state.pdfjs;
  const views = [];
  let maxW = 0;

  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    maxW = Math.max(maxW, vp1.width);
    views.push({
      index: i,
      page,
      vp1,
      rotation: page.rotate,
      el: null,
      canvas: null,
      sigLayer: null,
      cssWidth: 0,
      cssHeight: 0,
      rendered: false,
      rendering: false,
      renderScale: null,
      task: null,
    });
  }

  state.pageViews = views;
  state.maxPageWidth = maxW;
  computeFitScale();
  state.lastViewerWidth = els.viewer.clientWidth;

  const frag = document.createDocumentFragment();
  for (const v of views) {
    createPageEl(v);
    frag.append(v.el);
  }
  els.pages.innerHTML = '';
  els.pages.append(frag);

  for (const v of views) pageObserver.observe(v.el);
  applyScale();
}

function createPageEl(v) {
  const el = document.createElement('div');
  el.className = 'page';
  el.dataset.index = String(v.index);

  const canvas = document.createElement('canvas');
  canvas.className = 'page-canvas';

  const layer = document.createElement('div');
  layer.className = 'sig-layer';

  const num = document.createElement('div');
  num.className = 'page-num';
  num.textContent = String(v.index + 1);

  el.append(canvas, layer, num);
  el.addEventListener('click', (e) => onPageClick(e, v));

  v.el = el;
  v.canvas = canvas;
  v.sigLayer = layer;
}

function applyScale() {
  if (!state.pageViews.length) return;

  state.scale = state.fitScale * state.zoom;

  for (const v of state.pageViews) {
    v.cssWidth = v.vp1.width * state.scale;
    v.cssHeight = v.vp1.height * state.scale;
    v.el.style.width = v.cssWidth + 'px';
    v.el.style.height = v.cssHeight + 'px';

    if (v.task) {
      try { v.task.cancel(); } catch (_) {}
      v.task = null;
    }
    v.rendered = false;
    v.renderScale = null;
  }

  for (const sig of state.signatures) layoutSig(sig);
  els.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
  renderVisiblePages();
  updatePageLabel();
}

async function renderPage(v) {
  if (!v) return;
  if (v.rendering) return;
  if (v.rendered && v.renderScale === state.scale) return;

  v.rendering = true;
  const scale = state.scale;

  try {
    // Pastikan render sebelumnya sudah benar-benar berhenti:
    // satu canvas tidak boleh dipakai dua render sekaligus.
    if (v.task) {
      try { v.task.cancel(); } catch (_) {}
      try { await v.task.promise; } catch (_) {}
      v.task = null;
    }

    const renderScale = Math.min(scale * state.dpr, 3.5);
    const viewport = v.page.getViewport({ scale: renderScale });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));

    if (v.canvas.width !== w || v.canvas.height !== h) {
      v.canvas.width = w;
      v.canvas.height = h;
    }

    const ctx = v.canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const task = v.page.render({ canvasContext: ctx, viewport });
    v.task = task;
    await task.promise;

    if (scale !== state.scale) return;

    v.rendered = true;
    v.renderScale = scale;
    v.el.classList.add('is-rendered');
  } catch (err) {
    if (!err || err.name !== 'RenderingCancelledException') {
      console.warn('Gagal render halaman', v.index + 1, err);
    }
  } finally {
    v.rendering = false;
    v.task = null;

    // Skala berubah saat render berjalan → render ulang dengan skala terbaru.
    if (scale !== state.scale && state.pageViews.includes(v)) {
      setTimeout(() => renderPage(v), 0);
    }
  }
}

function renderVisiblePages() {
  if (!state.pageViews.length) return;
  const vr = els.viewer.getBoundingClientRect();
  const margin = 900;
  for (const v of state.pageViews) {
    if (!v.el) continue;
    const r = v.el.getBoundingClientRect();
    if (r.bottom > vr.top - margin && r.top < vr.bottom + margin) {
      renderPage(v);
    }
  }
}

/* =====================================================================
   4. Menempel & mengatur tanda tangan
   ===================================================================== */

function onPageClick(e, v) {
  if (e.target.closest('.sig')) return;
  if (performance.now() - state.lastSigPointer < 400) return;

  if (!state.placing) {
    select(null);
    return;
  }

  const rect = v.el.getBoundingClientRect();
  const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const fy = clamp((e.clientY - rect.top) / rect.height, 0, 1);

  addSignature(v.index, fx, fy, state.placing);
  cancelPlacing(false);
}

function addSignature(pageIndex, fx, fy, stamp) {
  const v = state.pageViews[pageIndex];
  if (!v) return;

  const aspectFrac = (v.cssWidth / v.cssHeight) * stamp.aspect;
  let w = 0.34; // lebar tanda tangan relatif terhadap lebar halaman
  let h = w * aspectFrac;

  if (h > 0.5) {          // terlalu tinggi → kecilkan, jaga rasio
    h = 0.5;
    w = h / aspectFrac;
  }
  if (h < 0.025) {        // terlalu tipis → naikkan, jaga rasio
    h = 0.025;
    w = h / aspectFrac;
  }
  if (w > 0.9) {
    w = 0.9;
    h = w * aspectFrac;
  }

  const x = clamp(fx - w / 2, 0, 1 - w);
  const y = clamp(fy - h / 2, 0, 1 - h);

  const sig = {
    id: ++state.sigSeq,
    page: pageIndex,
    x, y, w, h,
    aspect: stamp.aspect,
    dataUrl: stamp.dataUrl,
    el: null,
  };

  sig.el = buildSigEl(sig);
  v.sigLayer.append(sig.el);
  state.signatures.push(sig);
  state.exported = false;
  layoutSig(sig);
  select(sig.id);
  updateSigCount();
  toast('Tanda tangan ditempel. Geser atau tarik sudut untuk mengatur.');
}

function buildSigEl(sig) {
  const el = document.createElement('div');
  el.className = 'sig';
  el.dataset.id = String(sig.id);

  const img = document.createElement('img');
  img.src = sig.dataUrl;
  img.alt = 'Tanda tangan';
  img.draggable = false;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sig-del';
  del.innerHTML = '&times;';
  del.title = 'Hapus tanda tangan';
  del.setAttribute('aria-label', 'Hapus tanda tangan');
  del.addEventListener('pointerdown', (e) => e.stopPropagation());
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    removeSignature(sig.id);
  });

  const handle = document.createElement('span');
  handle.className = 'sig-handle';
  handle.title = 'Tarik untuk mengubah ukuran';
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    beginSigDrag(e, sig, 'resize');
  });

  el.append(img, del, handle);
  el.addEventListener('pointerdown', (e) => beginSigDrag(e, sig, 'move'));

  return el;
}

function layoutSig(sig) {
  const v = state.pageViews[sig.page];
  if (!v || !sig.el) return;
  sig.el.style.left = (sig.x * v.cssWidth) + 'px';
  sig.el.style.top = (sig.y * v.cssHeight) + 'px';
  sig.el.style.width = (sig.w * v.cssWidth) + 'px';
  sig.el.style.height = (sig.h * v.cssHeight) + 'px';
}

function beginSigDrag(e, sig, mode) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (state.placing) return;
  e.preventDefault();
  e.stopPropagation();

  state.lastSigPointer = performance.now();
  select(sig.id);

  const v = state.pageViews[sig.page];
  if (!v) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const start = { x: sig.x, y: sig.y, w: sig.w, h: sig.h };
  const minW = Math.max(0.06, 44 / v.cssWidth);
  const aspectFrac = (v.cssWidth / v.cssHeight) * sig.aspect;

  sig.el.classList.add('dragging');
  let moved = false;

  const onMove = (ev) => {
    const dx = (ev.clientX - startX) / v.cssWidth;
    const dy = (ev.clientY - startY) / v.cssHeight;
    if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) moved = true;

    if (mode === 'move') {
      sig.x = clamp(start.x + dx, 0, 1 - sig.w);
      sig.y = clamp(start.y + dy, 0, 1 - sig.h);
    } else {
      let w = clamp(start.w + dx, minW, 1 - sig.x);
      let h = w * aspectFrac;
      if (sig.y + h > 1) {
        h = 1 - sig.y;
        w = h / aspectFrac;
      }
      sig.w = w;
      sig.h = h;
    }
    layoutSig(sig);
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    sig.el.classList.remove('dragging');
    state.lastSigPointer = performance.now();
    if (moved) state.exported = false;
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function select(id) {
  state.selectedId = id;
  for (const sig of state.signatures) {
    if (sig.el) sig.el.classList.toggle('selected', sig.id === id);
  }
  els.btnDeleteSig.disabled = !id;
}

function removeSignature(id) {
  const idx = state.signatures.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const [sig] = state.signatures.splice(idx, 1);
  if (sig.el) sig.el.remove();
  state.exported = false;
  if (state.selectedId === id) select(null);
  updateSigCount();
}

function setDownloadEnabled(enabled) {
  if (els.btnDownload) els.btnDownload.disabled = !enabled;
  if (els.navDownload) els.navDownload.disabled = !enabled;
}

function updateSigCount() {
  const n = state.signatures.length;
  els.sigCount.textContent = `${n} tanda tangan`;
}

/* =====================================================================
   5. Mode menempel
   ===================================================================== */

async function useSignature() {
  if (!state.pdfjs) {
    toast('Buka file PDF dulu, lalu tempel tanda tangannya');
    return;
  }

  let stamp = null;
  els.btnUse.disabled = true;
  els.btnUse.textContent = 'Menyiapkan…';

  try {
    if (state.activeTab === 'draw') {
      stamp = stampFromPad();
      if (!stamp) toast('Gambar tanda tangan dulu');
    } else if (state.activeTab === 'type') {
      stamp = await stampFromText();
    } else {
      stamp = state.uploadedStamp;
      if (!stamp) toast('Pilih gambar tanda tangan dulu');
    }
  } finally {
    els.btnUse.disabled = false;
    els.btnUse.textContent = 'Gunakan tanda tangan ini';
  }

  if (!stamp) return;

  state.stamp = stamp;
  els.sigPreview.hidden = false;
  els.sigPreviewImg.src = stamp.dataUrl;

  state.placing = stamp;
  document.body.classList.add('placing');
  els.hint.hidden = false;

  if (isMobile()) closePanel();
  toast('Ketuk halaman PDF untuk menempelkan');
}

function cancelPlacing(notify = true) {
  state.placing = null;
  document.body.classList.remove('placing');
  els.hint.hidden = true;
  if (notify) toast('Dibatalkan');
}

/* =====================================================================
   6. Simpan PDF bertanda tangan
   ===================================================================== */

/* Di APK Android, unduhan blob tidak didukung WebView. Data dikirim ke
   jembatan native per potongan base64, lalu disimpan ke folder Download. */
function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function saveViaAndroid(blob, name) {
  const bridge = window.PdfSignerAndroid;
  if (!bridge || typeof bridge.beginSave !== 'function') return null;

  if (!bridge.beginSave(name)) {
    throw new Error('tidak dapat membuat file di perangkat');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 256 * 1024;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    if (!bridge.writeChunk(bytesToBase64(chunk))) {
      bridge.endSave();
      throw new Error('gagal menulis data PDF');
    }
  }

  const message = bridge.endSave();
  if (!message || /^Gagal/.test(message)) {
    throw new Error(message || 'gagal menyimpan PDF');
  }
  return message;
}

async function exportPdf() {
  if (!state.pdfBytes) return;
  if (!state.signatures.length) {
    toast('Belum ada tanda tangan yang ditempel');
    return;
  }

  const btn = els.btnDownload;
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Menyiapkan…';
  toast('Menyiapkan PDF…');

  try {
    const { PDFDocument, degrees } = PDFLib;
    const doc = await PDFDocument.load(state.pdfBytes);
    const pages = doc.getPages();
    const imageCache = new Map();

    for (const sig of state.signatures) {
      const v = state.pageViews[sig.page];
      const page = pages[sig.page];
      if (!v || !page) continue;

      let image = imageCache.get(sig.dataUrl);
      if (!image) {
        image = await doc.embedPng(dataUrlToBytes(sig.dataUrl));
        imageCache.set(sig.dataUrl, image);
      }

      const xPt = sig.x * v.vp1.width;
      const yPt = sig.y * v.vp1.height;
      const wPt = sig.w * v.vp1.width;
      const hPt = sig.h * v.vp1.height;

      // Sudut kiri-bawah kotak tanda tangan di layar → koordinat PDF
      const [px, py] = v.vp1.convertToPdfPoint(xPt, yPt + hPt);
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;

      page.drawImage(image, {
        x: px,
        y: py,
        width: wPt,
        height: hPt,
        rotate: degrees(rotation),
      });
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const fileName = `${state.fileName}-signed.pdf`;

    const androidMessage = await saveViaAndroid(blob, fileName);
    if (androidMessage) {
      toast(androidMessage, 'success');
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('PDF bertanda tangan berhasil diunduh', 'success');
    }

    state.exported = true;
  } catch (err) {
    console.error(err);
    toast('Gagal membuat PDF: ' + (err && err.message ? err.message : 'kesalahan tidak diketahui'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

/* =====================================================================
   7. Toolbar, navigasi halaman, panel
   ===================================================================== */

function currentPageIndex() {
  if (!state.pageViews.length) return 0;
  const vr = els.viewer.getBoundingClientRect();
  const anchor = vr.top + 70;
  let best = 0;
  for (const v of state.pageViews) {
    const r = v.el.getBoundingClientRect();
    if (r.top <= anchor) best = v.index;
  }
  return best;
}

function updatePageLabel() {
  const n = state.pageViews.length;
  if (!n) {
    els.pageLabel.textContent = '– / –';
    return;
  }
  els.pageLabel.textContent = `${currentPageIndex() + 1} / ${n}`;
}

function scrollToPage(index) {
  const v = state.pageViews[clamp(index, 0, state.pageViews.length - 1)];
  if (!v) return;
  const top = v.el.offsetTop + els.pages.offsetTop - 12;
  els.viewer.scrollTo({ top, behavior: 'smooth' });
}

function setZoom(z) {
  state.zoom = clamp(z, 0.35, 3);
  applyScale();
}

function openPanel() {
  els.panel.classList.add('open');
  els.backdrop.hidden = false;
}

function closePanel() {
  els.panel.classList.remove('open');
  els.backdrop.hidden = true;
}

/* =====================================================================
   6b. Integrasi pemindai dokumen
   ===================================================================== */

function openScanner() {
  if (window.DocScanner) {
    window.DocScanner.open();
  } else {
    toast('Fitur scan tidak tersedia', 'error');
  }
}

async function openScannedPdf(bytes, name) {
  if (state.signatures.length) {
    const ok = window.confirm('Buka hasil scan? Semua tanda tangan yang belum diunduh akan hilang.');
    if (!ok) return false;
  }
  return loadPdfBytes(bytes, name);
}

async function appendScannedPdf(bytes, name) {
  if (!state.pdfBytes) return openScannedPdf(bytes, name);

  if (state.signatures.length) {
    const ok = window.confirm('Tambah halaman hasil scan? Semua tanda tangan yang belum diunduh akan hilang.');
    if (!ok) return false;
  }

  try {
    const { PDFDocument } = PDFLib;
    const current = await PDFDocument.load(state.pdfBytes);
    const extra = await PDFDocument.load(bytes);
    const copied = await current.copyPages(extra, extra.getPageIndices());
    for (const page of copied) current.addPage(page);
    const merged = await current.save();
    return loadPdfBytes(merged, state.fileName);
  } catch (err) {
    console.error(err);
    toast('Gagal menggabungkan hasil scan: '
      + (err && err.message ? err.message : 'kesalahan tidak diketahui'), 'error');
    return false;
  }
}

if (window.DocScanner) {
  window.DocScanner.init({
    toast,
    hasDocument: () => !!state.pdfjs,
    openScan: openScannedPdf,
    appendScan: appendScannedPdf,
  });
}

/* Event listener dasar */
els.btnOpen.addEventListener('click', () => els.filePdf.click());
els.btnScan.addEventListener('click', openScanner);
if (els.btnScanEmpty) els.btnScanEmpty.addEventListener('click', openScanner);
if (els.btnOpenEmpty) els.btnOpenEmpty.addEventListener('click', () => els.filePdf.click());

els.navScan.addEventListener('click', openScanner);
els.navOpen.addEventListener('click', () => els.filePdf.click());
els.navSign.addEventListener('click', openPanel);
els.navDownload.addEventListener('click', exportPdf);

els.filePdf.addEventListener('change', () => {
  const file = els.filePdf.files && els.filePdf.files[0];
  els.filePdf.value = '';
  if (file) openPdfFile(file);
});

els.btnDownload.addEventListener('click', exportPdf);

els.btnUse.addEventListener('click', useSignature);
els.btnCancelPlace.addEventListener('click', () => cancelPlacing());

els.btnDeleteSig.addEventListener('click', () => {
  if (state.selectedId) removeSignature(state.selectedId);
});

els.btnZoomIn.addEventListener('click', () => setZoom(state.zoom * 1.2));
els.btnZoomOut.addEventListener('click', () => setZoom(state.zoom / 1.2));
els.btnFit.addEventListener('click', () => setZoom(1));

els.btnPrevPage.addEventListener('click', () => scrollToPage(currentPageIndex() - 1));
els.btnNextPage.addEventListener('click', () => scrollToPage(currentPageIndex() + 1));

els.btnClosePanel.addEventListener('click', closePanel);
els.backdrop.addEventListener('click', closePanel);

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.activeTab = tab.dataset.tab;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === state.activeTab));
  });
});

els.fileImg.addEventListener('change', async () => {
  const file = els.fileImg.files && els.fileImg.files[0];
  els.fileImg.value = '';
  if (!file) return;

  state.uploadFile = file;
  const stamp = await stampFromImageFile(file);
  if (!stamp) {
    toast('Gambar tanda tangan kosong / tidak terbaca', 'error');
    return;
  }
  state.uploadedStamp = stamp;
  els.uploadPreview.hidden = false;
  els.uploadPreviewImg.src = stamp.dataUrl;
  toast('Gambar siap. Tekan “Gunakan tanda tangan ini”.', 'success');
});

els.cleanWhite.addEventListener('change', async () => {
  if (!state.uploadFile) return;
  const stamp = await stampFromImageFile(state.uploadFile);
  if (!stamp) return;
  state.uploadedStamp = stamp;
  els.uploadPreview.hidden = false;
  els.uploadPreviewImg.src = stamp.dataUrl;
});

/* Drag & drop PDF ke mana saja */
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
    e.preventDefault();
  }
});
document.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  e.preventDefault();
  openPdfFile(file);
});

/* Scroll → update nomor halaman */
let scrollRaf = 0;
els.viewer.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    updatePageLabel();
  });
}, { passive: true });

/* Resize → hitung ulang skala */
window.addEventListener('resize', debounce(() => {
  if (!state.pageViews.length) return;
  const w = els.viewer.clientWidth;
  if (Math.abs(w - state.lastViewerWidth) < 2) return; // keyboard HP, dsb.
  state.lastViewerWidth = w;
  computeFitScale();
  applyScale();
}, 180));

/* Keyboard */
document.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('scan-open')) return; // ditangani pemindai
  const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.key === 'Escape') {
    if (state.placing) cancelPlacing();
    else select(null);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
    e.preventDefault();
    removeSignature(state.selectedId);
  }
});

/* Peringatan bila menutup tab dengan tanda tangan yang belum diunduh */
window.addEventListener('beforeunload', (e) => {
  if (state.signatures.length && !state.exported) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------------------------- Init ---------------------------- */
updateSigCount();
redrawPad();

if (location.protocol === 'file:') {
  const note = els.emptyState.querySelector('.empty-note');
  if (note) {
    note.textContent = 'Aplikasi ini harus dibuka lewat server lokal (bash start.sh), bukan lewat file://.';
  }
  setTimeout(() => {
    toast('Jalankan “bash start.sh” lalu buka http://localhost:8000', 'error');
  }, 500);
}
