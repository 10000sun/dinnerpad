const { app, BrowserWindow, Menu, Tray, nativeImage, globalShortcut, ipcMain, dialog, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { normalize } = require('./config');

// 포터블 빌드는 실행 파일 옆 data 폴더에, 그 외에는 사용자 AppData에 저장한다
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) app.setPath('userData', path.join(portableDir, 'data'));
const dataDir = app.getPath('userData');
const soundsDir = path.join(dataDir, 'sounds');
const configFile = path.join(dataDir, 'config.json');

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
let tray;
let quitting = false;
let failed = [];
const iconPath = path.join(__dirname, 'icon.png');
const REPO_URL = 'https://github.com/10000sun/dinnerpad';
const startHidden = process.argv.includes('--hidden'); // 시작 프로그램으로 실행되면 트레이로 시작

// 포터블은 실행 때마다 임시 폴더에 풀리므로 원본 exe 경로를 등록한다
const loginOpts = () => ({ path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--hidden'] });

function persist() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configFile + '.tmp', JSON.stringify(cfg, null, 2));
  fs.renameSync(configFile + '.tmp', configFile);
}

function register() {
  globalShortcut.unregisterAll();
  const bad = [];
  if (!cfg.hotkeys) return bad;
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

// 개발 모드(electron.exe)를 시작 프로그램에 등록하지 않도록 패키징된 앱에서만 허용한다
ipcMain.handle('autostart:get', () => ({
  supported: app.isPackaged,
  enabled: app.isPackaged && app.getLoginItemSettings(loginOpts()).openAtLogin,
}));
ipcMain.handle('autostart:set', (_, on) => {
  if (!app.isPackaged) return false;
  app.setLoginItemSettings({ openAtLogin: !!on, ...loginOpts() });
  return app.getLoginItemSettings(loginOpts()).openAtLogin;
});
ipcMain.handle('repo:open', () => shell.openExternal(REPO_URL)); // 주소는 고정값만 연다

ipcMain.handle('state', () => ({
  version: app.getVersion(),
  repoUrl: REPO_URL,
  config: cfg,
  soundsUrl: pathToFileURL(soundsDir).href + '/',
  failed,
}));

ipcMain.handle('save', (_, c) => {
  cfg = normalize(c);
  persist();
  sweep();
  if (win) win.setAlwaysOnTop(cfg.alwaysOnTop);
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

const quit = () => {
  quitting = true;
  app.quit();
};

function showWin() {
  if (tray) { tray.destroy(); tray = null; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// 트레이 메뉴에서 상단 바 토글과 같은 상태를 보고 바꾼다
function trayMenu() {
  const flip = (key) => () => {
    cfg[key] = !cfg[key];
    persist();
    if (key === 'alwaysOnTop') win.setAlwaysOnTop(cfg.alwaysOnTop);
    if (key === 'hotkeys') failed = register();
    win.webContents.send('config-patch', { [key]: cfg[key], failed }); // 렌더러가 들고 있는 설정도 맞춘다
    tray.setContextMenu(trayMenu());
  };
  const hasMic = !!cfg.mic.id;
  return Menu.buildFromTemplate([
    { label: '열기', click: showWin },
    { type: 'separator' },
    { label: hasMic ? '마이크 전송' : '마이크 전송 (장치 미선택)', type: 'checkbox', checked: hasMic && cfg.micOn, enabled: hasMic, click: flip('micOn') },
    { label: '전역 단축키', type: 'checkbox', checked: cfg.hotkeys, click: flip('hotkeys') },
    { label: '항상 위', type: 'checkbox', checked: cfg.alwaysOnTop, click: flip('alwaysOnTop') },
    { type: 'separator' },
    { label: '종료', click: quit },
  ]);
}

// 창만 숨기고 프로세스는 남겨 둔다. 전역 단축키는 계속 동작한다
function toTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
    tray.setToolTip('Dinnerpad');
    tray.on('click', showWin);
  }
  tray.setContextMenu(trayMenu()); // 열 때마다 최신 상태로
  win.hide();
}

async function onClose() {
  if (cfg.closeAction === 'quit') return quit();
  if (cfg.closeAction === 'tray') return toTray();
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['트레이로 보내기', '종료', '취소'],
    defaultId: 0,
    cancelId: 2,
    message: '창을 닫으면 어떻게 할까요?',
    detail: '트레이로 보내면 단축키가 계속 동작합니다. 트레이 아이콘을 우클릭해 종료할 수 있습니다.',
    checkboxLabel: '다시 묻지 않기',
  });
  if (r.response === 2) return;
  if (r.checkboxChecked) {
    cfg.closeAction = r.response === 0 ? 'tray' : 'quit';
    persist();
    win.webContents.send('config-patch', { closeAction: cfg.closeAction });
  }
  if (r.response === 0) toTray(); else quit();
}

function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 840,
    minWidth: 680,
    minHeight: 660,
    backgroundColor: '#101116',
    alwaysOnTop: cfg.alwaysOnTop,
    icon: iconPath,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // 창이 가려져도 단축키로 즉시 재생
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    onClose();
  });
  win.on('query-session-end', () => { quitting = true; }); // Windows 종료·로그오프를 막지 않는다
  win.loadFile('index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && showWin());
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_, permission, cb) => cb(permission === 'media')); // 마이크 외 권한은 거부
    failed = register();
    createWindow();
    if (startHidden) toTray();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
