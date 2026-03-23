const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const os = require('os');

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const GIF_GARAGE_DIR = path.join(os.homedir(), 'Documents', 'fmm-garage', 'gif-garage');

// Ensure gif-garage directory exists
if (!fs.existsSync(GIF_GARAGE_DIR)) {
  fs.mkdirSync(GIF_GARAGE_DIR, { recursive: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC Handlers ───────────────────────────────────────────

ipcMain.handle('read-directory', async (event, dirPath) => {
  const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.ts', '.mts']);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        result.push({ name: entry.name, type: 'directory', path: path.join(dirPath, entry.name) });
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTS.has(ext)) {
          const fullPath = path.join(dirPath, entry.name);
          const stat = fs.statSync(fullPath);
          result.push({ name: entry.name, type: 'video', path: fullPath, size: stat.size, mtime: stat.mtimeMs });
        }
      }
    }
    // Return unsorted — renderer handles sort order
    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return 0;
    });
    return { ok: true, entries: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-video-info', async (event, filePath) => {
  return new Promise((resolve) => {
    execFile(FFPROBE, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ], (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams.find(s => s.codec_type === 'video');
        const duration = parseFloat(data.format.duration) || 0;
        const width = videoStream ? videoStream.width : 0;
        const height = videoStream ? videoStream.height : 0;
        const size = parseInt(data.format.size) || 0;
        resolve({ ok: true, duration, width, height, size });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  });
});

ipcMain.handle('trim-video', async (event, { inputPath, startTime, endTime }) => {
  const ext = path.extname(inputPath);
  // Strip any existing _trimmed suffix so we don't stack them
  const rawBase = path.basename(inputPath, ext).replace(/_trimmed$/, '');
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${rawBase}_trimmed${ext}`);

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-ss', String(startTime),
      '-to', String(endTime),
      '-i', inputPath,
      '-c', 'copy',
      outputPath
    ];
    const proc = spawn(FFMPEG, args);
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true, outputPath });
      else resolve({ ok: false, error: `ffmpeg exited with code ${code}` });
    });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
});

ipcMain.handle('convert-to-gif', async (event, { inputPath, startTime, endTime, outputName }) => {
  const outputPath = path.join(GIF_GARAGE_DIR, outputName.replace(/\.[^.]+$/, '.gif'));

  // Resolution targets to try (in order) to stay under 50MB
  const targets = [
    { scale: 480, fps: 15, colors: 256 },
    { scale: 360, fps: 12, colors: 128 },
    { scale: 240, fps: 10, colors: 64 },
  ];

  const duration = endTime - startTime;

  const tryConvert = async (target) => {
    const palettePath = path.join(os.tmpdir(), `palette_${Date.now()}.png`);
    const { scale, fps, colors } = target;
    const filterBase = `fps=${fps},scale=${scale}:-1:flags=lanczos`;

    // Pass 1: generate palette
    await new Promise((res, rej) => {
      const args = [
        '-y',
        '-ss', String(startTime),
        '-t', String(duration),
        '-i', inputPath,
        '-vf', `${filterBase},palettegen=max_colors=${colors}`,
        palettePath
      ];
      const p = spawn(FFMPEG, args);
      p.on('close', c => c === 0 ? res() : rej(new Error(`palette gen failed: ${c}`)));
      p.on('error', rej);
    });

    // Pass 2: convert with palette
    await new Promise((res, rej) => {
      const args = [
        '-y',
        '-ss', String(startTime),
        '-t', String(duration),
        '-i', inputPath,
        '-i', palettePath,
        '-lavfi', `${filterBase} [x]; [x][1:v] paletteuse=dither=bayer`,
        outputPath
      ];
      const p = spawn(FFMPEG, args);
      p.on('close', c => c === 0 ? res() : rej(new Error(`gif convert failed: ${c}`)));
      p.on('error', rej);
    });

    // Cleanup palette
    try { fs.unlinkSync(palettePath); } catch (_) {}

    // Check size
    const stat = fs.statSync(outputPath);
    return stat.size;
  };

  for (const target of targets) {
    try {
      const size = await tryConvert(target);
      if (size <= 50 * 1024 * 1024) {
        return { ok: true, outputPath, size };
      }
    } catch (e) {
      // try next resolution
    }
  }

  // If we're here, even smallest failed or file still too big
  const stat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
  if (stat && stat.size <= 50 * 1024 * 1024) {
    return { ok: true, outputPath, size: stat.size };
  }
  return { ok: true, outputPath, size: stat ? stat.size : 0, warning: 'Could not get under 50MB even at lowest quality' };
});

ipcMain.handle('convert-to-gif-with-progress', async (event, { inputPath, startTime, endTime, outputName, jobId }) => {
  const outputPath = path.join(GIF_GARAGE_DIR, outputName.replace(/\.[^.]+$/, '.gif'));
  const targets = [
    { scale: 480, fps: 15, colors: 256 },
    { scale: 360, fps: 12, colors: 128 },
    { scale: 240, fps: 10, colors: 64 },
  ];
  const duration = endTime - startTime;

  const win = BrowserWindow.getAllWindows()[0];

  const tryConvert = (target) => new Promise(async (resolve, reject) => {
    const palettePath = path.join(os.tmpdir(), `palette_${Date.now()}.png`);
    const { scale, fps, colors } = target;
    const filterBase = `fps=${fps},scale=${scale}:-1:flags=lanczos`;

    // Pass 1: palette
    await new Promise((res, rej) => {
      const args = ['-y', '-ss', String(startTime), '-t', String(duration), '-i', inputPath,
        '-vf', `${filterBase},palettegen=max_colors=${colors}`, palettePath];
      const p = spawn(FFMPEG, args);
      p.on('close', c => c === 0 ? res() : rej(new Error('palette failed')));
      p.on('error', rej);
    });

    // Pass 2: gif with progress reporting — parse time= from ffmpeg stderr
    await new Promise((res, rej) => {
      const args = ['-y', '-ss', String(startTime), '-t', String(duration), '-i', inputPath,
        '-i', palettePath,
        '-lavfi', `${filterBase} [x]; [x][1:v] paletteuse=dither=bayer`,
        outputPath];
      const p = spawn(FFMPEG, args);

      p.stderr.on('data', (data) => {
        const str = data.toString();
        // Parse standard ffmpeg progress: time=HH:MM:SS.ss
        const timeMatch = str.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (timeMatch && win) {
          const h = parseInt(timeMatch[1]);
          const m = parseInt(timeMatch[2]);
          const s = parseFloat(timeMatch[3]);
          const elapsedSec = h * 3600 + m * 60 + s;
          const progress = Math.min(elapsedSec / duration, 1);
          win.webContents.send('conversion-progress', { jobId, progress });
        }
      });

      p.on('close', c => c === 0 ? res() : rej(new Error('gif convert failed')));
      p.on('error', rej);
    });

    try { fs.unlinkSync(palettePath); } catch (_) {}

    const stat = fs.statSync(outputPath);
    resolve(stat.size);
  });

  for (const target of targets) {
    try {
      const size = await tryConvert(target);
      if (size <= 50 * 1024 * 1024) {
        return { ok: true, outputPath, size };
      }
    } catch (_) {}
  }

  const stat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
  return { ok: true, outputPath, size: stat ? stat.size : 0 };
});

ipcMain.handle('get-home-dir', () => os.homedir());
ipcMain.handle('get-downloads-dir', () => path.join(os.homedir(), 'Downloads'));
ipcMain.handle('get-gif-garage-dir', () => GIF_GARAGE_DIR);
