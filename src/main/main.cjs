// Claude Buddy — 트레이에 상주하며 내장 서버로 훅을 받고, 필요할 때만 위젯·펫 창을 띄운다.
// 가볍게: GPU 프로세스를 끄고, 닫은 창은 5분 뒤 렌더러째 정리한다(트레이만 남는다).
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, session, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const P = require('./paths.cjs');
const { readJson, writeJson } = require('./store.cjs');
const { startServer } = require('./server.cjs');
const connect = require('./connect.cjs');
const { stopWorker } = require('./focus.cjs');
const editors = require('./editors.cjs');
const pkg = require('../../package.json');

const ORIGIN = `http://127.0.0.1:${P.PORT}`;
const ICON = path.join(__dirname, '..', 'renderer', 'icon.png');
const STATE = () => path.join(app.getPath('userData'), 'window.json');
const HIDDEN = process.argv.includes('--hidden');

app.disableHardwareAcceleration();
// 트레이만 있을 때 뜨는 보조 프로세스를 줄인다: GPU·네트워크 서비스는 메인 안에서, 여분 렌더러는 미리 띄우지 않음
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,CalculateNativeWinOcclusion');
app.setAppUserModelId('io.github.soooru.claude-buddy');

// 설치 프로그램이 제거할 때 부른다 — settings.json 에서 우리 항목만 빼고 끝낸다
const DISCONNECT = process.argv.includes('--disconnect');
if (DISCONNECT) {
  try { connect.disconnect(); } catch {}
  try { app.setLoginItemSettings({ openAtLogin: false, args: ['--hidden'] }); } catch {}
  editors.uninstallAll().catch(() => {}).finally(() => app.exit(0));
}

let tray = null;
let widget = null;
let petWin = null;
let setupWin = null;

// 설치 폴더의 PowerShell 스크립트를 데이터 폴더로 복사한다 — 상태줄 경로가 설치 위치·업데이트와 무관하게 고정된다
function installScripts() {
  const src = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', '..', 'resources');
  fs.mkdirSync(P.BIN, { recursive: true });
  for (const f of ['statusline.ps1', 'focus.ps1', 'claude-buddy-terminal-focus.vsix']) {
    try {
      const data = fs.readFileSync(path.join(src, f));
      const dst = path.join(P.BIN, f);
      if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(data)) fs.writeFileSync(dst, data);
    } catch {}
  }
}

// 포트를 못 잡으면(다른 프로그램이 선점) 창을 띄우지 않고 끝낸다 — 그 프로그램의 페이지를 우리 창에 불러오지 않기 위해
let uiKey = null;
function bootServer() {
  return new Promise((resolve) => {
    const s = startServer({
      onReady: () => resolve(true),
      onError: (e) => {
        dialog.showErrorBox('Claude Buddy', `로컬 서버(${P.PORT})를 열 수 없어요: ${e.code || e.message}\n다른 프로그램이 이 포트를 쓰고 있는지 확인해 주세요.`);
        resolve(false);
      },
    });
    uiKey = s.uiKey;
  });
}

const secureWebPreferences = () => ({
  preload: path.join(__dirname, '..', 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
  backgroundThrottling: true,
});

// 우리 서버 페이지만 열고, 다른 곳으로의 이동·새 창·권한 요청은 모두 막는다
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (ev, url) => { if (!url.startsWith(`${ORIGIN}/`)) ev.preventDefault(); });
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

const fromUs = (e) => {
  try { return new URL(e.senderFrame.url).origin === ORIGIN; } catch { return false; }
};

// ── 창 숨겨 두기 ── 팔레트(위젯)·펫 창은 앱이 켜질 때 둘 다 만들어 두고, 닫거나 모드를 바꿀 때는 숨기기만 한다.
// 창을 새로 만들면 이 PC 에서 1~2초가 걸려 전환이 느렸다 — 대신 메모리가 약 25MB 늘어난다(사용자와 합의한 선택).
let quitting = false;
function stash(win) {
  if (!win || win.isDestroyed()) return;
  win.hide();
  refreshTray();
}
// ✕·Alt+F4 도 숨기기로 — 앱 종료(트레이 「종료」) 때만 실제로 닫는다
function keepOnClose(win) {
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); stash(win); } });
}
app.on('before-quit', () => { quitting = true; });

// show=false 는 미리 만들어 두기(숨긴 채로)
function openWidget({ show = true } = {}) {
  const st = readJson(STATE(), {});
  if (widget) {
    if (!show) return;
    widget.buddyShow = true;
    if (st.bounds && !widget.isVisible()) widget.setBounds(st.bounds);
    if (widget.isMinimized()) widget.restore();
    widget.show(); widget.focus();
    refreshTray();
    return;
  }
  widget = new BrowserWindow({
    width: 480, height: 600, minWidth: 320, minHeight: 200,
    ...(st.bounds || {}),
    frame: false,
    backgroundColor: '#17181c',
    alwaysOnTop: !!st.pinned,
    title: 'Claude Buddy',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  const remember = () => {
    if (widget && !widget.isMinimized() && !widget.isMaximized()) writeJson(STATE(), { ...readJson(STATE(), {}), bounds: widget.getBounds() });
  };
  widget.on('moved', remember);
  widget.on('resized', remember);
  widget.buddyShow = show;
  // 미리 만든 창은 hide() 를 한 번 불러야 페이지가 「숨김」이 된다 — show:false 만으로는 보이는 페이지처럼 그리고 연결을 유지한다
  widget.once('ready-to-show', () => { if (widget) (widget.buddyShow ? widget.show() : widget.hide()); });
  keepOnClose(widget);
  widget.on('closed', () => { widget = null; refreshTray(); });
  widget.loadURL(`${ORIGIN}/`);
  refreshTray();
}

// ── 미니 모드(데스크톱 펫) ── 투명 창에 펫만. 펫이 아닌 곳은 클릭이 아래 창으로 통과한다(petTick).
const PET_W = 220, PET_H = 170;
// 펫 창은 대부분 투명 여백이고 펫은 아래쪽 가운데에 그려진다(가장 큰 도트 약 65×60, 아래 여백 6).
// 창 전체가 아니라 펫 그림이 화면 안에 있게 가두면, 투명 여백은 화면 밖으로 나가고 펫은 가장자리에 붙을 수 있다.
const PET_SIDE = Math.floor((PET_W - 70) / 2), PET_TOP = PET_H - 6 - 64, PET_BOTTOM = 6;
function petClamp(x, y, wa) {
  return {
    x: Math.round(Math.min(Math.max(x, wa.x - PET_SIDE), wa.x + wa.width - PET_W + PET_SIDE)),
    y: Math.round(Math.min(Math.max(y, wa.y - PET_TOP), wa.y + wa.height - PET_H + PET_BOTTOM)),
    width: PET_W, height: PET_H,
  };
}
const workAreaAt = (x, y) => screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
// 저장된 자리를 화면 안으로, 크기는 항상 원래 값으로(커진 채 저장된 경우도 되돌린다)
function petPlace() {
  const b = readJson(STATE(), {}).petBounds || {};
  if (!Number.isInteger(b.x) || !Number.isInteger(b.y)) return null;
  return petClamp(b.x, b.y, workAreaAt(b.x + PET_W / 2, b.y + PET_H / 2));
}
function openPet({ show = true } = {}) {
  const place = petPlace();
  if (petWin) {
    if (!show) return;
    petWin.buddyShow = true;
    if (!petWin.isVisible()) petWin.setBounds(place || { ...petWin.getBounds(), width: PET_W, height: PET_H });
    petWin.showInactive();
    refreshTray();
    return;
  }
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H,
    ...(place ? { x: place.x, y: place.y } : {}),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Claude Buddy',
    icon: ICON,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  petWin.setAlwaysOnTop(true, 'floating');
  petWin.setIgnoreMouseEvents(true);
  petWin.on('show', () => watchPetCursor(true));
  petWin.on('hide', () => watchPetCursor(false));
  petWin.on('moved', () => {
    if (!petWin) return;
    const { x, y } = petWin.getBounds();
    writeJson(STATE(), { ...readJson(STATE(), {}), petBounds: { x, y } });
  });
  petWin.buddyShow = show;
  petWin.once('ready-to-show', () => { if (petWin) (petWin.buddyShow ? petWin.showInactive() : petWin.hide()); });
  keepOnClose(petWin);
  petWin.on('closed', () => { clearInterval(petPoll); petPoll = null; petWin = null; refreshTray(); });
  petWin.loadURL(`${ORIGIN}/?mini=1`);
  refreshTray();
}

const isMini = () => !!readJson(STATE(), {}).mini;
// 마지막으로 쓴 모드로 연다
const openDefault = () => (isMini() ? openPet() : openWidget());
const visible = (w) => !!(w && !w.isDestroyed() && w.isVisible());
const anyOpen = () => visible(widget) || visible(petWin);
const closeAll = () => { stash(widget); stash(petWin); };

// 그 위치가 들어 있는 모니터의 작업 영역 안으로 창을 당겨 넣는다
function fitToScreen({ x, y, width, height }) {
  const wa = screen.getDisplayMatching({ x, y, width: 1, height: 1 }).workArea;
  const w = Math.min(width, wa.width), h = Math.min(height, wa.height);
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - w)),
    y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - h)),
    width: w, height: h,
  };
}

// 펫 ↔ 위젯 전환은 같은 자리에서 — 위젯 안 펫 칸과 펫 창의 펫이 겹치도록 맞춘다
// (펫 창은 가로 가운데에 펫이 있고, 위젯은 왼쪽 위 펫 칸에 있다)
const PET_ALIGN_X = Math.round(PET_W / 2) - 54;
function setMini(on) {
  const st = readJson(STATE(), {});
  if (on) {
    if (widget) {
      const b = widget.getBounds();
      if (visible(widget)) st.petBounds = (({ x, y }) => ({ x, y }))(petClamp(b.x - PET_ALIGN_X, b.y, workAreaAt(b.x, b.y)));
      stash(widget);
    }
    writeJson(STATE(), { ...st, mini: true });
    openPet();
  } else {
    if (petWin) {
      const p = petWin.getBounds();
      const size = st.bounds || { width: 480, height: 600 };
      if (visible(petWin)) st.bounds = fitToScreen({ x: p.x + PET_ALIGN_X, y: p.y, width: size.width || 480, height: size.height || 600 });
      stash(petWin);
    }
    writeJson(STATE(), { ...st, mini: false });
    openWidget();
  }
  refreshTray();
}

function openSetup() {
  if (setupWin) { setupWin.show(); setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 460, height: 560, resizable: false, minimizable: false, maximizable: false,
    title: 'Claude Buddy — Claude Code 연결',
    icon: ICON,
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  setupWin.setMenu(null);
  setupWin.once('ready-to-show', () => setupWin.show());
  setupWin.on('closed', () => { setupWin = null; });
  setupWin.loadURL(`${ORIGIN}/setup.html`);
}

function setLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}
const loginOn = () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;

function about() {
  dialog.showMessageBox({
    type: 'info',
    title: 'Claude Buddy',
    message: `Claude Buddy ${pkg.version}`,
    detail: 'Unofficial fan-made tool, not affiliated with Anthropic.\n\n'
      + `데이터 폴더: ${P.DATA}\n로컬 서버: ${ORIGIN} (이 PC 에서만 접속 가능)`,
    buttons: ['확인', '데이터 폴더 열기'],
  }).then(({ response }) => { if (response === 1) shell.openPath(P.DATA); });
}

function refreshTray() {
  if (!tray) return;
  const pinned = !!readJson(STATE(), {}).pinned;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: anyOpen() ? '닫기' : '열기', click: () => (anyOpen() ? closeAll() : openDefault()) },
    { label: '미니 모드 (데스크톱 펫)', type: 'checkbox', checked: isMini(), click: (m) => setMini(m.checked) },
    { label: '위에 고정', type: 'checkbox', checked: pinned, click: (m) => setPin(m.checked) },
    { type: 'separator' },
    { label: 'Claude Code 연결 설정…', click: openSetup },
    { label: 'Windows 시작 시 실행', type: 'checkbox', checked: loginOn(), click: (m) => setLogin(m.checked) },
    { type: 'separator' },
    { label: '정보', click: about },
    { label: '종료', click: () => app.quit() },
  ]));
}

function setPin(on) {
  writeJson(STATE(), { ...readJson(STATE(), {}), pinned: !!on });
  if (widget) widget.setAlwaysOnTop(!!on);
  refreshTray();
  return !!on;
}

// 기록 API 키 — 우리 서버에서 열린 페이지에만 건넨다
ipcMain.on('auth:key', (e) => { e.returnValue = fromUs(e) ? uiKey : null; });
ipcMain.handle('pin:get', (e) => fromUs(e) && !!(widget && widget.isAlwaysOnTop()));
ipcMain.handle('pin:set', (e, on) => (fromUs(e) ? setPin(on === true) : false));
ipcMain.on('win:minimize', (e) => { if (fromUs(e) && widget) widget.minimize(); });
ipcMain.on('win:close', (e) => { if (fromUs(e)) BrowserWindow.fromWebContents(e.sender)?.close(); });
ipcMain.on('mini:set', (e, on) => { if (fromUs(e)) setMini(on === true); });
// 펫 끌기 — 계산은 전부 실제 픽셀(물리 좌표)로 하고, 마지막에 이 창 기준으로만 DIP 로 되돌린다.
//  · 배율이 섞인 모니터(예: 150%·200%)에서는 커서 DIP 와 창 DIP 의 배율이 달라 펫이 커서의 0.75배만 따라오다 놓친다.
//  · 이동량을 조금씩 더하면 오차가 쌓이므로, 늘 「시작 창 위치 + 시작 이후 커서 이동량」으로 다시 계산한다.
//  · 크기도 매번 지정한다 — setPosition 만 반복하면 좌표 변환 오차로 창이 점점 커진다(1992×2328 까지 커진 적이 있다).
let petDrag = null;
const isPetSender = (e) => fromUs(e) && petWin && BrowserWindow.fromWebContents(e.sender) === petWin;
const cursorPx = () => screen.dipToScreenPoint(screen.getCursorScreenPoint());
ipcMain.on('pet:dragStart', (e) => {
  if (!isPetSender(e)) return;
  const c = cursorPx();
  const r = screen.dipToScreenRect(petWin, petWin.getBounds());
  petDrag = { cx: c.x, cy: c.y, x: r.x, y: r.y };
});
ipcMain.on('pet:dragMove', (e) => {
  if (!isPetSender(e) || !petDrag) return;
  const c = cursorPx();
  // 목표 왼쪽 위(물리) → 그 점이 속한 모니터 기준 DIP. 모니터를 넘어가도 그 모니터의 배율로 바뀐다.
  const dip = screen.screenToDipPoint({ x: petDrag.x + c.x - petDrag.cx, y: petDrag.y + c.y - petDrag.cy });
  // 커서가 있는 모니터 안에 펫 그림을 가둔다 — 가장자리까지는 가고 화면 밖으로는 안 나가며, 커서를 따라 다른 모니터로 넘어간다
  petWin.setBounds(petClamp(dip.x, dip.y, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea));
});
// 놓은 뒤 지금 있는 모니터의 배율로 크기를 다시 맞춘다 — 끄는 도중 배율이 다른 모니터로 넘어가면
// 창이 이전 배율의 크기로 남아(150%→200% 에서 330px 그대로) 아래쪽에 그려진 펫이 잘려 안 보인다
ipcMain.on('pet:dragEnd', (e) => {
  if (!isPetSender(e)) return;
  petDrag = null;
  const fix = () => {
    if (!petWin || petWin.isDestroyed()) return;
    const { x, y } = petWin.getBounds();
    // 같은 크기를 다시 지정하면 Electron 이 바뀐 게 없다고 보고 건너뛴다 — 1px 바꿨다가 되돌려 새 배율로 다시 계산하게 한다
    petWin.setBounds({ x, y, width: PET_W + 1, height: PET_H + 1 });
    petWin.setBounds({ x, y, width: PET_W, height: PET_H });
  };
  fix();
  setTimeout(fix, 120); // 모니터 배율 변경(WM_DPICHANGED) 처리가 끝난 뒤 한 번 더
});
// ── 클릭 통과 ── 펫·말풍선 위가 아니면 클릭이 아래 창으로 간다.
// setIgnoreMouseEvents 의 forward 옵션은 쓰지 않는다 — Windows 에서 전역 저수준 마우스 훅을 메인 스레드에 걸어,
// 메인이 잠깐만 바빠도(훅 기록·파일 읽기) PC 전체의 마우스가 ~300ms 씩 멈췄다. 대신 커서 위치를 직접 확인한다.
let petHit = null;
let petOver = false;
let petPoll = null;
const inRect = (p, r) => r && p.x >= r[0] && p.x < r[0] + r[2] && p.y >= r[1] && p.y < r[1] + r[3];
function petTick() {
  if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return;
  if (petDrag || !petHit) return; // 끄는 중에는 커서가 펫보다 앞서 나가도 놓치지 않게 그대로 둔다
  const c = cursorPx();
  const r = screen.dipToScreenRect(petWin, petWin.getBounds()); // 창·커서 모두 실제 픽셀 — 배율이 섞인 모니터에서도 맞다
  const k = r.width / PET_W;
  const p = { x: (c.x - r.x) / k, y: (c.y - r.y) / k };
  const over = inRect(p, petHit.sprite) || ((petHit.sayShown || petOver) && inRect(p, petHit.say));
  if (over === petOver) return;
  petOver = over;
  petWin.setIgnoreMouseEvents(!over);
  petWin.webContents.send('pet:hover', over);
}
function watchPetCursor(on) {
  clearInterval(petPoll);
  petPoll = on ? setInterval(petTick, 50) : null;
  if (!on && petWin && !petWin.isDestroyed()) { petOver = false; petWin.setIgnoreMouseEvents(true); }
}
const rect4 = (a) => (Array.isArray(a) && a.length === 4 && a.every((n) => Number.isFinite(n) && Math.abs(n) <= 4000) ? a : null);
ipcMain.on('pet:hit', (e, hit) => {
  if (!isPetSender(e) || !hit || typeof hit !== 'object') return;
  petHit = { sprite: rect4(hit.sprite), say: rect4(hit.say), sayShown: hit.sayShown === true };
});

const setupStatus = () => ({
  ...connect.status(), login: loginOn(), version: pkg.version, editors: editors.detect().map((x) => x.name),
});
ipcMain.handle('setup:status', (e) => (fromUs(e) ? setupStatus() : null));
ipcMain.handle('setup:connect', async (e, opts) => {
  if (!fromUs(e)) return null;
  const o = opts && typeof opts === 'object' ? opts : {};
  try {
    const r = connect.connect({ hooks: o.hooks !== false, statusLine: o.statusLine !== false });
    setLogin(o.login !== false);
    const ext = o.editors === false ? [] : await editors.installAll();
    refreshTray();
    return { ok: true, ...r, ...setupStatus(), ext };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('setup:disconnect', (e) => {
  if (!fromUs(e)) return null;
  try { return { ok: true, ...connect.disconnect() }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// 설정을 마치고 위젯으로 넘어가면 설정 창은 닫는다
ipcMain.on('setup:openWidget', (e) => {
  if (!fromUs(e) || !connect.status().hooks) return;
  openWidget();
  if (setupWin) setupWin.close();
});

if (DISCONNECT) {
  // 위에서 정리 후 종료한다
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openDefault());
  app.on('window-all-closed', () => { /* 트레이에 남는다 */ });
  app.on('before-quit', stopWorker);

  app.whenReady().then(async () => {
    // 이 앱의 페이지는 카메라·알림 등 어떤 권한도 필요 없다
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    installScripts();
    if (!(await bootServer())) return app.quit();

    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('Claude Buddy');
    tray.on('click', () => (anyOpen() ? closeAll() : openDefault()));
    refreshTray();

    let st = connect.status();
    // 0.5.x 의 HTTP 훅을 쓰던 사람은 우편함 방식으로 자동 전환한다(백업 후 우리 항목만 교체, 상태줄은 그대로)
    if (!st.error && st.needsMigration) {
      try { connect.connect({ hooks: true, statusLine: st.statusLine }); } catch {}
      st = connect.status();
    }
    if (st.error || !st.hooks) openSetup();
    else if (!HIDDEN || isMini()) openDefault(); // 데스크톱 펫은 시작할 때부터 떠 있는 게 자연스럽다
    // 나머지 창도 숨긴 채로 미리 만들어 둔다 — 첫 팔레트↔펫 전환부터 바로 바뀌게
    if (!st.error && st.hooks) setTimeout(() => { openWidget({ show: false }); openPet({ show: false }); }, 1500);

  });
}
