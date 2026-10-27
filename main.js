const { app, BrowserWindow, Menu, globalShortcut, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// 포터블 빌드는 실행 파일 옆 data 폴더에, 그 외에는 사용자 AppData에 저장한다
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) app.setPath('userData', path.join(portableDir, 'data'));
const dataDir = app.getPath('userData');
const soundsDir = path.join(dataDir, 'sounds');
const configFile = path.join(dataDir, 'config.json');
const SIZE = 25;

function normalize(c = {}) {
  const pads = Array.from({ length: SIZE }, (_, i) => {
    const p = c.pads && c.pads[i];
    if (!p || typeof p.file !== 'string' || !p.file) return null;
    return {
      name: String(p.name || '').slice(0, 40),
      file: path.basename(p.file), // 경로 이탈 방지
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#3b82f6',
      key: typeof p.key === 'string' ? p.key : '',
    };
  });
  const d = c.device || {};
  return { device: { id: String(d.id || ''), label: String(d.label || '') }, pads };
}

function load() {
  try {
    return normalize(JSON.parse(fs.readFileSync(configFile, 'utf8')));
  } catch {
    // 파일이 있는데 못 읽은 경우: 다음 저장이 덮어쓰기 전에 백업해 둔다
    if (fs.existsSync(configFile)) fs.copyFileSync(configFile, configFile + '.bak');
    return normalize();
  }
}

let cfg = load();
let win;
let failed = [];

function register() {
  globalShortcut.unregisterAll();
  const bad = [];
  cfg.pads.forEach((p, i) => {
    if (!p || !p.key) return;
    let ok = false;
    try {
      ok = globalShortcut.register(p.key, () => win && win.webContents.send('play', i));
    } catch { /* 잘못된 가속기 문자열 */ }
    if (!ok) bad.push(i); // 다른 프로그램이 이미 쓰는 조합 등
  });
  return bad;
}

// 설정에서 빠진 사운드 파일 정리
function sweep() {
  const used = new Set(cfg.pads.filter(Boolean).map((p) => p.file));
  if (!fs.existsSync(soundsDir)) return;
  for (const f of fs.readdirSync(soundsDir)) if (!used.has(f)) fs.rmSync(path.join(soundsDir, f), { force: true });
}

ipcMain.handle('state', () => ({
  config: cfg,
  soundsUrl: pathToFileURL(soundsDir).href + '/',
  failed,
}));

ipcMain.handle('save', (_, c) => {
  cfg = normalize(c);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configFile + '.tmp', JSON.stringify(cfg, null, 2));
  fs.renameSync(configFile + '.tmp', configFile);
  sweep();
  return (failed = register());
});

// 단축키 입력을 받는 동안에는 등록된 조합이 앱에 도달하지 못하므로 잠시 해제한다
ipcMain.handle('hotkeys', (_, on) => {
  if (!on) {
    globalShortcut.unregisterAll();
    return [];
  }
  return (failed = register());
});

ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '오디오', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus'] }],
  });
  if (r.canceled) return null;
  const src = r.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  const file = Date.now() + ext;
  fs.mkdirSync(soundsDir, { recursive: true });
  fs.copyFileSync(src, path.join(soundsDir, file));
  return { file, name: path.basename(src, path.extname(src)) };
});

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 800,
    minWidth: 480,
    minHeight: 620,
    backgroundColor: '#14151a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // 창이 가려져도 단축키로 즉시 재생
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile('index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    failed = register();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
