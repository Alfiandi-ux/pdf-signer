'use strict';

/* =====================================================================
   Pemindai dokumen — kamera / galeri, potong perspektif, filter,
   lalu susun halaman menjadi PDF. Semua proses lokal di perangkat.
   ===================================================================== */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nextFrame = () => new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 40));
  });

  const MAX_CAPTURE = 2400;   // sisi terpanjang foto yang disimpan di memori
  const MAX_WARP = 1800;      // sisi terpanjang hasil koreksi perspektif
  const MAX_PIXELS = 3.2e6;   // batas piksel agar pemrosesan tetap cepat

  let api = null;
  let mode = 'camera';
  let stream = null;
  let facing = 'environment';
  let torchOn = false;
  let starting = false;
  let busy = false;
  let sourceCanvas = null;
  let corners = defaultCorners();
  let filter = 'bw';
  let pages = [];
  let activeDrag = -1;

  const el = {
    root: $('#scanner'),
    subtitle: $('#scanSubtitle'),
    camera: $('#scanCamera'),
    video: $('#scanVideo'),
    guide: $('#scanGuide'),
    camError: $('#scanCamError'),
    camErrorText: $('#scanCamErrorText'),
    torch: $('#scanTorch'),
    flip: $('#scanFlip'),
    crop: $('#scanCrop'),
    cropBox: $('#cropBox'),
    cropImg: $('#cropImg'),
    cropPoly: $('#cropPoly'),
    cropShade: $('#cropShade'),
    pagesView: $('#scanPagesView'),
    pagesInfo: $('#scanPagesInfo'),
    grid: $('#scanGrid'),
    empty: $('#scanEmpty'),
    mergeWrap: $('#scanMergeWrap'),
    merge: $('#scanMerge'),
    busy: $('#scanBusy'),
    busyText: $('#scanBusyText'),
    footCamera: $('#scanFootCamera'),
    footCrop: $('#scanFootCrop'),
    footPages: $('#scanFootPages'),
    shutter: $('#scanShutter'),
    gallery: $('#scanGallery'),
    galleryError: $('#scanGalleryError'),
    retryCam: $('#scanRetryCam'),
    done: $('#scanDone'),
    count: $('#scanCount'),
    retake: $('#scanRetake'),
    accept: $('#scanAccept'),
    again: $('#scanAgain'),
    build: $('#scanBuild'),
    close: $('#scanClose'),
    file: $('#scanFile'),
    stage: $('#scanStage'),
  };

  if (!el.root) return;

  const cameraSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function defaultCorners() {
    return [
      { x: 0.03, y: 0.03 }, // kiri atas
      { x: 0.97, y: 0.03 }, // kanan atas
      { x: 0.97, y: 0.97 }, // kanan bawah
      { x: 0.03, y: 0.97 }, // kiri bawah
    ];
  }

  /* ------------------------- Mode & tampilan ------------------------- */

  function setMode(next) {
    mode = next;
    el.camera.hidden = next !== 'camera';
    el.crop.hidden = next !== 'crop';
    el.pagesView.hidden = next !== 'pages';
    el.footCamera.hidden = next !== 'camera';
    el.footCrop.hidden = next !== 'crop';
    el.footPages.hidden = next !== 'pages';

    if (next !== 'camera') stopCamera();

    el.torch.hidden = next !== 'camera' || !hasTorch();
    el.flip.hidden = next !== 'camera' || !stream;

    if (next === 'camera') {
      el.subtitle.textContent = 'Posisikan dokumen di dalam bingkai';
    } else if (next === 'crop') {
      el.subtitle.textContent = 'Tarik sudut mengikuti tepi dokumen';
    } else {
      el.subtitle.textContent = pages.length
        ? `${pages.length} halaman siap dibuat PDF`
        : 'Belum ada halaman';
      el.mergeWrap.hidden = !(api && api.hasDocument());
      updatePagesUI();
    }
  }

  function showCamera() {
    setMode('camera');
    el.camError.hidden = true;
    el.guide.hidden = false;
    el.video.hidden = false;
    el.shutter.disabled = true;
    if (!cameraSupported) {
      showCamError('Kamera tidak tersedia di perangkat ini. Pilih gambar dari galeri untuk memindai.');
      return;
    }
    startCamera();
  }

  function showCamError(message) {
    stopCamera();
    el.camError.hidden = false;
    el.camErrorText.textContent = message;
    el.video.hidden = true;
    el.guide.hidden = true;
    el.subtitle.textContent = 'Kamera tidak tersedia';
    el.shutter.disabled = true;
  }

  /* ----------------------------- Kamera ----------------------------- */

  async function startCamera() {
    if (starting) return;
    if (!cameraSupported) {
      showCamError('Kamera tidak tersedia di perangkat ini. Pilih gambar dari galeri untuk memindai.');
      return;
    }

    starting = true;
    stopCamera();
    el.camError.hidden = true;
    el.guide.hidden = false;
    el.video.hidden = false;
    el.shutter.disabled = true;
    el.subtitle.textContent = 'Menyalakan kamera…';

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (mode !== 'camera') {
        stopCamera();
        return;
      }

      el.video.srcObject = stream;
      try { await el.video.play(); } catch (_) {}

      el.shutter.disabled = false;
      el.flip.hidden = false;
      el.subtitle.textContent = 'Posisikan dokumen di dalam bingkai';
      setupTorch();
    } catch (err) {
      console.warn('Kamera gagal dibuka', err);
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      showCamError(denied
        ? 'Izin kamera ditolak. Izinkan akses kamera di pengaturan aplikasi, lalu coba lagi.'
        : 'Kamera tidak bisa dibuka di perangkat ini. Coba lagi atau pilih gambar dari galeri.');
    } finally {
      starting = false;
    }
  }

  function stopCamera() {
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch (_) {}
      }
      stream = null;
    }
    if (el.video.srcObject) el.video.srcObject = null;
    el.torch.hidden = true;
    el.flip.hidden = true;
    el.shutter.disabled = true;
    torchOn = false;
    el.torch.classList.remove('active');
  }

  function hasTorch() {
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return false;
    try { return !!track.getCapabilities().torch; } catch (_) { return false; }
  }

  function setupTorch() {
    el.torch.hidden = !hasTorch();
    el.torch.classList.toggle('active', torchOn && !el.torch.hidden);
  }

  function capture() {
    if (busy) return;
    if (!stream || !el.video.videoWidth) {
      if (api) api.toast('Kamera belum siap, coba lagi sebentar');
      return;
    }
    const vw = el.video.videoWidth;
    const vh = el.video.videoHeight;
    const factor = Math.min(1, MAX_CAPTURE / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vw * factor));
    canvas.height = Math.max(1, Math.round(vh * factor));
    canvas.getContext('2d').drawImage(el.video, 0, 0, canvas.width, canvas.height);
    useSource(canvas);
  }

  /* ------------------------ Sumber gambar --------------------------- */

  function useSource(canvas) {
    sourceCanvas = canvas;
    corners = defaultCorners();
    stopCamera();
    setMode('crop');
    el.cropImg.onload = () => layoutCrop();
    el.cropImg.src = canvas.toDataURL('image/jpeg', 0.92);
    requestAnimationFrame(layoutCrop);
    renderChips();
  }

  function layoutCrop() {
    if (!sourceCanvas || mode !== 'crop') return;
    const rect = el.stage.getBoundingClientRect();
    const availW = Math.max(140, rect.width - 28);
    const availH = Math.max(140, rect.height - 28);
    const ratio = sourceCanvas.width / sourceCanvas.height;
    let w = availW;
    let h = w / ratio;
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    el.cropBox.style.width = Math.round(w) + 'px';
    el.cropBox.style.height = Math.round(h) + 'px';
    renderQuad();
  }

  function renderQuad() {
    const pts = corners.map((c) => `${(c.x * 100).toFixed(3)},${(c.y * 100).toFixed(3)}`);
    el.cropPoly.setAttribute('points', pts.join(' '));
    el.cropShade.setAttribute('d', 'M0 0H100V100H0Z M' + pts.join('L') + 'Z');

    $$('.crop-handle', el.cropBox).forEach((handle) => {
      const index = Number(handle.dataset.corner);
      const c = corners[index];
      if (!c) return;
      handle.style.left = (c.x * 100) + '%';
      handle.style.top = (c.y * 100) + '%';
    });
  }

  /* ---------------------- Potong perspektif ------------------------- */

  function solveLinear(matrix, rhs) {
    const n = rhs.length;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
      }
      if (Math.abs(matrix[pivot][col]) < 1e-10) return null;
      if (pivot !== col) {
        const tmpRow = matrix[pivot];
        matrix[pivot] = matrix[col];
        matrix[col] = tmpRow;
        const tmpVal = rhs[pivot];
        rhs[pivot] = rhs[col];
        rhs[col] = tmpVal;
      }
      const pivotVal = matrix[col][col];
      for (let row = col + 1; row < n; row++) {
        const factor = matrix[row][col] / pivotVal;
        if (factor === 0) continue;
        for (let c = col; c < n; c++) matrix[row][c] -= factor * matrix[col][c];
        rhs[row] -= factor * rhs[col];
      }
    }
    const result = new Array(n).fill(0);
    for (let row = n - 1; row >= 0; row--) {
      let sum = rhs[row];
      for (let c = row + 1; c < n; c++) sum -= matrix[row][c] * result[c];
      result[row] = sum / matrix[row][row];
    }
    return result;
  }

  /** Homografi dari kotak tujuan (0..W, 0..H) ke titik sumber (piksel). */
  function homography(points, width, height) {
    const dst = [[0, 0], [width, 0], [width, height], [0, height]];
    const matrix = [];
    const rhs = [];
    for (let i = 0; i < 4; i++) {
      const u = dst[i][0];
      const v = dst[i][1];
      const x = points[i].x;
      const y = points[i].y;
      matrix.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
      rhs.push(x);
      matrix.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
      rhs.push(y);
    }
    return solveLinear(matrix, rhs);
  }

  function warpPerspective(src, quad, maxDim) {
    const sw = src.width;
    const sh = src.height;
    const pts = quad.map((c) => ({ x: c.x * sw, y: c.y * sh }));
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    let W = Math.max(dist(pts[0], pts[1]), dist(pts[3], pts[2]), 32);
    let H = Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2]), 32);
    const factor = Math.min(1, maxDim / Math.max(W, H), Math.sqrt(MAX_PIXELS / (W * H)));
    W = Math.max(2, Math.round(W * factor));
    H = Math.max(2, Math.round(H * factor));

    const h = homography(pts, W, H);
    if (!h) return null;
    const a = h[0];
    const b = h[1];
    const c = h[2];
    const d = h[3];
    const e = h[4];
    const f = h[5];
    const g = h[6];
    const k = h[7];

    const sdata = src.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, sw, sh).data;

    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const octx = out.getContext('2d');
    const image = octx.createImageData(W, H);
    const data = image.data;

    let o = 0;
    for (let y = 0; y < H; y++) {
      const v = y + 0.5;
      const nc = b * v + c;
      const nf = e * v + f;
      const base = k * v + 1;

      for (let x = 0; x < W; x++) {
        const u = x + 0.5;
        const den = g * u + base;
        const sx = (a * u + nc) / den;
        const sy = (d * u + nf) / den;

        let x0 = sx | 0;
        let y0 = sy | 0;
        let fx = sx - x0;
        let fy = sy - y0;
        if (x0 < 0) { x0 = 0; fx = 0; } else if (x0 > sw - 2) { x0 = sw - 2; fx = 1; }
        if (y0 < 0) { y0 = 0; fy = 0; } else if (y0 > sh - 2) { y0 = sh - 2; fy = 1; }
        if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
        if (fy < 0) fy = 0; else if (fy > 1) fy = 1;

        const i00 = (y0 * sw + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        data[o] = sdata[i00] * w00 + sdata[i10] * w10 + sdata[i01] * w01 + sdata[i11] * w11;
        data[o + 1] = sdata[i00 + 1] * w00 + sdata[i10 + 1] * w10 + sdata[i01 + 1] * w01 + sdata[i11 + 1] * w11;
        data[o + 2] = sdata[i00 + 2] * w00 + sdata[i10 + 2] * w10 + sdata[i01 + 2] * w01 + sdata[i11 + 2] * w11;
        data[o + 3] = 255;
        o += 4;
      }
    }

    octx.putImageData(image, 0, 0);
    return out;
  }

  /* ---------------------------- Filter ------------------------------ */

  function applyFilter(canvas, kind) {
    if (kind === 'color') return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const n = w * h;
    const gray = new Uint8Array(n);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      gray[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    }

    if (kind === 'gray') {
      // Regangkan kontras berdasarkan histogram (buang 1% ekstrem).
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[gray[i]]++;

      let lo = 0;
      let hi = 255;
      let acc = 0;
      const lowTarget = n * 0.01;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc >= lowTarget) { lo = i; break; }
      }
      acc = 0;
      const highTarget = n * 0.99;
      for (let i = 255; i >= 0; i--) {
        acc += hist[i];
        if (acc >= highTarget) { hi = i; break; }
      }
      if (hi <= lo + 8) { lo = 0; hi = 255; }

      const scale = 255 / (hi - lo);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        let value = Math.round((gray[i] - lo) * scale);
        value = value < 0 ? 0 : value > 255 ? 255 : value;
        d[p] = value;
        d[p + 1] = value;
        d[p + 2] = value;
      }
    } else {
      // Ambang adaptif memakai integral image: tahan bayangan & cahaya tidak rata.
      const iw = w + 1;
      const integral = new Uint32Array(iw * (h + 1));
      for (let y = 0; y < h; y++) {
        let rowSum = 0;
        const rowBase = (y + 1) * iw;
        const prevBase = y * iw;
        for (let x = 0; x < w; x++) {
          rowSum += gray[y * w + x];
          integral[rowBase + x + 1] = integral[prevBase + x + 1] + rowSum;
        }
      }

      const radius = Math.max(8, Math.round(Math.min(w, h) / 24));
      for (let y = 0; y < h; y++) {
        const y1 = Math.max(0, y - radius);
        const y2 = Math.min(h - 1, y + radius);
        const topBase = y1 * iw;
        const botBase = (y2 + 1) * iw;
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - radius);
          const x2 = Math.min(w - 1, x + radius);
          const sum = integral[botBase + x2 + 1] - integral[topBase + x2 + 1]
            - integral[botBase + x1] + integral[topBase + x1];
          const count = (x2 - x1 + 1) * (y2 - y1 + 1);
          const mean = sum / count;
          const value = gray[y * w + x];
          const black = value < mean * 0.86 || value < 70;
          const p = (y * w + x) * 4;
          const out = black ? 0 : 255;
          d[p] = out;
          d[p + 1] = out;
          d[p + 2] = out;
        }
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  function downscale(canvas, maxDim) {
    const factor = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    if (factor >= 1) return canvas;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * factor));
    out.height = Math.max(1, Math.round(canvas.height * factor));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }

  /* ------------------------- Halaman & PDF -------------------------- */

  function showPages() {
    if (!pages.length) { showCamera(); return; }
    setMode('pages');
    updatePagesUI();
  }

  function updatePagesUI() {
    el.grid.innerHTML = '';

    pages.forEach((page, index) => {
      const item = document.createElement('div');
      item.className = 'scan-thumb';

      const img = document.createElement('img');
      img.src = page.dataUrl;
      img.alt = `Halaman ${index + 1}`;

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `Hal. ${index + 1}`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '×';
      del.setAttribute('aria-label', `Hapus halaman ${index + 1}`);
      del.addEventListener('click', () => {
        pages.splice(index, 1);
        updatePagesUI();
        if (!pages.length) showCamera();
      });

      item.append(img, num, del);
      el.grid.append(item);
    });

    el.empty.hidden = pages.length > 0;
    el.pagesInfo.textContent = `${pages.length} halaman`;
    el.build.disabled = pages.length === 0;
    el.build.textContent = pages.length ? `Buat PDF (${pages.length})` : 'Buat PDF';
    el.done.disabled = pages.length === 0;
    el.count.hidden = pages.length === 0;
    el.count.textContent = `${pages.length} halaman siap`;
    el.mergeWrap.hidden = !(api && api.hasDocument());

    if (mode === 'pages') {
      el.subtitle.textContent = pages.length
        ? `${pages.length} halaman siap dibuat PDF`
        : 'Belum ada halaman';
    }
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function scanName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `scan-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  async function buildPdf() {
    if (busy || !pages.length || !api) return;
    setBusy('Membuat PDF…');
    await nextFrame();

    try {
      if (!window.PDFLib) throw new Error('pdf-lib tidak tersedia');
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.create();

      for (const page of pages) {
        const bytes = dataUrlToBytes(page.dataUrl);
        const image = page.format === 'png'
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);

        const aspect = image.height / image.width;
        let pw;
        let ph;
        if (aspect >= 1) {
          pw = 595.28;
          ph = pw * aspect;
        } else {
          ph = 595.28;
          pw = ph / aspect;
        }
        const cap = Math.min(1, 1683.89 / Math.max(pw, ph));
        pw *= cap;
        ph *= cap;

        const pdfPage = doc.addPage([pw, ph]);
        pdfPage.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      }

      const bytes = await doc.save();
      const name = scanName();
      const merge = !el.mergeWrap.hidden && el.merge.checked;
      const ok = merge
        ? await api.appendScan(bytes, name)
        : await api.openScan(bytes, name);

      if (ok) close();
    } catch (err) {
      console.error(err);
      if (api) {
        api.toast('Gagal membuat PDF: '
          + (err && err.message ? err.message : 'kesalahan tidak diketahui'), 'error');
      }
    } finally {
      clearBusy();
    }
  }

  /* --------------------------- Galeri ------------------------------- */

  function openGallery() {
    if (busy) return;
    el.file.value = '';
    el.file.click();
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (_) {
        return await createImageBitmap(file);
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function loadImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      if (api) api.toast('Pilih file gambar', 'error');
      return;
    }

    setBusy('Memuat gambar…');
    await nextFrame();

    try {
      const bitmap = await loadBitmap(file);
      const factor = Math.min(1, MAX_CAPTURE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * factor));
      canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === 'function') bitmap.close();
      useSource(canvas);
    } catch (err) {
      console.warn('Gambar gagal dimuat', err);
      if (api) api.toast('Gambar tidak bisa dibaca', 'error');
    } finally {
      clearBusy();
    }
  }

  /* ------------------------- Proses potong -------------------------- */

  async function acceptCrop() {
    if (busy || !sourceCanvas) return;

    setBusy('Memotong & memperbaiki dokumen…');
    await nextFrame();

    let warped = null;
    try {
      warped = warpPerspective(sourceCanvas, corners, MAX_WARP);
    } catch (err) {
      console.error('Gagal memotong', err);
    }

    if (!warped) {
      clearBusy();
      if (api) api.toast('Gagal memotong gambar', 'error');
      return;
    }

    setBusy('Meningkatkan kualitas…');
    await nextFrame();
    try {
      applyFilter(warped, filter);
    } catch (err) {
      console.warn('Filter gagal diterapkan', err);
    }

    setBusy('Menyiapkan halaman…');
    await nextFrame();

    try {
      const out = downscale(warped, 2000);
      const isPng = filter === 'bw';
      pages.push({
        dataUrl: isPng ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.86),
        format: isPng ? 'png' : 'jpeg',
        w: out.width,
        h: out.height,
      });
      showPages();
    } catch (err) {
      console.error(err);
      if (api) api.toast('Gagal menyiapkan halaman', 'error');
    } finally {
      clearBusy();
    }
  }

  /* --------------------------- Busy state --------------------------- */

  function setBusy(text) {
    busy = true;
    el.busyText.textContent = text;
    el.busy.hidden = false;
  }

  function clearBusy() {
    busy = false;
    el.busy.hidden = true;
  }

  /* --------------------------- Buka/tutup --------------------------- */

  function resetAll() {
    stopCamera();
    pages = [];
    sourceCanvas = null;
    corners = defaultCorners();
    filter = 'bw';
    activeDrag = -1;
    clearBusy();
    el.cropImg.removeAttribute('src');
    el.grid.innerHTML = '';
    el.merge.checked = false;
    el.mergeWrap.hidden = true;
    el.count.hidden = true;
    el.done.disabled = true;
    el.build.disabled = true;
    el.build.textContent = 'Buat PDF';
    renderChips();
    updatePagesUI();
  }

  function openScanner() {
    if (!api) return;
    resetAll();
    el.root.hidden = false;
    el.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('scan-open');
    showCamera();
  }

  function close() {
    if (busy) return;
    stopCamera();
    el.root.hidden = true;
    el.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('scan-open');
    pages = [];
    sourceCanvas = null;
  }

  function handleBack() {
    if (el.root.hidden) return false;
    if (busy) return true;

    if (mode === 'camera') {
      close();
      return true;
    }
    if (mode === 'crop') {
      if (cameraSupported) showCamera();
      else if (pages.length) showPages();
      else close();
      return true;
    }
    if (mode === 'pages') {
      if (cameraSupported) showCamera();
      else close();
      return true;
    }
    return true;
  }

  /* ---------------------------- Event ------------------------------- */

  function renderChips() {
    $$('.scan-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.filter === filter);
    });
  }

  $$('.crop-handle', el.cropBox).forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (busy) return;
      e.preventDefault();
      e.stopPropagation();

      const index = Number(handle.dataset.corner);
      activeDrag = index;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}

      const onMove = (ev) => {
        if (activeDrag !== index) return;
        const rect = el.cropBox.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        corners[index] = {
          x: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
          y: clamp((ev.clientY - rect.top) / rect.height, 0, 1),
        };
        renderQuad();
      };

      const onUp = () => {
        activeDrag = -1;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  });

  $$('.scan-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter || 'bw';
      renderChips();
    });
  });

  el.close.addEventListener('click', close);
  el.shutter.addEventListener('click', capture);
  el.gallery.addEventListener('click', openGallery);
  el.galleryError.addEventListener('click', openGallery);
  el.retryCam.addEventListener('click', showCamera);
  el.retake.addEventListener('click', showCamera);
  el.accept.addEventListener('click', acceptCrop);
  el.again.addEventListener('click', showCamera);
  el.build.addEventListener('click', buildPdf);

  el.done.addEventListener('click', () => {
    if (!pages.length) {
      if (api) api.toast('Belum ada halaman yang dipindai');
      return;
    }
    showPages();
  });

  el.file.addEventListener('change', () => {
    const file = el.file.files && el.file.files[0];
    el.file.value = '';
    if (file) loadImageFile(file);
  });

  el.torch.addEventListener('click', async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      torchOn = next;
      el.torch.classList.toggle('active', torchOn);
    } catch (err) {
      console.warn('Senter tidak didukung', err);
    }
  });

  el.flip.addEventListener('click', () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (mode !== 'crop') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutCrop, 150);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.root.hidden) return;
    e.preventDefault();
    handleBack();
  });

  /* ----------------------------- Init ------------------------------- */

  function init(callbacks) {
    api = callbacks || null;
  }

  window.DocScanner = {
    init,
    open: openScanner,
    handleBack,
  };
})();
