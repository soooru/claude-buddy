// Claude Code HTTP 훅 이벤트를 세션 기록(sessions/<id>.json)과 펫 밥(pet.json)으로 남긴다.
// 입력은 훅이 보낸 JSON 이라 믿지 않는다: 세션 id 는 형식 검사, transcript 는 ~/.claude/projects 아래 .jsonl 만 읽는다.
const fs = require('fs');
const path = require('path');
const P = require('./paths.cjs');
const { writeJson, readJson } = require('./store.cjs');

const CLIP = 200;
const clip = (s, max = CLIP) => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
};
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : null);

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const pushUnique = (list, v, max) => [v, ...(list || []).filter((x) => x !== v)].slice(0, max);

function safeTranscript(p) {
  if (typeof p !== 'string' || !p.endsWith('.jsonl')) return null;
  const abs = path.resolve(p);
  const root = path.resolve(P.TRANSCRIPTS) + path.sep;
  return abs.toLowerCase().startsWith(root.toLowerCase()) ? abs : null;
}

// transcript 를 지난번 읽은 위치부터 읽어 출력 토큰을 누적한다. 늘어난 양을 돌려준다.
// 한 응답이 content 블록마다 여러 줄로 나뉘어 같은 usage 가 반복되므로 requestId 로 한 번만 센다.
function addUsage(s, transcript) {
  if (!transcript) return 0;
  const before = s.outputTokens || 0;
  const fd = fs.openSync(transcript, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let from = s.tokenOffset || 0;
    if (from > size) { from = 0; s.outputTokens = 0; }
    if (from === size) return 0;
    // 한 번에 너무 많이 읽지 않는다(메인 스레드를 막지 않게) — 긴 세션의 첫 기록은 끝 2MB 만
    if (size - from > 2 * 1024 * 1024) from = size - 2 * 1024 * 1024;
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return 0;
    const usages = new Map();
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.includes('"usage"')) continue;
      try {
        const o = JSON.parse(line);
        const u = o.type === 'assistant' && o.message && o.message.usage;
        if (u && !o.isSidechain) usages.set(o.requestId || o.uuid, u);
      } catch {}
    }
    let last = null;
    for (const [rid, u] of usages) {
      if (rid === s.lastRequestId) continue;
      s.outputTokens = (s.outputTokens || 0) + (Number(u.output_tokens) || 0);
      last = [rid, u];
    }
    if (last) {
      const u = last[1];
      s.lastRequestId = last[0];
      s.contextTokens = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0)
        + (Number(u.cache_creation_input_tokens) || 0);
    }
    s.tokenOffset = from + end + 1;
  } finally {
    fs.closeSync(fd);
  }
  return Math.max(0, (s.outputTokens || 0) - before);
}

// 네트워크 경로(\\server\share)는 열지 않는다 — 내려받은 저장소의 .git 포인터로 SMB 접속(NTLM 해시 유출)을 유도할 수 있다
const isNetworkPath = (p) => /^[\\/]{2}/.test(p);

function readBranch(cwd) {
  try {
    if (isNetworkPath(cwd)) return null;
    let dir = path.resolve(cwd);
    for (let i = 0; i < 8 && dir; i++) {
      const git = path.join(dir, '.git');
      if (fs.existsSync(git)) {
        let gitDir = git;
        if (fs.statSync(git).isFile()) {
          const m = fs.readFileSync(git, 'utf8').match(/gitdir:\s*(.+)/);
          if (!m) return null;
          const target = m[1].trim();
          if (isNetworkPath(target)) return null;
          gitDir = path.resolve(dir, target);
          if (isNetworkPath(gitDir)) return null;
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = head.match(/^ref: refs\/heads\/(.+)$/);
        return clip(ref ? ref[1] : head.slice(0, 8), 80);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return null;
}

// Stop 에 last_assistant_message 가 없을 때의 폴백 — transcript 끝 256KB 만 읽는다.
function lastAssistantText(transcript) {
  if (!transcript) return null;
  try {
    const fd = fs.openSync(transcript, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n').reverse()) {
      try {
        const o = JSON.parse(line);
        if (o.type !== 'assistant') continue;
        const content = o.message && o.message.content;
        const text = Array.isArray(content)
          ? content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
          : typeof content === 'string' ? content : '';
        if (text.trim()) return text;
      } catch {}
    }
  } catch {}
  return null;
}

// 월요일 날짜(로컬)를 주 키로 — 사용량 정보가 없는 계정의 레벨·캐릭터 기준
function weekKey(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return m.toLocaleDateString('sv');
}

// 펫 — 응답이 끝날 때마다 한 끼(+1칸), 30분에 1칸씩 연속으로 소화한다(app.js 의 petView 와 같은 식).
const FOOD_MAX = 5;
const DIGEST_MS = 30 * 60e3;
function feedPet(tokens, at) {
  const file = P.file('pet.json');
  const p = readJson(file, {});
  const now = at;
  const today = new Date(at).toLocaleDateString('sv');
  if (p.mealsDate !== today) { p.mealsDate = today; p.mealsToday = 0; }
  p.mealsToday = (p.mealsToday || 0) + 1;
  const base = p.food != null ? p.food : p.lastFedAt ? FOOD_MAX : 0;
  const since = p.foodAt || p.lastFedAt || now;
  const current = Math.max(0, base - (now - since) / DIGEST_MS);
  if (current + 1 > FOOD_MAX) p.overfullAt = now;
  p.food = Math.min(FOOD_MAX, current + 1);
  p.foodAt = now;
  p.lastFedAt = now;
  const wk = weekKey(new Date(at));
  if (p.tokenWeek !== wk) { p.tokenWeek = wk; p.weekTokens = 0; }
  p.weekTokens = (p.weekTokens || 0) + tokens;
  writeJson(file, p);
}

// 훅 이벤트 하나를 반영한다. 기록이 바뀌었으면 true.
// at = 이벤트가 생긴 시각(ms) — 앱이 꺼져 있던 동안 쌓인 이벤트도 그 시각으로 기록한다.
function record(input, at = Date.now()) {
  if (!input || typeof input !== 'object') return false;
  const id = input.session_id;
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) return false;
  const ev = input.hook_event_name;
  const file = path.join(P.SESSIONS, `${id}.json`);
  const s = readJson(file, {});

  const now = new Date(at).toISOString();
  const cwd = str(input.cwd, 1000) || s.cwd || null;
  s.sessionId = id;
  s.cwd = cwd;
  s.project = cwd ? clip(path.basename(cwd), 120) : s.project;
  s.branch = cwd ? readBranch(cwd) : s.branch;
  s.startedAt = s.startedAt || now;
  if (typeof input.session_title === 'string') s.title = clip(input.session_title, 120);
  const transcript = safeTranscript(input.transcript_path);

  switch (ev) {
    case 'SessionStart':
      s.state = 'idle';
      s.message = null;
      break;
    case 'UserPromptSubmit':
      s.state = 'working';
      s.lastPrompt = clip(input.prompt) || s.lastPrompt;
      if (typeof input.prompt === 'string') s.recentPrompts = [clip(input.prompt, 500), ...(s.recentPrompts || [])].slice(0, 5);
      s.message = null;
      s.tool = null;
      s.turnStartedAt = now;
      s.lastTurnMs = null;
      s.turnFiles = [];
      break;
    case 'PreToolUse':
      s.tool = clip(input.tool_name, 80);
      if (s.state !== 'waiting') s.state = 'working';
      break;
    case 'PostToolUse': {
      s.state = 'working';
      s.message = null;
      const ti = input.tool_input || {};
      const fp = str(ti.file_path, 1000) || str(ti.notebook_path, 1000);
      if (EDIT_TOOLS.has(input.tool_name) && fp) {
        s.turnFiles = pushUnique(s.turnFiles, fp, 50);
        s.files = pushUnique(s.files, fp, 50);
      }
      break;
    }
    case 'Notification':
      // 응답을 끝낸 뒤 한동안 입력이 없을 때 오는 알림 — 「완료」를 덮지 않는다
      if (input.notification_type === 'idle_prompt' && s.state === 'done') return false;
      s.state = 'waiting';
      s.waitType = clip(input.notification_type, 40);
      s.message = clip(input.message);
      break;
    case 'Stop': {
      s.state = 'done';
      s.message = null;
      s.tool = null;
      if (s.turnStartedAt) s.lastTurnMs = Math.max(0, at - Date.parse(s.turnStartedAt));
      const full = str(input.last_assistant_message, 100000) || lastAssistantText(transcript);
      if (full) {
        s.lastSummary = clip(full);
        s.lastSummaryFull = full.length > 2000 ? full.slice(0, 2000) + '…' : full;
      }
      let tokens = 0;
      try { tokens = addUsage(s, transcript); } catch {}
      try { feedPet(tokens, at); } catch {}
      break;
    }
    case 'SessionEnd':
      s.state = 'ended';
      s.message = clip(input.reason, 80);
      break;
    default:
      return false;
  }
  s.updatedAt = now;
  writeJson(file, s);
  return true;
}

module.exports = { record, weekKey, DIGEST_MS };
