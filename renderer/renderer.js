// ─── State ───────────────────────────────────────────────────
let currentDir = '';
let selectedFile = null;
let videoInfo = null;
let trimStart = 0;
let trimEnd = 0;
let isDraggingStart = false;
let isDraggingEnd = false;
let isDraggingPlayhead = false;
let queue = [];
let isConverting = false;

// ─── DOM refs ────────────────────────────────────────────────
const breadcrumbsEl = document.getElementById('breadcrumbs');
const fileListEl = document.getElementById('file-list');
const videoEl = document.getElementById('preview-video');
const videoPlaceholder = document.getElementById('video-placeholder');
const timelineCanvas = document.getElementById('timeline-canvas');
const tlCtx = timelineCanvas.getContext('2d');
const playheadEl = document.getElementById('timeline-playhead');
const trimStartLabel = document.getElementById('trim-start-label');
const trimEndLabel = document.getElementById('trim-end-label');
const trimDurationLabel = document.getElementById('trim-duration-label');
const currentTimeLabel = document.getElementById('current-time-label');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnSend = document.getElementById('btn-send');
const queueListEl = document.getElementById('queue-list');
const queueEmptyEl = document.getElementById('queue-empty');
const btnShop = document.getElementById('btn-shop');
const loadingOverlay = document.getElementById('loading-overlay');
const retroCanvas = document.getElementById('retro-canvas');
const loadingFileEl = document.getElementById('loading-file');
const loadingCountEl = document.getElementById('loading-count');

// ─── Init ────────────────────────────────────────────────────
async function init() {
  const downloadsDir = await window.api.getDownloadsDir();
  navigateTo(downloadsDir);

  window.api.onConversionProgress(({ jobId, progress }) => {
    updateQueueItemProgress(jobId, progress);
  });
}

// ─── Directory Navigation ────────────────────────────────────
async function navigateTo(dir) {
  currentDir = dir;
  renderBreadcrumbs(dir);
  const result = await window.api.readDirectory(dir);
  if (result.ok) {
    renderFileList(result.entries);
  } else {
    fileListEl.innerHTML = `<div style="padding:12px;color:#555;font-size:10px;">Cannot read folder</div>`;
  }
}

function renderBreadcrumbs(dir) {
  const parts = dir.split('/').filter(Boolean);
  breadcrumbsEl.innerHTML = '';

  // Build display segments: skip 'Users', collapse username to '~'
  const segments = []; // { label, path }
  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    accumulated += '/' + parts[i];
    if (i === 0 && parts[i] === 'Users') continue; // hide 'Users'
    const label = (i === 1 && parts[0] === 'Users') ? '~' : parts[i];
    segments.push({ label, path: accumulated });
  }

  segments.forEach((seg, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      breadcrumbsEl.appendChild(sep);
    }
    const crumb = document.createElement('span');
    const isLast = idx === segments.length - 1;
    crumb.className = 'breadcrumb' + (isLast ? ' active' : '');
    crumb.textContent = seg.label;
    crumb.title = seg.path;
    if (!isLast) crumb.addEventListener('click', () => navigateTo(seg.path));
    breadcrumbsEl.appendChild(crumb);
  });
}

function renderFileList(entries) {
  fileListEl.innerHTML = '';

  if (entries.length === 0) {
    fileListEl.innerHTML = '<div style="padding:16px 12px;color:#444;font-size:10px;text-align:center;">No videos here</div>';
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'file-item ' + entry.type;

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = entry.type === 'directory' ? '▸' : '▶';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;
    name.title = entry.name;

    item.appendChild(icon);
    item.appendChild(name);

    if (entry.type === 'directory') {
      item.addEventListener('click', () => navigateTo(entry.path));
    } else {
      item.addEventListener('click', () => selectVideo(entry, item));
    }

    fileListEl.appendChild(item);
  }
}

// ─── Video Selection ─────────────────────────────────────────
async function selectVideo(entry, itemEl) {
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
  itemEl.classList.add('selected');

  selectedFile = entry;
  btnSend.disabled = true;

  videoEl.style.display = 'none';
  videoPlaceholder.style.display = 'flex';

  const info = await window.api.getVideoInfo(entry.path);
  if (!info.ok) {
    console.error('Could not get video info:', info.error);
    return;
  }

  videoInfo = info;
  trimStart = 0;
  trimEnd = info.duration;

  videoEl.src = `file://${entry.path}`;
  videoEl.style.display = 'block';
  videoPlaceholder.style.display = 'none';

  updateTrimLabels();
  drawTimeline();
  btnSend.disabled = false;
}

// ─── Timeline ────────────────────────────────────────────────
function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3).padStart(6, '0');
  return `${m}:${sec}`;
}

function updateTrimLabels() {
  trimStartLabel.textContent = `Start: ${formatTime(trimStart)}`;
  trimEndLabel.textContent = `End: ${formatTime(trimEnd)}`;
  const dur = trimEnd - trimStart;
  trimDurationLabel.textContent = dur > 0 ? `Duration: ${formatTime(dur)}` : '—';
}

function resizeCanvas() {
  const rect = timelineCanvas.parentElement.getBoundingClientRect();
  timelineCanvas.width = rect.width;
  timelineCanvas.height = rect.height;
}

function drawTimeline() {
  if (!videoInfo) return;
  resizeCanvas();

  const W = timelineCanvas.width;
  const H = timelineCanvas.height;
  const dur = videoInfo.duration;
  const startX = (trimStart / dur) * W;
  const endX = (trimEnd / dur) * W;

  tlCtx.clearRect(0, 0, W, H);

  // Background
  tlCtx.fillStyle = '#0a0a0a';
  tlCtx.fillRect(0, 0, W, H);

  // Unselected regions (dimmed)
  tlCtx.fillStyle = 'rgba(0,0,0,0.6)';
  tlCtx.fillRect(0, 0, startX, H);
  tlCtx.fillRect(endX, 0, W - endX, H);

  // Selected region
  tlCtx.fillStyle = 'rgba(232,255,0,0.08)';
  tlCtx.fillRect(startX, 0, endX - startX, H);

  // Tick marks
  tlCtx.strokeStyle = '#2a2a2a';
  tlCtx.lineWidth = 1;
  const tickInterval = Math.max(1, Math.ceil(dur / 20));
  for (let t = 0; t <= dur; t += tickInterval) {
    const x = Math.round((t / dur) * W);
    tlCtx.beginPath();
    tlCtx.moveTo(x, H - 8);
    tlCtx.lineTo(x, H);
    tlCtx.stroke();
  }

  // Start handle
  tlCtx.fillStyle = '#e8ff00';
  tlCtx.fillRect(startX - 2, 0, 4, H);
  // Handle triangle
  tlCtx.fillStyle = '#e8ff00';
  tlCtx.beginPath();
  tlCtx.moveTo(startX - 2, 0);
  tlCtx.lineTo(startX + 8, 0);
  tlCtx.lineTo(startX - 2, 14);
  tlCtx.fill();

  // End handle
  tlCtx.fillStyle = '#e8ff00';
  tlCtx.fillRect(endX - 2, 0, 4, H);
  tlCtx.beginPath();
  tlCtx.moveTo(endX + 2, 0);
  tlCtx.lineTo(endX - 8, 0);
  tlCtx.lineTo(endX + 2, 14);
  tlCtx.fill();

  // Playhead
  if (!isNaN(videoEl.currentTime)) {
    const px = (videoEl.currentTime / dur) * W;
    playheadEl.style.left = px + 'px';
    playheadEl.style.display = 'block';
  }
}

// Timeline mouse interaction
const timelineContainer = document.getElementById('timeline-container');

function getTimeFromX(x) {
  const rect = timelineCanvas.getBoundingClientRect();
  const rel = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  return rel * (videoInfo ? videoInfo.duration : 0);
}

function getHandleAt(x) {
  if (!videoInfo) return null;
  const rect = timelineCanvas.getBoundingClientRect();
  const W = rect.width;
  const startX = rect.left + (trimStart / videoInfo.duration) * W;
  const endX = rect.left + (trimEnd / videoInfo.duration) * W;
  if (Math.abs(x - startX) < 12) return 'start';
  if (Math.abs(x - endX) < 12) return 'end';
  return null;
}

timelineContainer.addEventListener('mousedown', (e) => {
  if (!videoInfo) return;
  const handle = getHandleAt(e.clientX);
  if (handle === 'start') isDraggingStart = true;
  else if (handle === 'end') isDraggingEnd = true;
  else {
    isDraggingPlayhead = true;
    const t = getTimeFromX(e.clientX);
    videoEl.currentTime = t;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!videoInfo) return;
  if (isDraggingStart) {
    const t = Math.max(0, Math.min(trimEnd - 0.1, getTimeFromX(e.clientX)));
    trimStart = t;
    updateTrimLabels();
    drawTimeline();
  } else if (isDraggingEnd) {
    const t = Math.min(videoInfo.duration, Math.max(trimStart + 0.1, getTimeFromX(e.clientX)));
    trimEnd = t;
    updateTrimLabels();
    drawTimeline();
  } else if (isDraggingPlayhead) {
    const t = Math.max(0, Math.min(videoInfo.duration, getTimeFromX(e.clientX)));
    videoEl.currentTime = t;
  }

  // Cursor
  const handle = getHandleAt(e.clientX);
  if (handle) timelineContainer.style.cursor = 'ew-resize';
  else timelineContainer.style.cursor = 'crosshair';
});

document.addEventListener('mouseup', () => {
  isDraggingStart = false;
  isDraggingEnd = false;
  isDraggingPlayhead = false;
});

// ─── Video Playback ──────────────────────────────────────────
btnPlayPause.addEventListener('click', () => {
  if (!videoEl.src) return;
  if (videoEl.paused) {
    if (videoEl.currentTime >= trimEnd) videoEl.currentTime = trimStart;
    videoEl.play();
  } else {
    videoEl.pause();
  }
});

videoEl.addEventListener('play', () => { btnPlayPause.textContent = '⏸'; });
videoEl.addEventListener('pause', () => { btnPlayPause.textContent = '▶'; });

videoEl.addEventListener('timeupdate', () => {
  if (!videoInfo) return;
  currentTimeLabel.textContent = formatTime(videoEl.currentTime);
  drawTimeline();
  if (videoEl.currentTime >= trimEnd) {
    videoEl.pause();
    videoEl.currentTime = trimStart;
  }
});

// ─── Send to Garage ──────────────────────────────────────────
btnSend.addEventListener('click', async () => {
  if (!selectedFile || !videoInfo || isConverting) return;

  btnSend.disabled = true;
  btnSend.textContent = 'TRIMMING...';

  const result = await window.api.trimVideo({
    inputPath: selectedFile.path,
    startTime: trimStart,
    endTime: trimEnd,
  });

  btnSend.textContent = 'SEND TO GARAGE';
  btnSend.disabled = false;

  if (!result.ok) {
    console.error('Trim failed:', result.error);
    return;
  }

  const trimmedDuration = trimEnd - trimStart;
  const estimatedSecs = estimateConversionTime(trimmedDuration, videoInfo.width, videoInfo.height);

  const jobId = Date.now() + Math.random();
  queue.push({
    id: jobId,
    name: result.outputPath.split('/').pop(),
    path: result.outputPath,
    duration: trimmedDuration,
    width: videoInfo.width,
    height: videoInfo.height,
    estimatedSecs,
    progress: 0,
    done: false,
  });

  renderQueue();
  btnShop.disabled = queue.length === 0;
});

function estimateConversionTime(durationSec, width, height) {
  // Rough estimate: longer clips + higher res = more time
  let factor = 2;
  if (height >= 1080) factor = 6;
  else if (height >= 720) factor = 4;
  else if (height >= 480) factor = 2.5;
  return Math.max(1, Math.round(durationSec * factor));
}

function formatEstimate(secs) {
  if (secs < 60) return `~${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `~${m}m ${s}s`;
}

// ─── Queue ───────────────────────────────────────────────────
function renderQueue() {
  queueListEl.innerHTML = '';

  if (queue.length === 0) {
    queueListEl.appendChild(queueEmptyEl);
    queueEmptyEl.style.display = 'block';
    return;
  }

  queueEmptyEl.style.display = 'none';

  queue.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'queue-item' + (item.done ? ' done' : '');
    el.dataset.id = item.id;

    el.innerHTML = `
      <span class="queue-item-name" title="${item.name}">${item.name}</span>
      <div class="queue-item-meta">
        <span class="queue-item-time">${formatEstimate(item.estimatedSecs)}</span>
        <span class="queue-item-size">${item.width}×${item.height} · ${formatTime(item.duration)}</span>
      </div>
      <div class="queue-item-progress">
        <div class="queue-item-progress-bar" style="width:${item.done ? 100 : Math.round(item.progress * 100)}%"></div>
      </div>
      ${!item.done && !isConverting ? `<button class="queue-item-remove" data-id="${item.id}">×</button>` : ''}
    `;

    queueListEl.appendChild(el);
  });

  // Remove buttons
  queueListEl.querySelectorAll('.queue-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseFloat(btn.dataset.id);
      queue = queue.filter(q => q.id !== id);
      renderQueue();
      btnShop.disabled = queue.length === 0;
    });
  });
}

function updateQueueItemProgress(jobId, progress) {
  const item = queue.find(q => q.id === jobId);
  if (item) {
    item.progress = progress;
    const el = queueListEl.querySelector(`[data-id="${jobId}"] .queue-item-progress-bar`);
    if (el) el.style.width = Math.round(progress * 100) + '%';
  }

  // Update retro animation progress
  const total = queue.length;
  const doneCount = queue.filter(q => q.done).length;
  const current = queue.find(q => !q.done && q.id === jobId);
  const overallProgress = (doneCount + (current ? current.progress : 0)) / total;
  retroProgress = overallProgress;
}

// ─── Shop's Open (Convert) ───────────────────────────────────
btnShop.addEventListener('click', async () => {
  if (queue.length === 0 || isConverting) return;
  isConverting = true;
  btnShop.disabled = true;
  btnSend.disabled = true;

  showLoadingOverlay();
  startRetroAnimation();

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.done) continue;

    loadingFileEl.textContent = item.name;
    loadingCountEl.textContent = `${i + 1} / ${queue.length}`;

    const outputName = item.name.replace(/\.[^.]+$/, '.gif');
    const result = await window.api.convertToGifWithProgress({
      inputPath: item.path,
      startTime: 0,
      endTime: item.duration,
      outputName,
      jobId: item.id,
    });

    item.done = true;
    item.progress = 1;
    renderQueue();
  }

  stopRetroAnimation();
  hideLoadingOverlay();

  isConverting = false;
  btnShop.disabled = queue.length === 0 || queue.every(q => q.done);
  btnSend.disabled = !selectedFile;
});

function showLoadingOverlay() {
  loadingOverlay.style.display = 'flex';
  document.getElementById('app').style.opacity = '0.5';
  document.getElementById('titlebar').style.opacity = '0.5';
}

function hideLoadingOverlay() {
  loadingOverlay.style.display = 'none';
  document.getElementById('app').style.opacity = '1';
  document.getElementById('titlebar').style.opacity = '1';
}

// ─── Retro Pixel Animation ───────────────────────────────────
let retroAnimFrame = null;
let retroProgress = 0;
let retroTick = 0;

const PIXEL = 4; // pixel size in screen px
const CANVAS_W = 400;
const CANVAS_H = 180;

// Pixel art car (10 cols × 6 rows) — each entry is [r, g, b, a]
const CAR = [
  // row 0
  [0,0,0,0],[0,0,0,0],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0,0,0,0],[0,0,0,0],
  // row 1
  [0,0,0,0],[0xe8,0xff,0x00,255],[0x80,0x90,0x00,255],[0x80,0x90,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0x80,0x90,0x00,255],[0x80,0x90,0x00,255],[0xe8,0xff,0x00,255],[0,0,0,0],
  // row 2
  [0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],
  // row 3
  [0x44,0x44,0x44,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0xe8,0xff,0x00,255],[0x44,0x44,0x44,255],
  // row 4
  [0,0,0,0],[0x22,0x22,0x22,255],[0xff,0x44,0x00,255],[0x22,0x22,0x22,255],[0,0,0,0],[0,0,0,0],[0x22,0x22,0x22,255],[0xff,0x44,0x00,255],[0x22,0x22,0x22,255],[0,0,0,0],
];

const CAR_COLS = 10;
const CAR_ROWS = 5;

function drawRetroFrame() {
  const rCtx = retroCanvas.getContext('2d');
  const W = CANVAS_W;
  const H = CANVAS_H;
  retroCanvas.width = W;
  retroCanvas.height = H;
  retroCanvas.style.width = W + 'px';
  retroCanvas.style.height = H + 'px';

  // Background
  rCtx.fillStyle = '#000';
  rCtx.fillRect(0, 0, W, H);

  // Scanlines
  rCtx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < H; y += 2) {
    rCtx.fillRect(0, y, W, 1);
  }

  // Stars / dots
  const stars = [[12,8],[50,15],[120,5],[200,22],[300,10],[370,18],[80,30],[250,28],[340,6]];
  rCtx.fillStyle = retroTick % 60 < 30 ? '#ffffff33' : '#ffffff66';
  for (const [sx, sy] of stars) {
    rCtx.fillRect(sx, sy, PIXEL, PIXEL);
  }

  // Ground line
  const groundY = H - 48;
  rCtx.fillStyle = '#222';
  rCtx.fillRect(0, groundY, W, 2);

  // Road dashes (scrolling)
  const dashW = 20;
  const gapW = 14;
  const scrollOffset = (retroTick * 3) % (dashW + gapW);
  rCtx.fillStyle = '#333';
  for (let x = -scrollOffset; x < W; x += dashW + gapW) {
    rCtx.fillRect(x, groundY + 8, dashW, 2);
  }

  // Progress bar track
  const barX = 16;
  const barY = H - 24;
  const barW = W - 32;
  const barH = 12;
  rCtx.fillStyle = '#1a1a1a';
  rCtx.fillRect(barX, barY, barW, barH);

  // Progress blocks (pixelated fill)
  const blockW = PIXEL;
  const filled = Math.round(retroProgress * (barW / blockW));
  rCtx.fillStyle = '#e8ff00';
  for (let i = 0; i < filled; i++) {
    const shade = i % 2 === 0 ? '#e8ff00' : '#b8cc00';
    rCtx.fillStyle = shade;
    rCtx.fillRect(barX + i * blockW, barY, blockW, barH);
  }

  // Bar border
  rCtx.strokeStyle = '#333';
  rCtx.lineWidth = 1;
  rCtx.strokeRect(barX, barY, barW, barH);

  // Progress percentage text (pixel-ish)
  rCtx.fillStyle = retroProgress > 0.5 ? '#000' : '#e8ff00';
  rCtx.font = `bold ${PIXEL * 2}px monospace`;
  rCtx.textAlign = 'center';
  rCtx.fillText(`${Math.round(retroProgress * 100)}%`, barX + barW / 2, barY + barH - 2);

  // Car position along the ground
  const carGridW = CAR_COLS * PIXEL;
  const carGridH = CAR_ROWS * PIXEL;
  const carMaxX = W - carGridW - 16;
  const carX = Math.round(16 + retroProgress * carMaxX);
  const carY = groundY - carGridH;

  // Wheel bob animation
  const bob = retroTick % 6 < 3 ? 0 : 1;

  // Draw car pixels
  for (let row = 0; row < CAR_ROWS; row++) {
    for (let col = 0; col < CAR_COLS; col++) {
      const [r, g, b, a] = CAR[row * CAR_COLS + col];
      if (a === 0) continue;
      rCtx.fillStyle = `rgb(${r},${g},${b})`;
      rCtx.fillRect(carX + col * PIXEL, carY + row * PIXEL + bob, PIXEL, PIXEL);
    }
  }

  // Exhaust puff
  if (retroTick % 8 < 4) {
    rCtx.fillStyle = 'rgba(200,200,200,0.4)';
    rCtx.fillRect(carX - PIXEL * 2, carY + PIXEL * 2, PIXEL, PIXEL);
    rCtx.fillRect(carX - PIXEL * 3, carY + PIXEL * 3, PIXEL * 2, PIXEL);
  }

  retroTick++;
}

function startRetroAnimation() {
  retroTick = 0;
  retroProgress = 0;
  const loop = () => {
    drawRetroFrame();
    retroAnimFrame = requestAnimationFrame(loop);
  };
  retroAnimFrame = requestAnimationFrame(loop);
}

function stopRetroAnimation() {
  if (retroAnimFrame) {
    cancelAnimationFrame(retroAnimFrame);
    retroAnimFrame = null;
  }
}

// ─── Window resize ───────────────────────────────────────────
window.addEventListener('resize', () => {
  if (videoInfo) drawTimeline();
});

// ─── Boot ────────────────────────────────────────────────────
init();
