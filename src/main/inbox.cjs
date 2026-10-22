// 훅 우편함 — Claude Code 훅(백그라운드 명령)이 이벤트를 ~/.claude/session-dash/inbox/<시각>-<pid>-<난수>.json 으로
// 떨구면, 시간순으로 읽어 기록하고 바로 지운다.
// 포트를 쓰지 않으므로 다른 프로그램이 가로채거나 Claude Code 에 응답을 꾸며 보낼 수 없고, 폴더는 내 계정만 연다.
const fs = require('fs');
const path = require('path');
const P = require('./paths.cjs');
const { record } = require('./record.cjs');

const INBOX = path.join(P.DATA, 'inbox');
const NAME = /^\d{10,20}-\d{1,10}-\d{1,6}\.json$/; // 훅 명령이 만드는 이름만
const MAX_BYTES = 8 << 20;
const MAX_AGE = 7 * 24 * 3600e3; // 일주일 넘게 묵은 이벤트는 반영하지 않고 버린다

// 파일 이름 앞부분(마이크로초)을 이벤트 시각으로 쓴다 — 파일 시각보다 정확하고 조작해도 순서만 바뀐다
const eventTime = (name) => {
  const us = Number(name.split('-')[0]);
  return Number.isFinite(us) && us > 0 ? Math.floor(us / 1000) : Date.now();
};

function processInbox(onChange) {
  let files;
  try { files = fs.readdirSync(INBOX); } catch { return; }
  const now = Date.now();
  let changed = false;
  for (const f of files.filter((x) => NAME.test(x)).sort()) {
    const file = path.join(INBOX, f);
    try {
      const at = Math.min(eventTime(f), now);
      const st = fs.statSync(file);
      if (st.isFile() && st.size <= MAX_BYTES && now - at <= MAX_AGE) {
        const input = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (record(input, at)) changed = true;
      }
    } catch {}
    try { fs.unlinkSync(file); } catch {}
  }
  // 쓰다 만 .tmp(훅이 중간에 끊긴 경우)는 10분, 규칙 밖 이름의 파일은 1시간 뒤 정리
  for (const f of files.filter((x) => !NAME.test(x))) {
    const file = path.join(INBOX, f);
    const ttl = f.endsWith('.tmp') ? 10 * 60e3 : 3600e3;
    try { const st = fs.lstatSync(file); if (st.isFile() && now - st.mtimeMs > ttl) fs.unlinkSync(file); } catch {}
  }
  if (changed && onChange) onChange();
}

function watchInbox(onChange) {
  fs.mkdirSync(INBOX, { recursive: true });
  try { fs.unlinkSync(P.file('hook-token')); } catch {} // 0.5.x 의 HTTP 훅 토큰 — 이제 쓰지 않는다
  processInbox(onChange); // 앱이 꺼져 있던 동안 쌓인 것
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => processInbox(onChange), 40); };
  try { fs.watch(INBOX, soon); } catch {}
  // fs.watch 가 이벤트를 놓치는 경우에 대비한 안전망
  setInterval(() => processInbox(onChange), 30e3).unref();
}

module.exports = { INBOX, watchInbox, processInbox };
