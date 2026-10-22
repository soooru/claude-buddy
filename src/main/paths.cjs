// 경로 한곳 — 코드는 설치 폴더, 데이터는 ~/.claude/session-dash(이전 버전과 같은 위치라 기록이 이어진다).
const os = require('os');
const path = require('path');

const HOME = os.homedir();
// Claude Code 와 같은 규칙 — CLAUDE_CONFIG_DIR 로 설정 폴더를 옮겨 쓰는 사람도 있다
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, '.claude');
const DATA = process.env.CLAUDE_BUDDY_DATA || path.join(CLAUDE_DIR, 'session-dash');

module.exports = {
  PORT: Number(process.env.CLAUDE_BUDDY_PORT) || 7777, // 바꾸면 settings.json 의 훅 주소도 같이 바뀐다(다시 연결 필요)
  HOME,
  CLAUDE_DIR,
  SETTINGS: path.join(CLAUDE_DIR, 'settings.json'),
  // 훅 transcript_path 는 이 아래 .jsonl 만 읽는다 — 다른 파일을 읽게 만드는 요청을 막는다
  TRANSCRIPTS: path.join(CLAUDE_DIR, 'projects'),
  DATA,
  SESSIONS: path.join(DATA, 'sessions'),
  BIN: path.join(DATA, 'bin'),
  file: (name) => path.join(DATA, name),
};
