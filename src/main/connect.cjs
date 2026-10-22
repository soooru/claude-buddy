// ~/.claude/settings.json 에 Claude Buddy 훅·상태줄을 연결하고 해제한다.
// 원칙: 쓰기 전에 백업하고, 우리 항목만 더하고 뺀다. JSON 이 깨져 있으면 아무것도 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const P = require('./paths.cjs');
const { writeJson, readJson } = require('./store.cjs');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const INBOX = path.join(P.DATA, 'inbox');
const STATUS_SCRIPT = path.join(P.BIN, 'statusline.ps1');
const PREV_STATUS = P.file('prev-statusline.json');
const MARK = '# claude-buddy';

const fwd = (p) => p.replace(/\\/g, '/');
const bashQuote = (s) => `'${s.replace(/'/g, "'\\''")}'`;
const statusCommand = () => `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${fwd(STATUS_SCRIPT)}"`;

// 훅 = 이벤트 JSON(stdin)을 우편함 폴더에 파일로 떨구는 백그라운드 명령(Git Bash).
//  - async: Claude Code 가 기다리지 않고, 출력(응답)도 쓰지 않는다 → 누가 끼어들어 허락을 꾸밀 통로가 없다.
//  - 이름 = <마이크로초>-<pid>-<난수> : 앱이 시간순으로 처리한다. 다 쓴 뒤 이름을 바꿔 반쯤 쓴 파일은 읽지 않는다.
const hookCommand = () => `d=${bashQuote(fwd(INBOX))}; t=\${EPOCHREALTIME//[.,]/}; [ -n "$t" ] || t=$(date +%s)000000; `
  + `f="$d/$t-$$-$RANDOM"; cat > "$f.tmp" && mv -f "$f.tmp" "$f.json" ${MARK}`;

const isOurHook = (h) => h && h.type === 'command' && typeof h.command === 'string' && h.command.includes(MARK);
// 이전 방식: 0.5.x 까지의 HTTP 훅, 그리고 session-dash 시절의 node 훅 — 연결할 때 새 방식으로 바꾼다
const isOldHttpHook = (h) => h && h.type === 'http' && typeof h.url === 'string'
  && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/hook\/?$/.test(h.url);
const isLegacyHook = (h) => isOldHttpHook(h)
  || (h && h.type === 'command' && typeof h.command === 'string' && /session-dash[\\/]+hook\.cjs/.test(h.command));
const isOurStatus = (s) => s && typeof s.command === 'string' && fwd(s.command).includes(fwd(STATUS_SCRIPT));

function load() {
  if (!fs.existsSync(P.SETTINGS)) return {};
  const raw = fs.readFileSync(P.SETTINGS, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return {};
  const obj = JSON.parse(raw); // 깨져 있으면 여기서 던진다 — 호출부가 사용자에게 알린다
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('settings.json 최상위가 객체가 아니에요');
  return obj;
}

function backup() {
  if (!fs.existsSync(P.SETTINGS)) return null;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  // 같은 초에 여러 번 저장해도 이전 백업(특히 원본)을 덮어쓰지 않는다
  let file = `${P.SETTINGS}.bak-claude-buddy-${stamp}`;
  for (let i = 2; fs.existsSync(file); i++) file = `${P.SETTINGS}.bak-claude-buddy-${stamp}-${i}`;
  fs.copyFileSync(P.SETTINGS, file, fs.constants.COPYFILE_EXCL);
  pruneBackups();
  return file;
}

// 백업은 가장 오래된 것(연결 전 원본)과 최근 4개만 남긴다 — settings.json 의 env 값 사본이 계속 늘지 않게
function pruneBackups() {
  try {
    const dir = path.dirname(P.SETTINGS);
    const base = `${path.basename(P.SETTINGS)}.bak-claude-buddy-`;
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(base))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
    for (const { f } of files.slice(1, Math.max(1, files.length - 4))) fs.unlinkSync(path.join(dir, f));
  } catch {}
}

// settings.json 이 심볼릭 링크(dotfile 관리 도구)면 링크를 깨지 않도록 실제 파일 옆에 쓰고 교체한다
function save(obj) {
  let target = P.SETTINGS;
  try { target = fs.realpathSync(P.SETTINGS); } catch {}
  const tmp = `${target}.claude-buddy.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8')); // 쓴 결과가 다시 읽히는지 확인하고 나서 교체
  fs.renameSync(tmp, target);
}

// 훅 목록에서 조건에 맞는 항목을 빼고, 비게 된 묶음·이벤트도 정리한다
function removeHooks(settings, pred) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return 0;
  let removed = 0;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const hooks = g.hooks.filter((h) => { const hit = pred(h); if (hit) removed++; return !hit; });
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}

function status() {
  let settings;
  try { settings = load(); } catch (e) { return { error: `settings.json 을 읽을 수 없어요: ${e.message}` }; }
  const groupsOf = (ev) => (settings.hooks && Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : []);
  const has = (ev, pred) => groupsOf(ev).some((g) => g && Array.isArray(g.hooks) && g.hooks.some(pred));
  return {
    hooks: EVENTS.every((ev) => has(ev, isOurHook)),
    legacy: EVENTS.some((ev) => has(ev, isLegacyHook)),
    // 0.5.x 까지 연결했던 사람 — 앱이 시작할 때 새 방식으로 자동으로 바꿔 준다
    needsMigration: EVENTS.some((ev) => has(ev, isOldHttpHook)),
    statusLine: isOurStatus(settings.statusLine),
    otherStatusLine: !!(settings.statusLine && !isOurStatus(settings.statusLine)),
    settingsPath: P.SETTINGS,
  };
}

function connect({ hooks = true, statusLine = true }) {
  const settings = load();
  const bak = backup();
  fs.mkdirSync(INBOX, { recursive: true });
  removeHooks(settings, (h) => isOurHook(h) || isLegacyHook(h));
  if (hooks) {
    settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
    for (const ev of EVENTS) {
      const group = { hooks: [{ type: 'command', shell: 'bash', async: true, command: hookCommand() }] };
      if (TOOL_EVENTS.has(ev)) group.matcher = '*';
      settings.hooks[ev] = [...(Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : []), group];
    }
  }
  if (statusLine) {
    if (settings.statusLine && !isOurStatus(settings.statusLine)) writeJson(PREV_STATUS, settings.statusLine);
    settings.statusLine = { type: 'command', command: statusCommand(), padding: 0 };
  } else if (isOurStatus(settings.statusLine)) {
    restoreStatus(settings);
  }
  save(settings);
  return { backup: bak, ...status() };
}

function restoreStatus(settings) {
  const prev = readJson(PREV_STATUS, null);
  if (prev && typeof prev === 'object' && !isOurStatus(prev)) settings.statusLine = prev; else delete settings.statusLine;
  try { fs.unlinkSync(PREV_STATUS); } catch {}
}

function disconnect() {
  const settings = load();
  const bak = backup();
  removeHooks(settings, (h) => isOurHook(h) || isOldHttpHook(h));
  if (isOurStatus(settings.statusLine)) restoreStatus(settings);
  save(settings);
  return { backup: bak, ...status() };
}

module.exports = { status, connect, disconnect, EVENTS };
