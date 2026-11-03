// 내장 로컬 서버 — http://127.0.0.1:7777
//  GET  /api/events    변경 알림(SSE) — 위젯은 폴링하지 않고 이것만 기다린다
//  GET  /api/sessions · /api/usage · /api/pet,  POST /api/name/:id · /api/pet · /api/focus/:id
//
// 보안: 127.0.0.1 에만 바인딩한다.
//   Host 헤더 검사 — DNS 리바인딩으로 다른 사이트가 이 서버를 읽지 못하게.
//   Origin·Sec-Fetch-Site 검사 — 브라우저의 교차 출처 요청(CSRF) 차단.
//   훅은 이 서버로 오지 않는다 — 우편함 폴더(inbox.cjs)로 들어온다. 그래서 포트를 선점당해도 훅 내용이 새지 않는다.
//   /api/* 는 실행할 때마다 새로 만드는 UI 키를 요구한다 — 같은 PC 의 다른 Windows 계정이나 브라우저는 기록을 읽지 못한다.
//   본문 크기 제한, 정적 파일은 화이트리스트만.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const P = require('./paths.cjs');
const { writeJson, readJson } = require('./store.cjs');
const { watchInbox } = require('./inbox.cjs');
const { focusPid } = require('./focus.cjs');

const HOUR = 3600e3;
const HOSTS = new Set([`127.0.0.1:${P.PORT}`, `localhost:${P.PORT}`]);
const ORIGINS = new Set([`http://127.0.0.1:${P.PORT}`, `http://localhost:${P.PORT}`]);
const RENDERER = path.join(__dirname, '..', 'renderer');
const STATIC = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/pet-art.js': ['pet-art.js', 'text/javascript'],
  '/game.js': ['game.js', 'text/javascript'],
  '/setup.html': ['setup.html', 'text/html'],
  '/setup.js': ['setup.js', 'text/javascript'],
  '/favicon.svg': ['icon.svg', 'image/svg+xml'],
};
// 펫 도트 파일에서 캐릭터 이름 목록만 읽어 둔다 — 버디 도감에 모르는 이름이 저장되지 않게
require(path.join(RENDERER, 'pet-art.js'));
const SPECIES_NAMES = new Set(((globalThis.PET_ART && globalThis.PET_ART.SPECIES) || []).map((s) => s[0]));

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// 객체 키로 쓰는 값(세션 id·주 키)이 프로토타입을 건드리지 못하게
const safeKey = (k) => typeof k === 'string' && k.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(k);

// ── claude CLI 경로 ── 셸 없이 절대 경로로 실행한다(cmd.exe 는 현재 폴더를 PATH 보다 먼저 찾아서 가짜 claude.bat 이 끼어들 수 있다)
let claudeCmd;
function resolveClaude() {
  if (claudeCmd !== undefined) return claudeCmd;
  claudeCmd = null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of ['claude.exe', 'claude.cmd']) {
      const p = path.join(dir, name);
      try { if (fs.statSync(p).isFile()) { claudeCmd = p; return p; } } catch {}
    }
  }
  return null;
}

// ── 생존 확인 ── 위젯이 열려 있을 때만 1분마다 `claude agents` 를 띄운다(창이 닫혀 있으면 프로세스를 만들지 않는다)
let live = null;
let liveError = null;
let liveTimer = null;
function refreshLive(onDone) {
  const cli = resolveClaude();
  if (!cli) { live = null; liveError = 'claude 명령을 PATH 에서 찾지 못했어요'; onDone(); return; }
  const opts = { timeout: 20000, windowsHide: true, maxBuffer: 4 << 20 };
  // .exe 는 셸 없이 바로, .cmd(npm 설치)는 cmd.exe 로 — 인자는 고정값이고 경로는 따옴표로 감싼다
  const run = cli.toLowerCase().endsWith('.exe')
    ? (cb) => execFile(cli, ['agents', '--json', '--all'], opts, cb)
    : (cb) => execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${cli}" agents --json --all"`],
      { ...opts, windowsVerbatimArguments: true }, cb);
  run((err, stdout) => {
      try {
        if (err) throw err;
        const list = JSON.parse(stdout);
        live = new Map(list.filter((a) => a && typeof a.sessionId === 'string').map((a) => [a.sessionId, a]));
        liveError = null;
      } catch (e) {
        live = null;
        liveError = String((e && e.message) || e).split('\n')[0].slice(0, 120);
      }
      onDone();
  });
}

const AGENT_STATE = { busy: 'working', waiting: 'waiting', idle: 'idle',
  working: 'working', blocked: 'waiting', done: 'done', failed: 'failed', stopped: 'ended' };

const readNames = () => readJson(P.file('names.json'), {});

function collect() {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(P.SESSIONS).filter((f) => f.endsWith('.json') && !f.startsWith('_')); } catch {}
  const now = Date.now();
  for (const f of files) {
    const s = readJson(path.join(P.SESSIONS, f), null);
    if (!s || typeof s.sessionId !== 'string') continue;
    const age = now - Date.parse(s.updatedAt);
    if ((s.state === 'ended' && age > HOUR) || age > 24 * HOUR) continue; // 목록에서만 뺀다 — 삭제는 cleanup
    out.set(s.sessionId, { ...s, source: 'hook' });
  }
  if (live) {
    for (const s of out.values()) {
      const a = live.get(s.sessionId);
      if (!a) {
        if (s.state !== 'ended') { s.state = 'ended'; s.message = s.message || '프로세스 없음'; }
        continue;
      }
      s.kind = a.kind;
      s.name = a.name;
      s.pid = a.pid;
    }
    for (const a of live.values()) {
      if (out.has(a.sessionId)) continue;
      if (a.kind === 'background' && now - a.startedAt > 24 * HOUR) continue;
      out.set(a.sessionId, {
        sessionId: a.sessionId, cwd: a.cwd, project: path.basename(a.cwd || ''),
        name: a.name, kind: a.kind, pid: a.pid,
        state: AGENT_STATE[a.status || a.state] || 'idle',
        startedAt: Number.isFinite(a.startedAt) ? new Date(a.startedAt).toISOString() : null, updatedAt: null, source: 'agents',
      });
    }
  } else {
    for (const s of out.values()) {
      if (s.state === 'working' && now - Date.parse(s.updatedAt) > 30 * 60e3) s.stale = true;
    }
  }
  const names = readNames();
  for (const s of out.values()) s.alias = names[s.sessionId] || null;
  return { sessions: [...out.values()], liveCheck: live ? 'ok' : liveError || 'pending' };
}

// ── 자동 정리 ── 쓰다 남은 .tmp 와 30일 넘게 갱신 없는 세션 기록, 그 세션에 붙인 이름
function cleanup() {
  const now = Date.now();
  let files = [];
  try { files = fs.readdirSync(P.SESSIONS); } catch { return; }
  for (const f of files) {
    const file = path.join(P.SESSIONS, f);
    try {
      const st = fs.statSync(file);
      if (f.endsWith('.tmp')) { if (now - st.mtimeMs > 10 * 60e3) fs.unlinkSync(file); continue; }
      if (!f.endsWith('.json')) continue;
      const s = readJson(file, {});
      const last = Date.parse(s.updatedAt) || st.mtimeMs;
      if (now - last > 30 * 24 * HOUR) fs.unlinkSync(file);
    } catch {}
  }
  // 데이터 폴더의 쓰다 남은 임시 파일(상태줄이 동시에 저장하다 남긴 usage.json.*.tmp 등)
  try {
    for (const f of fs.readdirSync(P.DATA)) {
      if (!f.endsWith('.tmp')) continue;
      const file = path.join(P.DATA, f);
      if (now - fs.statSync(file).mtimeMs > 10 * 60e3) fs.unlinkSync(file);
    }
  } catch {}
  const names = readNames();
  const alive = new Set(fs.readdirSync(P.SESSIONS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  const orphans = Object.keys(names).filter((id) => !alive.has(id));
  if (orphans.length) {
    for (const id of orphans) delete names[id];
    try { writeJson(P.file('names.json'), names); } catch {}
  }
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function startServer({ onReady, onError } = {}) {
  const uiKey = crypto.randomBytes(32).toString('hex'); // 메모리에만 — preload 를 통해 앱 화면에만 건넨다
  const clients = new Set();

  const broadcast = () => { for (const res of clients) res.write('data: change\n\n'); };
  let pending = null;
  const changed = () => { // 훅이 몰려 와도 화면 갱신은 150ms 에 한 번
    if (pending) return;
    pending = setTimeout(() => { pending = null; broadcast(); }, 150);
  };

  // 창이 닫힌 뒤에도 2분은 계속 확인한다 — 금방 다시 열면 「➜」가 바로 보이게
  const LIVE_GRACE = 2 * 60e3;
  let lastClientAt = 0;
  let liveRunning = false;
  const scheduleLive = () => {
    liveTimer = null;
    if (clients.size) lastClientAt = Date.now();
    if (!clients.size && Date.now() - lastClientAt > LIVE_GRACE) { live = null; liveError = null; return; }
    liveRunning = true;
    refreshLive(() => { liveRunning = false; changed(); liveTimer = setTimeout(scheduleLive, 60e3); });
  };
  // 이미 돌고 있으면(유예 시간 안에 다시 열린 경우) 새로 띄우지 않는다
  const ensureLive = () => { if (!liveRunning && !liveTimer) scheduleLive(); };

  // 훅 우편함 — 이벤트 파일이 들어오면 기록하고 화면에 알린다
  watchInbox(changed);

  // 상태줄이 usage.json 을 쓰면 화면에 알린다
  try {
    fs.mkdirSync(P.DATA, { recursive: true });
    fs.watch(P.DATA, (_ev, name) => { if (name === 'usage.json') changed(); });
  } catch {}

  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  // 처리 중 예외(파일 잠김 등)가 메인 프로세스의 처리되지 않은 거부로 번지지 않게 감싼다
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { try { if (!res.headersSent) send(res, 500, {}); else res.end(); } catch {} });
  });
  async function handle(req, res) {
    if (!HOSTS.has(req.headers.host)) return send(res, 403, { error: 'host' });
    const origin = req.headers.origin;
    const url = (req.url || '/').split('?')[0];

    if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin' });
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'site' });

    if (req.method === 'GET' && STATIC[url]) {
      const [file, type] = STATIC[url];
      try { return send(res, 200, fs.readFileSync(path.join(RENDERER, file)), `${type}; charset=utf-8`); } catch { return send(res, 404, {}); }
    }

    // 여기부터는 기록을 다루는 API — UI 키 필수(EventSource 는 헤더를 못 붙여서 ?k= 로 받는다)
    let key = req.headers['x-buddy-key'];
    if (!key && url === '/api/events') {
      try { key = new URL(req.url, 'http://x').searchParams.get('k'); } catch {}
    }
    if (!sameToken(key, uiKey)) return send(res, 401, {});

    if (req.method === 'GET' && url === '/api/events') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write('retry: 3000\n\ndata: change\n\n');
      clients.add(res);
      lastClientAt = Date.now();
      ensureLive();
      const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
      req.on('close', () => { clearInterval(ping); clients.delete(res); lastClientAt = Date.now(); });
      return;
    }
    if (req.method === 'GET' && url === '/api/sessions') return send(res, 200, collect());
    if (req.method === 'GET' && url === '/api/usage') return send(res, 200, readJson(P.file('usage.json'), null));
    if (req.method === 'GET' && url === '/api/pet') return send(res, 200, readJson(P.file('pet.json'), {}));

    // 위젯 설정 — 퇴근 시간(KST, HH:MM)과 표시 여부. 다시 바꿀 때까지 유지된다.
    if (url === '/api/prefs') {
      const prefs = { showOffWork: false, offWork: '18:00', ...readJson(P.file('prefs.json'), {}) };
      if (req.method !== 'POST') return send(res, 200, prefs);
      const b = await readBody(req, 4096);
      if (b && typeof b.showOffWork === 'boolean') prefs.showOffWork = b.showOffWork;
      if (b && typeof b.offWork === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.offWork)) prefs.offWork = b.offWork;
      writeJson(P.file('prefs.json'), { showOffWork: prefs.showOffWork, offWork: prefs.offWork });
      changed();
      return send(res, 200, prefs);
    }

    // 버디 도감 — 그 주에 태어난 친구와 그 주의 최고 레벨. 알려진 캐릭터 이름·범위 안의 값만 받는다.
    if (req.method === 'POST' && url === '/api/pet/collect') {
      const b = await readBody(req, 4096);
      const week = b && (typeof b.week === 'string' || typeof b.week === 'number') ? String(b.week).slice(0, 40) : '';
      const lv = b && Number.isInteger(b.lv) && b.lv >= 1 && b.lv <= 10 ? b.lv : 0;
      if (!safeKey(week) || !lv || !SPECIES_NAMES.has(b.species)) return send(res, 400, {});
      const p = readJson(P.file('pet.json'), {});
      const col = p.collection && typeof p.collection === 'object' ? p.collection : {};
      const prev = col[week];
      if (!prev || prev.species !== b.species || prev.lv < lv) {
        col[week] = { species: b.species, lv, at: Date.now() };
        // 너무 오래된 주는 정리한다(약 4년)
        const keys = Object.keys(col).sort((a, c) => col[a].at - col[c].at);
        while (keys.length > 200) delete col[keys.shift()];
        p.collection = col;
        writeJson(P.file('pet.json'), p);
      }
      return send(res, 200, p.collection || col);
    }

    if (req.method === 'POST' && url === '/api/pet') {
      const b = await readBody(req, 4096);
      const p = readJson(P.file('pet.json'), {});
      // 이름은 그 주에 태어난 친구에게만 — 다음 주엔 다른 캐릭터라 week 와 함께 둔다
      const name = b && typeof b.name === 'string' ? b.name.trim().slice(0, 20) : '';
      p.name = name || undefined;
      p.nameWeek = name && b && (typeof b.week === 'string' || typeof b.week === 'number') ? String(b.week).slice(0, 40) : undefined;
      writeJson(P.file('pet.json'), p);
      return send(res, 200, p);
    }

    const nameMatch = req.method === 'POST' && url.match(/^\/api\/name\/([\w-]{1,80})$/);
    if (nameMatch) {
      if (!safeKey(nameMatch[1])) return send(res, 400, {});
      const b = await readBody(req, 4096);
      const name = b && typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
      const names = readNames();
      if (name) names[nameMatch[1]] = name; else delete names[nameMatch[1]];
      writeJson(P.file('names.json'), names);
      changed();
      return send(res, 200, { name });
    }

    const focusMatch = req.method === 'POST' && url.match(/^\/api\/focus\/([\w-]{1,80})$/);
    if (focusMatch) {
      const a = live && live.get(focusMatch[1]);
      if (!a || !Number.isInteger(a.pid)) return send(res, 404, { error: '이 세션의 창 정보를 아직 못 받았어요' });
      try {
        const r = await focusPid(a.pid);
        if (r.status === 'OK') return send(res, 200, { title: r.title, terminal: r.terminal });
        if (r.status === 'BLOCKED') return send(res, 409, { error: 'Windows 가 창 전환을 막았어요 — 작업 표시줄에서 깜빡이는 창을 눌러 주세요' });
        return send(res, 404, { error: '창을 찾을 수 없어요' });
      } catch {
        return send(res, 500, { error: '창을 가져오지 못했어요' });
      }
    }

    send(res, 404, {});
  }

  server.on('error', (e) => onError && onError(e));
  server.listen(P.PORT, '127.0.0.1', () => {
    cleanup();
    setInterval(cleanup, 24 * HOUR).unref();
    onReady && onReady();
  });
  return { server, uiKey };
}

module.exports = { startServer };
