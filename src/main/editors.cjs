// Cursor·VS Code 에 터미널 탭 찾기 확장을 설치한다. 실행하는 것은 각 에디터의 공식 CLI 뿐이고,
// 인자는 우리가 정한 경로·id 만 쓴다(사용자 입력이 섞이지 않는다).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const P = require('./paths.cjs');

const EXT_ID = 'soooru.claude-buddy-terminal-focus';
const VSIX = path.join(P.BIN, 'claude-buddy-terminal-focus.vsix');

function candidates() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    ['Cursor', [
      path.join(local, 'Programs', 'cursor', '_', 'resources', 'app', 'bin', 'cursor.cmd'), // 최근 설치 구조
      path.join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(pf, 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
    ]],
    ['VS Code', [
      path.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(pf, 'Microsoft VS Code', 'bin', 'code.cmd'),
    ]],
  ];
}

function detect() {
  const found = [];
  for (const [name, paths] of candidates()) {
    const cli = paths.find((p) => p && fs.existsSync(p));
    if (cli) found.push({ name, cli });
  }
  return found;
}

// .cmd 는 cmd.exe 로만 실행된다. 경로에 공백이 있을 수 있어 직접 따옴표로 감싼다.
function runCli(cli, args) {
  const line = [`"${cli}"`, ...args.map((a) => (/^[\w.@-]+$/.test(a) ? a : `"${a}"`))].join(' ');
  return new Promise((resolve) => {
    execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`],
      { windowsHide: true, timeout: 60000, windowsVerbatimArguments: true },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || (err && err.message) || '').trim() }));
  });
}

async function installAll() {
  const results = [];
  if (!fs.existsSync(VSIX)) return [{ name: '확장 파일', ok: false, out: 'vsix 없음' }];
  for (const { name, cli } of detect()) {
    const r = await runCli(cli, ['--install-extension', VSIX, '--force']);
    results.push({ name, ok: r.ok });
  }
  return results;
}

async function uninstallAll() {
  for (const { cli } of detect()) await runCli(cli, ['--uninstall-extension', EXT_ID]);
}

module.exports = { detect, installAll, uninstallAll, EXT_ID };
