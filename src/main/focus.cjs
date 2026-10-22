// 「➜ 이동」 — 세션 프로세스의 조상 창(터미널·IDE)을 앞으로 가져온다. Windows 전용.
// PowerShell 은 뜨는 데 1초가 넘게 걸려서 하나를 띄워 두고 재사용하되, 1분 쉬면 내려 메모리를 돌려준다.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const P = require('./paths.cjs');

const SCRIPT = path.join(P.BIN, 'focus.ps1');
// 문자열은 스크립트에 그대로 넣지 않고 base64 로 감싸 PowerShell 안에서 푼다.
// PowerShell 은 ' 말고도 ‘ ’ ‚ ‛ 를 따옴표로 보므로, 이스케이프로는 폴더 이름 같은 값의 주입을 다 막을 수 없다.
const psStr = (s) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(String(s), 'utf8').toString('base64')}')))`;

let worker = null;
let idleTimer = null;
let queue = Promise.resolve();
const END = '__CLAUDE_BUDDY_END__';

function psWorker() {
  if (worker && worker.exitCode === null && !worker.killed) return worker;
  worker = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  worker.stdout.setEncoding('utf8');
  worker.stdin.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8\n');
  worker.on('exit', () => { worker = null; });
  return worker;
}

function stopWorker() {
  try { if (worker) worker.kill(); } catch {}
  worker = null;
}

function psRun(cmd) {
  clearTimeout(idleTimer);
  const job = queue.then(() => new Promise((resolve) => {
    const w = psWorker();
    let buf = '';
    const done = (out) => { clearTimeout(timer); w.stdout.off('data', onData); resolve(out); };
    const onData = (d) => {
      buf += d;
      const i = buf.indexOf(END);
      if (i >= 0) done(buf.slice(0, i).trim());
    };
    const timer = setTimeout(() => { stopWorker(); done(''); }, 15000);
    w.stdout.on('data', onData);
    w.stdin.write(`${cmd}; '${END}'\n`);
  }));
  queue = job.catch(() => {}).then(() => { idleTimer = setTimeout(stopWorker, 60e3); });
  return job;
}

// 조상 PID 는 10분만 기억한다 — PID 가 재사용되면 엉뚱한 창으로 갈 수 있어서
const chains = new Map();
async function pidChain(pid) {
  const hit = chains.get(pid);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.list;
  const out = await psRun(`& ${psStr(SCRIPT)} ${pid} -ChainOnly`);
  const list = out.split(/\r?\n/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (list.length) chains.set(pid, { list, at: Date.now() });
  return list;
}

// 선택: Cursor 확장이 focus-request.json 을 보고 터미널을 띄운 뒤 워크스페이스 이름으로 답한다. 없으면 창 단위로만 이동.
async function askCursor(pids) {
  if (!pids.length) return null;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const resFile = P.file(`focus-response-${id}.json`);
  try { fs.writeFileSync(P.file('focus-request.json'), JSON.stringify({ id, at: Date.now(), pids })); } catch { return null; }
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      const r = JSON.parse(fs.readFileSync(resFile, 'utf8'));
      fs.unlinkSync(resFile);
      return typeof r.workspace === 'string' ? r.workspace.slice(0, 200) : null;
    } catch {}
  }
  return null;
}

// 결과: { status: 'OK' | 'BLOCKED' | 'NOTFOUND', title, terminal }
async function focusPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { status: 'NOTFOUND' };
  if (!fs.existsSync(SCRIPT)) return { status: 'NOTFOUND' };
  const chain = await pidChain(pid);
  const workspace = await askCursor(chain);
  let cmd = `& ${psStr(SCRIPT)} ${pid} -Pids ${psStr(chain.join(','))}`;
  if (workspace) cmd += ` -TitleHint ${psStr(workspace)}`;
  const out = (await psRun(cmd)).split(/\r?\n/).pop() || '';
  const [status, title, tab] = out.split('|');
  return { status: status || 'NOTFOUND', title: title || '', terminal: !!workspace || !!tab };
}

module.exports = { focusPid, stopWorker };
