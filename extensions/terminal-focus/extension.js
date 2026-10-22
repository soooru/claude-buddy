// Claude Buddy 가 focus-request.json 을 쓰면, 그 안의 PID(Claude 프로세스와 조상들)를 가진 터미널이
// 이 창에 있는지 보고, 있으면 그 터미널 탭을 띄운 뒤 응답 파일에 이 창의 워크스페이스 이름을 남긴다.
// 창을 OS 수준에서 앞으로 가져오는 건 Claude Buddy(focus.ps1)가 그 이름으로 창을 찾아서 한다.
// 이 확장은 파일만 읽고 쓰며 네트워크를 쓰지 않는다.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Buddy 의 paths.cjs 와 같은 규칙
const DIR = process.env.CLAUDE_BUDDY_DATA
  || (process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, 'session-dash')
    : path.join(os.homedir(), '.claude', 'session-dash'));
const REQ = path.join(DIR, 'focus-request.json');

let lastId = null;

async function handle() {
  let req;
  try { req = JSON.parse(fs.readFileSync(REQ, 'utf8')); } catch { return; }
  if (!req || typeof req.id !== 'string' || !/^[\w-]{1,40}$/.test(req.id)) return;
  if (req.id === lastId || !Number.isFinite(req.at) || Date.now() - req.at > 5000 || !Array.isArray(req.pids)) return;
  lastId = req.id;

  const pids = new Set(req.pids.filter((p) => Number.isInteger(p)));
  for (const t of vscode.window.terminals) {
    let pid;
    try { pid = await t.processId; } catch { continue; }
    if (!pids.has(pid)) continue;
    t.show(false);
    const res = path.join(DIR, `focus-response-${req.id}.json`);
    fs.writeFileSync(res, JSON.stringify({ workspace: vscode.workspace.name || null, terminal: t.name }));
    return;
  }
}

function activate(context) {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
  let timer = null;
  const watcher = fs.watch(DIR, (_ev, file) => {
    if (file !== 'focus-request.json') return;
    // 쓰기 도중 이벤트가 여러 번 오므로 모아서 한 번만 처리
    clearTimeout(timer);
    timer = setTimeout(() => handle().catch(() => {}), 30);
  });
  context.subscriptions.push({ dispose: () => watcher.close() });
}

function deactivate() {}

module.exports = { activate, deactivate };
