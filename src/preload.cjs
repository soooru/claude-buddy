// 페이지에 노출하는 것은 이 함수들뿐이다(contextIsolation + sandbox). 메인 프로세스가 호출 출처를 다시 확인한다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashApp', {
  getPin: () => ipcRenderer.invoke('pin:get'),
  setPin: (on) => ipcRenderer.invoke('pin:set', on === true),
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  setMini: (on) => ipcRenderer.send('mini:set', on === true),
  petDragStart: () => ipcRenderer.send('pet:dragStart'),
  petDragMove: () => ipcRenderer.send('pet:dragMove'),
  petDragEnd: () => ipcRenderer.send('pet:dragEnd'),
  // 펫·말풍선 자리(CSS px) — 메인이 커서가 그 위에 있을 때만 클릭을 받는다
  petHit: (hit) => ipcRenderer.send('pet:hit', hit),
  onPetHover: (cb) => { ipcRenderer.on('pet:hover', (_e, over) => cb(over === true)); },
  // 기록 API 키 — 메인이 우리 페이지인지 확인한 뒤에만 준다
  key: () => ipcRenderer.sendSync('auth:key'),
});

contextBridge.exposeInMainWorld('buddySetup', {
  status: () => ipcRenderer.invoke('setup:status'),
  connect: (opts) => ipcRenderer.invoke('setup:connect', {
    hooks: !!(opts && opts.hooks), statusLine: !!(opts && opts.statusLine), login: !!(opts && opts.login),
    editors: !!(opts && opts.editors),
  }),
  disconnect: () => ipcRenderer.invoke('setup:disconnect'),
  openWidget: () => ipcRenderer.send('setup:openWidget'),
});
