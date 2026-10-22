const $ = (id) => document.getElementById(id);
const api = window.buddySetup;

function paint(st) {
  if (!st) return;
  if (st.error) { msg(st.error, false); return; }
  const mark = (el, on) => { el.textContent = on ? '연결됨' : '연결 안 됨'; el.className = on ? 'on' : 'off'; };
  mark($('sHooks'), st.hooks);
  mark($('sStatus'), st.statusLine);
  $('rowLegacy').hidden = !st.legacy;
  if (st.otherStatusLine) {
    $('statusHint').textContent = '이미 쓰는 상태줄이 있어요 — 그 상태줄은 그대로 보이고, 사용량만 앞에서 저장해요.';
  }
  if (typeof st.login === 'boolean' && (st.hooks || st.statusLine)) $('cLogin').checked = st.login;
  if (st.version) $('ver').textContent = st.version;
  if (Array.isArray(st.editors)) {
    const none = !st.editors.length;
    $('cEditors').disabled = none;
    if (none) $('cEditors').checked = false;
    $('editorsHint').textContent = none
      ? 'Cursor·VS Code 를 찾지 못했어요 — Windows Terminal·PowerShell 탭은 확장 없이도 찾아가요.'
      : `${st.editors.join(', ')} 에 설치해요. 「➜」를 누르면 에디터 안의 정확한 터미널 탭으로 이동해요.`;
  }
  $('bDisconnect').disabled = !st.hooks && !st.statusLine;
  // 연결하기 → 위젯 열기 순서가 보이게: 연결되면 「위젯 열기」가 주 버튼이 된다
  const connected = !!st.hooks;
  $('bWidget').disabled = !connected;
  $('bWidget').classList.toggle('primary', connected);
  $('bConnect').classList.toggle('primary', !connected);
  $('bConnect').textContent = connected ? '다시 연결' : '연결하기';
}

function msg(text, ok) {
  $('msg').textContent = text;
  $('msg').className = ok ? 'ok' : 'bad';
}

async function run(fn, okText) {
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    const r = await fn();
    if (!r || !r.ok) msg((r && r.error) || '실패했어요', false);
    else {
      const ext = (r.ext || []).map((x) => `${x.name} 확장 ${x.ok ? '설치됨' : '설치 실패'}`).join(' · ');
      msg(`${okText}${ext ? `\n${ext}` : ''}${r.backup ? `\n백업: ${r.backup}` : ''}`, true);
    }
    paint(r && r.ok ? r : await api.status());
  } finally {
    for (const b of document.querySelectorAll('button')) b.disabled = false;
    paint(await api.status());
  }
}

$('bConnect').onclick = () => run(() => api.connect({
  hooks: $('cHooks').checked, statusLine: $('cStatus').checked, login: $('cLogin').checked, editors: $('cEditors').checked,
}), '연결했어요! 열려 있는 Claude Code 는 한 번 다시 시작하고, 「위젯 열기」를 눌러 주세요.');
$('bDisconnect').onclick = () => run(() => api.disconnect(), '연결을 해제했어요. 원래 상태줄이 있었다면 되돌렸어요.');
$('bWidget').onclick = () => api.openWidget();

api.status().then(paint);
