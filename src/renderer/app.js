// 「위에 띄우기」로 다른 문서에 옮겨져도 찾을 수 있게 #app 기준으로 조회한다
const app = document.getElementById('app');
const $ = (id) => app.querySelector('#' + id);
// 5초마다 다시 그린다 — 값이 같으면 DOM 을 건드리지 않아야 다시 칠하지 않는다(투명 펫 창은 칠할 때마다 창 전체를 갱신한다)
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const lastHtml = new WeakMap();
const setHtml = (el, v) => { if (lastHtml.get(el) !== v) { el.innerHTML = v; lastHtml.set(el, v); } };
const setTitle = (el, v) => { if (el.title !== v) el.title = v; };
const setHidden = (el, v) => { if (el.hidden !== v) el.hidden = v; };
// 기록 API 는 앱이 건네준 키가 있어야 응답한다(같은 PC 의 다른 계정·브라우저는 못 읽는다)
const BUDDY_KEY = window.dashApp ? window.dashApp.key() : null;
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'X-Buddy-Key': BUDDY_KEY || '' } });
// 부르는 세션으로 이동(🔔·데스크톱 펫 말풍선) — 가장 먼저 부른 세션부터
async function goWaiting() {
  const s = data && data.sessions.find((x) => x.state === 'waiting' && x.pid);
  if (!s) return;
  try { await api(`/api/focus/${encodeURIComponent(s.sessionId)}`, { method: 'POST' }); } catch {}
}
// 미니 모드(데스크톱 펫) — 같은 페이지를 ?mini=1 로 띄워 펫과 말풍선만 보인다
const MINI = new URLSearchParams(location.search).get('mini') === '1' && !!window.dashApp;
if (MINI) document.body.classList.add('mini');

// 상태마다 여러 캐릭터 — 세션별로 하나가 고정되고, 프레임을 돌려 움직인다
const FACES = {
  working: [
    ['(•̀ᴗ•́)و', '(•̀ᴗ•́)ง'],
    ['ᕦ(ò_óˇ)ᕤ', 'ᕙ(ò_óˇ)ᕗ'],
    ['(ﾉ>ω<)ﾉ', 'ヽ(>ω<ヽ)'],
    ['( ˘▽˘)っ♨', '( ˘▽˘)っ♨~'],
  ],
  waiting: [
    ['(・_・ヾ', '(・_・;)'],
    ['( ・ω・)ノ', '( ・ω・)ノ!'],
  ],
  done: [
    ['(๑˃ᴗ˂)ﻭ', '(๑˃ᴗ˂)ﻭ✧'],
    ['ヽ(•‿•)ノ', 'ヽ(•‿•)ノ♪'],
  ],
  idle: [
    ['(－.－)…z', '(－.－)…zz', '(－.－)…zzz'],
    ['(ᴗ˳ᴗ)…z', '(ᴗ˳ᴗ)…zz', '(ᴗ˳ᴗ)…zzz'],
  ],
};
const SAY = { working: '열일 중', waiting: '불러줘요!', done: '다 했어요', idle: '꿀잠 중' };
const WAIT = { permission_prompt: '이거 해도 돼요? 허락해줘요!', idle_prompt: '다음 할 일 알려줘요!', elicitation_dialog: '질문에 답해줘요!' };
const ORDER = { waiting: 0, working: 1, done: 2, idle: 3 };
// 쉬는 쪽은 느리게 숨 쉬듯, 일하는 쪽은 빠르게
const SPEED = { working: 1, waiting: 1, done: 2, idle: 3 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
let tick = 0;
function frame(id, st) {
  const set = FACES[st][hash(id) % FACES[st].length];
  return set[Math.floor(tick / SPEED[st]) % set.length];
}
function ago(iso) {
  if (!iso) return '';
  const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (sec < 60) return `${Math.floor(sec)}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

function duration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분 ${sec % 60}초`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
// cwd 아래 파일은 상대경로로
function rel(cwd, f) {
  if (cwd && f.toLowerCase().startsWith(cwd.toLowerCase() + '\\')) return f.slice(cwd.length + 1);
  return f;
}

// 일하는 중이면 지금까지, 다 했으면 걸린 시간, 그 외엔 마지막 활동 시각
function workTime(s, st) {
  if ((st === 'working' || st === 'waiting') && s.turnStartedAt) return duration(Date.now() - Date.parse(s.turnStartedAt));
  if (st === 'done' && s.lastTurnMs != null) return `${duration(s.lastTurnMs)} 걸림`;
  return ago(s.updatedAt || s.startedAt);
}

const expanded = new Set(); // 펼친 행 — 다시 그려도 유지
const rowMsgs = new Map(); // 이동 결과 안내 { id: { text, ok, until } }

function detail(s) {
  const parts = [];
  if (s.lastSummaryFull || s.lastSummary) parts.push(`<div><h4>마지막 응답</h4><div class="full">${esc(s.lastSummaryFull || s.lastSummary)}</div></div>`);
  if (s.recentPrompts && s.recentPrompts.length) parts.push(`<div><h4>최근 요청</h4><ol>${s.recentPrompts.map((p) => `<li>${esc(p)}</li>`).join('')}</ol></div>`);
  const files = s.turnFiles && s.turnFiles.length ? s.turnFiles : null;
  if (files) parts.push(`<div><h4>이번 요청에서 수정한 파일</h4><ul>${files.map((f) => `<li title="${esc(f)}">${esc(rel(s.cwd, f))}</li>`).join('')}</ul></div>`);
  const stats = [
    s.contextTokens && `컨텍스트 ${tokens(s.contextTokens)}`,
    s.outputTokens && `출력 누적 ${tokens(s.outputTokens)}`,
    s.files && s.files.length && `세션 전체 수정 파일 ${s.files.length}개`,
    s.cwd,
  ].filter(Boolean);
  if (stats.length) parts.push(`<div class="stats">${esc(stats.join(' · '))}</div>`);
  return `<div class="detail">${parts.join('') || '<div class="stats">아직 기록이 없어요 — 다음 요청부터 쌓여요</div>'}</div>`;
}

function row(s) {
  const st = ORDER[s.state] !== undefined ? s.state : 'idle';
  const name = s.alias || s.name || s.title || s.project || s.sessionId.slice(0, 8);
  const fileCount = s.turnFiles && s.turnFiles.length;
  const meta = [s.project, s.branch && `⎇ ${s.branch}`, fileCount && `파일 ${fileCount}개`, s.contextTokens && `컨텍스트 ${tokens(s.contextTokens)}`]
    .filter(Boolean).join(' · ');
  const canGo = s.pid && s.kind === 'interactive';
  let extra = '';
  if (st === 'waiting') extra = `<div class="line"><span class="q alert">!</span><span class="t alert">${esc(WAIT[s.waitType] || s.message || SAY.waiting)}</span></div>`;
  else if (st === 'working' && s.tool) extra = `<div class="line tool"><span class="q"><span class="spin"></span></span><span class="t">${esc(s.tool)}</span></div>`;
  const msg = rowMsgs.get(s.sessionId);
  const msgHtml = msg && msg.until > Date.now() ? `<div class="row-msg ${msg.ok ? 'ok' : ''}">${esc(msg.text)}</div>` : '';
  return `<div class="row ${st}" data-id="${esc(s.sessionId)}" data-st="${st}" style="--c: var(--${st})">
    <div class="main">
      <div class="head"><span class="face">${esc(frame(s.sessionId, st))}</span><span class="name">${esc(name)}</span>
        <button class="edit" data-name="${esc(s.alias || '')}" title="이름 붙이기">✎</button></div>
      ${meta ? `<div class="meta" title="${esc(s.cwd)}">${esc(meta)}</div>` : ''}
      ${s.lastPrompt ? `<div class="line prompt" title="눌러서 마지막 응답 · 최근 요청 보기"><span class="q">“</span><span class="t">${esc(s.lastPrompt)}</span><span class="fold">${expanded.has(s.sessionId) ? '▴' : '▾'}</span></div>` : ''}
    </div>
    <div class="side">
      <span class="say">${SAY[st]}</span>
      <span class="time">${esc(workTime(s, st))}</span>
      ${canGo ? `<button class="go" title="ε=┌(˙▿˙)┘ 이 세션으로 이동">➜</button>` : ''}
    </div>
    ${extra}
    ${msgHtml}
    ${expanded.has(s.sessionId) ? detail(s) : ''}
  </div>`;
}

let editing = false; // 이름 입력 중에는 목록을 다시 그리지 않는다(입력칸이 날아가므로)
// 펼친 내용을 드래그로 고르는 중에도 다시 그리지 않는다(선택이 풀리므로)
const selecting = () => { const sel = (app.ownerDocument.defaultView || window).getSelection(); return sel && !sel.isCollapsed && app.contains(sel.anchorNode); };

// 서버가 변경을 알릴 때만(/api/events) 데이터를 다시 받는다 — 폴링하지 않는다.
// 경과 시간·밥 소화처럼 시간만 흐르는 표시는 받아 둔 데이터로 다시 그린다(render).
let data = null;
let disconnected = false;
async function load() {
  try {
    const get = (u) => api(u, { cache: 'no-store' }).then((r) => r.json());
    const [s, u, p, pr] = await Promise.all([get('/api/sessions'), get('/api/usage').catch(() => null),
      get('/api/pet').catch(() => ({})), get('/api/prefs').catch(() => null)]);
    data = s;
    lastUsage = u && u.at ? u : null;
    petData = p || {};
    if (pr) prefs = pr;
    disconnected = false;
  } catch {
    disconnected = true;
  }
  render();
}

function render() {
  if (editing || selecting()) return;
  const err = $('err');
  if (disconnected || !data) {
    setText(err, disconnected ? '서버 연결 끊김 — 트레이의 Claude Buddy 가 켜져 있는지 확인해 주세요' : '');
    return;
  }
  {
    const { sessions: all, liveCheck } = data;
    const sessions = all.filter((s) => s.state !== 'ended' && s.state !== 'failed');
    sessions.sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) ||
      Date.parse(b.updatedAt || b.startedAt) - Date.parse(a.updatedAt || a.startedAt));
    const n = (...k) => sessions.filter((s) => k.includes(s.state)).length;
    const waiting = n('waiting');
    setText($('count'), `작업 세션 ${sessions.length}개 · 작업 중 ${n('working')}개`);
    petCounts = { working: n('working'), waiting };
    renderOffWork();
    renderUsage();
    setHidden($('bell'), !waiting); // 누가 부를 때만 나타난다
    $('bell').classList.toggle('on', waiting > 0);
    setHidden($('bellCount'), !waiting);
    setText($('bellCount'), waiting > 9 ? '9+' : String(waiting));
    setTitle($('bell'), waiting ? `작업자 ${waiting}명이 불러요! — 눌러서 이동` : '부르는 세션 없음');
    // 펼친 응답을 스크롤해 둔 위치를 다시 그린 뒤에도 유지
    const scrolls = new Map([...app.querySelectorAll('.row[data-id] .full')].map((el) => [el.closest('.row').dataset.id, el.scrollTop]));
    setHtml($('list'), sessions.map(row).join('') || `<div class="empty">${FACES.idle[0][2]} 다들 퇴근했어요</div>`);
    for (const [id, top] of scrolls) {
      const el = app.querySelector(`.row[data-id="${CSS.escape(id)}"] .full`);
      if (el && el.scrollTop !== top) el.scrollTop = top;
    }
    setText(err, liveCheck === 'ok' || liveCheck === 'pending' ? '' : `생존 확인 불가: ${liveCheck}`);
    const title = waiting ? `(${waiting}) 불러요! — Claude Buddy` : 'Claude Buddy';
    if (document.title !== title) document.title = title;
  }
}

// ── 퇴근까지 ── PC 시간대와 상관없이 KST(Asia/Seoul) 기준
let prefs = { showOffWork: false, offWork: '18:00' };
const KST = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
});
function kstNow() {
  const parts = Object.fromEntries(KST.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { weekday: parts.weekday, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
function renderOffWork() {
  const box = $('offwork');
  setHidden(box, !prefs.showOffWork);
  if (box.hidden) return;
  const [oh, om] = prefs.offWork.split(':').map(Number);
  const now = kstNow();
  const left = oh * 60 + om - now.minutes;
  box.classList.toggle('done', left <= 0 || now.weekday === 'Sat' || now.weekday === 'Sun');
  if (now.weekday === 'Sat' || now.weekday === 'Sun') setHtml(box, '🏖 <b>오늘은 쉬는 날이에요</b>');
  else if (left <= 0) setHtml(box, '🎉 <b>퇴근 시간이에요! 수고하셨어요</b>');
  else {
    const h = Math.floor(left / 60), m = left % 60;
    setHtml(box, `🏠 퇴근까지 <b>${h ? `${h}시간 ` : ''}${m}분</b>`);
  }
  setTitle(box, `퇴근 시간 ${prefs.offWork} (KST) — ⚙ 에서 바꿀 수 있어요`);
}

async function savePrefs(patch) {
  try {
    const r = await api('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prefs, ...patch }) });
    if (r.ok) prefs = await r.json();
  } catch {}
  renderOffWork();
}
// ── ⚙ 메뉴와 설정 화면(탭) ── 메뉴에서 고른 화면이 본 화면 자리를 대신하고, ← 로 돌아온다
const menu = $('menu');
const closeMenu = () => { menu.hidden = true; $('gear').classList.remove('on'); };
$('gear').onclick = (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  $('gear').classList.toggle('on', !menu.hidden);
};
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); showView(null); } });

let currentView = null;
function showView(id) {
  if (currentView === 'viewGame' && id !== 'viewGame') game.stop();
  currentView = id;
  for (const v of app.querySelectorAll('.view')) v.hidden = v.id !== id;
  $('mainView').hidden = !!id;
  $('scroller').scrollTop = 0; // 화면을 바꾸면 본문 맨 위부터
  if (id === 'viewOff') { $('prefOff').checked = !!prefs.showOffWork; $('prefOffTime').value = prefs.offWork; }
  if (id === 'viewDex') renderDex();
  if (id === 'viewGame') gameReady();
  if (id === 'viewGames') renderGames();
  if (id === 'viewMatch') matchStart();
}
for (const b of menu.querySelectorAll('[data-view]')) b.onclick = () => { closeMenu(); showView(b.dataset.view); };
// data-back 에 화면 id 가 있으면 그 화면으로(게임 → 미니게임 목록), 비어 있으면 본 화면으로
for (const b of app.querySelectorAll('[data-back]')) b.onclick = () => showView(b.dataset.back || null);
$('prefOff').onchange = (e) => savePrefs({ showOffWork: e.target.checked });
$('prefOffTime').onchange = (e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) savePrefs({ offWork: e.target.value }); };

// 5시간·주간 한도 — 상태줄이 마지막으로 그려진 시점의 값이라 「N분 전 기준」을 함께 보인다
function untilReset(epochSec) {
  const sec = Math.floor(epochSec - Date.now() / 1000);
  if (!epochSec || sec <= 0) return '';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${Math.max(1, m)}분`;
}
function renderUsage() {
  const box = $('usage');
  const u = lastUsage;
  renderPet();
  if (!u || !u.at || !(u.five_hour || u.seven_day)) { setHidden(box, true); setHidden($('usageTitle'), true); return; }
  const meter = (label, r) => {
    if (!r) return '';
    const p = Math.max(0, Math.min(100, Math.round(r.used_percentage)));
    const c = p >= 85 ? '#fa5252' : p >= 60 ? '#fcc419' : 'var(--working)';
    // 리셋 시각이 지났으면 저장된 사용률은 이미 의미가 없다
    const gone = r.resets_at && r.resets_at * 1000 <= Date.now();
    return `<div class="u" style="--uc:${gone ? 'var(--muted)' : c}"><span class="k">${label}</span>
      <span class="bar"><i style="width:${gone ? 0 : Math.max(p ? 2 : 0, p)}%"></i></span>
      <span class="p">${gone ? '—' : p + '%'}</span><span class="r">${gone ? '리셋됨' : esc(untilReset(r.resets_at))}</span></div>`;
  };
  const over = [u.five_hour, u.seven_day].some((r) => r && r.used_percentage >= 100 && !(r.resets_at * 1000 <= Date.now()));
  const age = Date.now() - u.at;
  box.classList.toggle('stale', age > 30 * 60e3);
  // 한도를 넘은 뒤 이 PC 세션들이 쓴 금액(상태줄이 토큰을 API 가격으로 환산한 추정치)
  const billed = Number(u.billed);
  const billText = over ? `한도 초과 — 추가 과금${Number.isFinite(billed) ? ` ($${billed.toFixed(2)})` : ' 중'}` : '과금 없음';
  setHtml(box, meter('5시간', u.five_hour) + meter('주간', u.seven_day) +
    `<div class="foot"><span class="bill ${over ? 'over' : ''}" title="${over ? '한도를 넘은 뒤 이 PC 의 세션들이 쓴 양을 API 가격으로 환산한 추정치예요 — 실제 청구액과 다를 수 있어요' : ''}">● ${billText}</span>
      <span title="상태줄이 마지막으로 갱신된 시각 기준">${age < 60e3 ? '방금 전' : esc(ago(new Date(u.at).toISOString()))} 기준</span></div>`);
  setHidden(box, false);
  setHidden($('usageTitle'), false);
}

// ── 다마고치 ──
// 레벨은 주간 사용량 %(15%에 부화, 그 뒤 10%마다 1레벨)이라 주간 리셋 때 알로 돌아간다.
// 그 주의 캐릭터는 주간 리셋 시각을 시드로 고른다 — 껐다 켜도 그 주 안에서는 같은 친구다.
// 밥은 hook.cjs 가 응답이 끝날 때마다 pet.json 에 기록한다.
// 도트는 pet-art.js — 미리보기 시트(app/pet-sheet.cjs)와 같이 쓴다. [이름, 아기, 어린이, 어른]
const { PAL: PET_PAL, EGG, SPECIES } = window.PET_ART;
// Lv.0 알(~14%) · 1~2 아기(15~29%) · 3~5 어린이 · 6~10 어른(주간 사용량 60%) — 한도 근처까지 쓰지 않아도 어른이 되게.
// 부화는 15%부터라 Lv.1 만 15~19% 로 짧다. 단계마다 도트가 따로 있어 크기는 같은 배율로 그린다
const HATCH_PCT = 15;
const levelOf = (pct) => (pct < HATCH_PCT ? 0 : Math.min(10, Math.max(1, Math.floor(pct / 10))));
// 지금 레벨이 시작·끝나는 사용량 % — 경험치 막대와 「다음 레벨까지」에 쓴다
const levelSpan = (lv) => [lv === 0 ? 0 : lv === 1 ? HATCH_PCT : lv * 10, lv === 0 ? HATCH_PCT : (lv + 1) * 10];
const stageOf = (lv) => (lv === 0 ? '알' : lv < 3 ? '아기' : lv < 6 ? '어린이' : '어른');
const STAGE_ART = { 아기: 1, 어린이: 2, 어른: 3 };
const PET_PX = MINI ? 5 : 4;
// 위젯과 데스크톱 펫은 localStorage 를 같이 쓴다 — 새 알·작별 알림은 창마다 따로 한 번씩 보이게
const WIN = MINI ? '-mini' : '';
const DIGEST_MS = 30 * 60e3; // 밥 한 칸을 소화하는 시간 — hook.cjs 와 같은 값

let petData = {};
let lastUsage = null;
let petCounts = { working: 0, waiting: 0 };
let petSpriteKey = '';
let petHappyUntil = 0;
let petHatchUntil = 0;
let petArriveUntil = 0; // 주가 바뀌어 새 알이 온 걸 알리는 동안
let petArriveLine = '';
let petByeUntil = 0; // 리셋 하루 전에 한 번 띄우는 작별 인사
let petEditing = false;
let petHappyLine = '';

// 펫 대사 — 밥은 Claude 응답, 많이 먹으면(5시간 사용량) 배부르고 한도를 넘으면 배탈
const PET_SAY = {
  working: ['주인님이 일 시키는 중… 옆에서 응원 중! ✊', '쫑긋! 뭔가 열심히 만드는 소리가 나요', '밥 냄새가 나요… 곧 끝나려나?'],
  crowd: '우와, 친구 {n}명이 동시에 일해요! 바빠 바빠',
  eat: ['냠냠! 맛있다 😋', '꺼억~ 잘 먹었어요'],
  waiting: ['주인님! 누가 불러요! 빨리 와 봐요', '똑똑, 대답해 줘야 해요 ({n})'],
  hungry: ['꼬르륵… 일 좀 시켜 주세요', '심심해요… 놀아 줘요'],
  sleep: ['쿨쿨… 냠냠 꿈 꾸는 중', 'zZ… 꿀잠 자는 중'],
  tired: ['헥헥… 너무 많이 먹었나 봐요', '배불러서 움직이기 힘들어요'],
  sick: ['배탈 났어요… 조금 쉬어요 🤒'],
  pet: ['헤헤 ♥', '간지러워요~', '더 해 주세요!'],
};
// 같은 상태가 이어지면 12초마다 다음 대사로 넘어간다
const pick = (list) => list[Math.floor(Date.now() / 12e3) % list.length];

function petSvg(rows, px, closed) {
  const w = Math.max(...rows.map((r) => r.length));
  const rects = [];
  rows.forEach((line, y) => [...line].forEach((ch, x) => {
    const c = PET_PAL[ch];
    if (!c) return;
    // 잘 때는 눈을 아래쪽 반만 그려 감은 눈처럼
    const [yy, hh] = ch === 'E' && closed ? [y + 0.6, 0.4] : [y, 1.02];
    rects.push(`<rect x="${x}" y="${yy}" width="1.02" height="${hh}" fill="${c}"/>`);
  }));
  return `<svg width="${w * px}" height="${rows.length * px}" viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

function petView() {
  const now = Date.now();
  const live = (r) => r && r.used_percentage != null && !(r.resets_at && r.resets_at * 1000 <= now);
  const wk = lastUsage && lastUsage.seven_day;
  let week = live(wk) ? wk.resets_at : null;
  let pct = week ? wk.used_percentage : 0;
  let byTokens = false;
  // 사용량이 오지 않는 계정(API 키 로그인 등)은 이번 주 출력 토큰으로 자란다 — 100만 토큰 = 100%
  // 주간이 막 초기화돼 사용량이 아직 안 온 구독 계정은 토큰으로 넘어가지 않고 새 사용량을 기다린다
  if (!week && !hasUsageAccount() && petData.tokenWeek === weekKey()) {
    week = `w${petData.tokenWeek}`;
    pct = Math.min(100, ((petData.weekTokens || 0) / 1e6) * 100);
    byTokens = true;
  }
  // 새 알이 오는 시각 — 사용량 계정은 주간 리셋, 토큰 계정은 다음 주 월요일 0시(로컬)
  const today = new Date(now);
  const resetAt = !week ? null : byTokens
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) + 7).getTime()
    : wk.resets_at * 1000;
  const lv = levelOf(pct);
  const stage = stageOf(lv);
  const sp = week ? SPECIES[hash(String(week)) % SPECIES.length] : null;
  const fh = lastUsage && live(lastUsage.five_hour) ? lastUsage.five_hour.used_percentage : 0;
  const fedAgo = petData.lastFedAt ? now - petData.lastFedAt : Infinity;
  // 한 끼에 +1칸, 30분에 1칸씩 연속으로 소화 — 예전 기록(food 없음)은 꽉 찬 상태에서 소화를 시작한다
  const base = petData.food != null ? petData.food : petData.lastFedAt ? 5 : 0;
  const since = petData.foodAt || petData.lastFedAt || now;
  const food = Math.round(Math.max(0, Math.min(5, base - (now - since) / DIGEST_MS)));
  return { now, week, pct, lv, stage, sp, fh, fedAgo, food, byTokens, resetAt };
}

// 주간 사용량을 받아 본 계정 — 지난 사용량이 남아 있거나 도감에 사용량 주(resets_at 키)가 있다
function hasUsageAccount() {
  return !!(lastUsage && lastUsage.seven_day) || Object.keys(petData.collection || {}).some((k) => !k.startsWith('w'));
}

// 한 번만 띄울 일을 창마다 기억한다 — 처음이면 true
function firstTime(key) {
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, '1'); return true; } catch { return false; }
}

// 받침이 있으면 '은', 없으면(영문 이름 포함) '는'
const topic = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? '은' : '는'; };

// 새 알 도착 인사 — 지난주 친구(이번 주가 아닌 도감 기록 중 가장 최근)를 함께 알려 준다.
// 지난주에 부화를 못 했으면 그 전 주 친구를 「지난주」라 부르지 않도록 지난주 안의 기록만 본다
function arriveLine(v) {
  const since = v.resetAt ? v.resetAt - 14 * 864e5 : 0;
  const last = Object.entries(petData.collection || {})
    .filter(([k, c]) => k !== String(v.week) && c && (c.at || 0) >= since && SPECIES.some((sp) => sp[0] === c.species))
    .map(([, c]) => c).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  if (!last) return '새 알이 도착했어요! 이번 주엔 누가 태어날까?';
  const lv = Math.max(0, Math.min(10, Math.floor(Number(last.lv)) || 0));
  return `새 알이 도착했어요! 지난주 ${last.species}${topic(last.species)} 도감에 있어요 (${stageOf(lv)}까지 자랐어요)`;
}

// 리셋 24시간 전부터의 작별 대사 — 남은 시간과, 어른이 아직이면 남은 사용량을 같이
function byeLine(v, egg) {
  const h = Math.max(1, Math.ceil((v.resetAt - v.now) / 36e5));
  if (egg) return `${h}시간 뒤면 새 알로 바뀌어요… 부화까지 ${Math.ceil(HATCH_PCT - v.pct)}%!`;
  if (v.stage !== '어른') return `어른까지 ${Math.ceil(60 - v.pct)}% 남았어요! ${h}시간 안에 될까요?`;
  return `${h}시간 뒤면 새 알이 와요… 오늘 많이 놀아 줘요!`;
}

// record.cjs 의 weekKey 와 같은 식 — 이번 주 월요일(로컬) 날짜
function weekKey(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return m.toLocaleDateString('sv');
}

function renderPet() {
  if (petEditing) return;
  const v = petView();
  const egg = v.lv === 0 || !v.sp;

  if (!egg) collect(v);

  // 부화 직후 한 번 축하 — 그 주에 이미 봤으면 다시 띄우지 않는다
  if (!egg && firstTime(`pet-hatched-${v.week}`)) petHatchUntil = v.now + 10e3;

  // 주가 바뀐 뒤 처음 볼 때 새 알 도착을 알린다(처음 설치한 주는 알릴 게 없다)
  if (v.week) {
    let prev = null;
    try { prev = localStorage.getItem(`pet-week${WIN}`); localStorage.setItem(`pet-week${WIN}`, String(v.week)); } catch {}
    if (prev && prev !== String(v.week)) { petArriveUntil = v.now + 15e3; petArriveLine = arriveLine(v); }
  }

  // 마지막 날 — 들어설 때 한 번 말풍선, 그 뒤로는 쉬는 동안의 대사로
  const lastDay = !!v.resetAt && v.resetAt > v.now && v.resetAt - v.now <= 864e5;
  if (lastDay && firstTime(`pet-bye-${v.week}${WIN}`)) petByeUntil = v.now + 10e3;
  const bye = lastDay ? byeLine(v, egg) : '';

  const { working, waiting } = petCounts;
  let mood, say;
  if (petArriveUntil > v.now) { mood = egg ? 'wobble' : 'hop'; say = petArriveLine; }
  else if (petByeUntil > v.now) { mood = egg ? 'wobble' : 'hop'; say = bye; }
  else if (egg) {
    mood = working ? 'wobble' : 'still';
    say = bye || '두근두근! 누가 태어날까?';
  } else if (petHatchUntil > v.now) { mood = 'hop'; say = '짠! 클마고치가 태어났어요'; }
  else if (petHappyUntil > v.now) { mood = 'hop'; say = petHappyLine; }
  else if (v.fh >= 100) { mood = 'sick'; say = pick(PET_SAY.sick); }
  else if (waiting) { mood = 'shake'; say = pick(PET_SAY.waiting).replace('{n}', waiting); }
  else if (v.fh >= 85) { mood = 'tired'; say = pick(PET_SAY.tired); }
  else if (v.fedAgo < 60e3) {
    mood = 'hop';
    say = petData.overfullAt && v.now - petData.overfullAt < 60e3 ? '배불러요~ 더는 못 먹어요' : pick(PET_SAY.eat);
  }
  else if (working > 1) { mood = 'hop'; say = PET_SAY.crowd.replace('{n}', working); }
  else if (working) { mood = 'hop'; say = pick(PET_SAY.working); }
  else if (v.food === 0) { mood = 'still'; say = bye || pick(PET_SAY.hungry); }
  else { mood = 'sleep'; say = bye || pick(PET_SAY.sleep); }

  const sprite = $('petSprite');
  const art = egg ? EGG : v.sp[STAGE_ART[v.stage]];
  const closed = mood === 'sleep';
  const key = [egg ? 'egg' : v.sp[0], v.stage, closed].join('|');
  if (key !== petSpriteKey) {
    sprite.querySelector('.pet-body').innerHTML = petSvg(art, PET_PX, closed);
    petSpriteKey = key;
  }
  for (const c of ['hop', 'shake', 'wobble', 'sick']) sprite.classList.toggle(c, mood === c);
  const fx = sprite.querySelector('.pet-fx');
  const FX = { sleep: ['zz', 'zZ'], shake: ['bang', '!'], tired: ['sweat', '💧'], sick: ['sweat', '💧'] };
  const sparkle = (petHatchUntil > v.now && !egg) || petArriveUntil > v.now;
  const [fxc, fxt] = sparkle ? ['spark', '✦'] : FX[mood] || ['', ''];
  if (fx.className !== `pet-fx ${fxc}`) fx.className = `pet-fx ${fxc}`;
  setText(fx, fxt);

  const named = petData.name && petData.nameWeek === v.week;
  // 「여우(아기)」처럼 이름 뒤에 단계를 붙인다 — 이름을 고칠 때는 petData.name 만 쓰므로 괄호는 섞이지 않는다
  setText($('petName'), egg ? '알' : `${named ? petData.name : v.sp[0]}(${v.stage})`);
  setTitle($('petName'), egg ? '' : '더블클릭해서 이름 짓기');
  // 다음 단계까지 남은 % 를 늘 보이게 — 알 → 부화, 아기 → 어린이, 어린이 → 어른. 어른은 더 갈 곳이 없다
  const NEXT = { 알: ['부화', HATCH_PCT], 아기: ['어린이', 30], 어린이: ['어른', 60] };
  const [nextName, nextAt] = NEXT[egg ? '알' : v.stage] || [];
  const toNext = nextName ? `${nextName}까지 ${Math.max(1, Math.ceil(nextAt - v.pct))}%` : '';
  // 레벨 숫자는 빼고 다음 단계까지 남은 % 만 — 단계는 이름 뒤 괄호에 있다
  setText($('petLv'), toNext && `· ${toNext}`);
  const meals = petData.mealsDate === new Date().toLocaleDateString('sv') ? petData.mealsToday || 0 : 0;
  setHtml($('petFood'), `밥 <b>${'▰'.repeat(v.food)}</b>${'▱'.repeat(5 - v.food)}`);
  setTitle($('petFood'), `오늘 ${meals}끼 — 응답이 끝날 때마다 한 칸씩 차고, ${DIGEST_MS / 60e3}분에 한 칸씩 소화해요`);
  setText($('petSay'), say);
  if (MINI) {
    // 데스크톱 펫은 평소엔 말이 없다 — 부를 때·먹을 때·부화·쓰다듬을 때·새 알·작별 인사 때만 말풍선(마우스를 올려도 보임)
    const event = petHatchUntil > v.now || petHappyUntil > v.now || v.fedAgo < 60e3 || v.fh >= 100;
    const notice = petArriveUntil > v.now || petByeUntil > v.now; // 알일 때도 보인다
    $('petSay').classList.toggle('show', notice || (!egg && (waiting > 0 || event)));
    $('petSay').classList.toggle('call', !egg && waiting > 0);
    setTitle($('petSay'), waiting ? '눌러서 그 세션으로 이동' : '');
    sendPetHit();
  }
  const [from, to] = levelSpan(v.lv);
  const exp = v.lv >= 10 ? 100 : Math.max(0, Math.min(100, ((v.pct - from) / (to - from)) * 100));
  const bar = $('petExp').firstElementChild;
  if (bar.style.width !== `${exp}%`) bar.style.width = `${exp}%`;
}

// ── 버디 도감 ── 그 주의 친구와 최고 레벨을 기록한다(레벨이 오를 때만 저장 요청)
let collecting = false;
async function collect(v) {
  const col = petData.collection || {};
  const prev = col[v.week];
  if (collecting || (prev && prev.species === v.sp[0] && prev.lv >= v.lv)) return;
  collecting = true;
  try {
    const r = await api('/api/pet/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week: String(v.week), species: v.sp[0], lv: v.lv }) });
    if (r.ok) petData.collection = await r.json();
  } catch {}
  collecting = false;
  if (currentView === 'viewDex') renderDex();
}

// 도감에서 캐릭터별 최고 레벨·만난 주 수 — 도감과 짝 맞추기가 같이 쓴다
function dexBest() {
  const entries = Object.entries(petData.collection || {});
  // 예전 버전은 주간 초기화 직후 토큰 주로 잘못 넘어가 못 본 친구를 기록했다 —
  // 사용량 주와 일주일 안쪽으로 겹치는 토큰 주(w...)는 그 흔적이라 빼고 센다
  const usageAt = entries.filter(([k]) => !k.startsWith('w')).map(([k]) => Number(k) * 1000);
  const col = entries.filter(([k, c]) => !k.startsWith('w') || !c
    || !usageAt.some((t) => Math.abs(t - c.at) <= 7 * 864e5)).map(([, c]) => c);
  const best = new Map();
  for (const c of col) {
    // 파일에서 읽은 값이라 화면에 넣기 전에 숫자·알려진 이름으로 좁힌다
    if (!c || !SPECIES.some((sp) => sp[0] === c.species)) continue;
    const lv = Math.max(0, Math.min(10, Math.floor(Number(c.lv)) || 0));
    const b = best.get(c.species) || { lv: 0, weeks: 0 };
    best.set(c.species, { lv: Math.max(b.lv, lv), weeks: b.weeks + 1 });
  }
  return best;
}
// 못 만난 친구는 어린이 모습의 실루엣으로
const silhouette = (rows) => rows.map((r) => r.replace(/[^.]/g, 'k'));

function renderDex() {
  const best = dexBest();
  $('dexCount').textContent = `${best.size} / ${SPECIES.length}`;
  $('dex').innerHTML = SPECIES.map((sp) => {
    const b = best.get(sp[0]);
    if (!b) {
      return `<div class="dex-cell unknown"><div class="dex-art">${petSvg(silhouette(sp[2]), 3, false)}</div>
        <div class="dex-name">???</div><div class="dex-meta">아직 못 만났어요</div></div>`;
    }
    const stage = stageOf(b.lv);
    return `<div class="dex-cell" title="${esc(sp[0])} — ${stage}까지 자랐어요">
      <div class="dex-art">${petSvg(sp[STAGE_ART[stage]], 3, false)}</div>
      <div class="dex-name">${esc(sp[0])}</div><div class="dex-meta">${stage} · ${b.weeks}번</div></div>`;
  }).join('');
}

// ── 데스크톱 펫 조작 ── 끌어서 옮기기 · 더블클릭으로 위젯 · 부르는 말풍선을 누르면 그 세션으로
let dragged = false;
if (MINI) {
  const sprite = $('petSprite');
  let drag = null;
  // 창 위치 계산은 메인이 실제 커서 좌표로 한다 — 여기서는 시작·이동·끝만 알린다
  sprite.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.screenX, y: e.screenY };
    dragged = false;
    sprite.setPointerCapture(e.pointerId);
    dashApp.petDragStart();
  });
  sprite.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!dragged && Math.abs(e.screenX - drag.x) + Math.abs(e.screenY - drag.y) < 4) return; // 클릭과 구분
    dragged = true;
    dashApp.petDragMove();
  });
  const endDrag = () => { if (drag) { drag = null; dashApp.petDragEnd(); } };
  sprite.addEventListener('pointerup', endDrag);
  sprite.addEventListener('pointercancel', endDrag);
  sprite.addEventListener('lostpointercapture', endDrag);
  sprite.addEventListener('dblclick', () => dashApp.setMini(false));

  $('petSay').addEventListener('click', goWaiting);

  // 펫·말풍선 위가 아니면 클릭이 아래 창으로 통과한다 — 판정은 메인이 커서 위치로 하고, 여기서는 자리만 알린다
  dashApp.onPetHover((over) => { $('pet').classList.toggle('hover', over); sendPetHit(); });
  window.addEventListener('resize', sendPetHit);
}

let lastHit = '';
function sendPetHit() {
  if (!MINI) return;
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
  const hit = { sprite: box($('petSprite')), say: box($('petSay')), sayShown: $('petSay').classList.contains('show') };
  const key = JSON.stringify(hit);
  if (key !== lastHit) { lastHit = key; dashApp.petHit(hit); }
}

$('petSprite').onclick = () => {
  if (dragged) { dragged = false; return; }
  if (petView().lv === 0) return;
  petHappyUntil = Date.now() + 2000;
  petHappyLine = PET_SAY.pet[Math.floor(Math.random() * PET_SAY.pet.length)];
  const h = document.createElement('span');
  h.className = 'pet-heart';
  h.textContent = '♥';
  $('petSprite').appendChild(h);
  setTimeout(() => h.remove(), 1000);
  renderPet();
};

// ── 밥 받기 ── 30초 미니게임(game.js). 지금 키우는 모습 그대로 받고, 끝나면 펫이 한마디 한다.
// 보상은 기분뿐 — 레벨(주간 사용량)과 밥 칸(Claude 응답)은 건드리지 않는다
let gameCallsAt = 0;
const game = window.FoodGame.create($('gameCanvas'), {
  pal: PET_PAL,
  art: () => { const v = petView(); return v.lv === 0 || !v.sp ? EGG : v.sp[STAGE_ART[v.stage]]; },
  // 게임을 시작한 뒤 새로 부르는 세션이 생기면 멈춘다
  calling: () => petCounts.waiting > gameCallsAt,
  onTick: (left, score) => setText($('gameHud'), `⏱ ${Math.ceil(left / 1000)}초 · 🍙 ${score}`),
  onPause: (why) => gameMsg(why === 'call' ? '<b>🔔 Claude 가 불러요!</b><span class="muted">대답하고 와서 이어 해요</span>' : '<b>잠깐 멈췄어요</b>',
    [['계속하기', () => { gameCallsAt = petCounts.waiting; gameMsg(); game.resume(); }]]),
  onEnd: (score) => {
    const best = gameBest();
    if (score > best) { try { localStorage.setItem('game-best', String(score)); } catch {} }
    gameMsg(`<b>${score > best ? '🎉 최고 기록!' : '끝!'} ${score}점</b><span class="muted">최고 ${Math.max(best, score)}점</span>`,
      [['한 판 더', gameStart], ['펫 보러 가기', () => showView(null)]]);
    petHappyUntil = Date.now() + 5000;
    petHappyLine = score >= 25 ? '배 터지겠어요! 최고의 밥 받기 😋' : score >= 10 ? `냠냠 ${score}점! 또 놀아 줘요` : '헤헤, 다음엔 더 잘 받을게요!';
  },
});
function gameBest() {
  try { return Number(localStorage.getItem('game-best')) || 0; } catch { return 0; }
}
// 판 위 안내·결과 — 버튼은 [이름, 할 일]
function gameMsg(html, buttons = []) {
  const box = $('gameMsg');
  box.hidden = !html;
  box.innerHTML = html || '';
  for (const [label, fn] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    box.appendChild(b);
  }
}
function gameReady() {
  game.stop();
  const best = gameBest();
  setText($('gameHud'), best ? `최고 ${best}점` : '');
  gameMsg('<b>🍚 밥 받기 · 30초</b><span class="muted">떨어지는 밥을 받아요. 🐞 버그는 피하고!</span>', [['시작', gameStart]]);
}
function gameStart() {
  gameCallsAt = petCounts.waiting;
  gameMsg();
  game.start();
}
$('gameBtn').onclick = (e) => { e.stopPropagation(); showView('viewGames'); };

// ── 미니게임 목록 ── 게임마다 최고 기록을 같이 보인다
function renderGames() {
  const food = gameBest();
  const match = matchBest();
  setText($('bestFood'), food ? `최고 ${food}점` : '아직 기록 없음');
  setText($('bestMatch'), match ? `최고 ${match}번 만에` : '아직 기록 없음');
}
for (const b of app.querySelectorAll('[data-game]')) b.onclick = () => showView(b.dataset.game);

// ── 도감 짝 맞추기 ── 카드 12장(6쌍)을 뒤집어 같은 친구를 찾는다. 시간 제한 없이 몇 번 뒤집었는지로 겨룬다.
// 만난 친구는 가장 많이 키운 모습, 못 만난 친구는 실루엣 — 모양은 달라 짝은 맞출 수 있다
const MATCH_PAIRS = 6;
let match = null;
function matchBest() {
  try { return Number(localStorage.getItem('match-best')) || 0; } catch { return 0; }
}
function matchStart() {
  const best = dexBest();
  // 만난 친구를 먼저 다 넣고(6마리가 넘으면 그중 무작위 6), 모자란 자리만 못 만난 친구로 채운다
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
  const met = shuffle(SPECIES.filter((sp) => best.has(sp[0])));
  const unmet = shuffle(SPECIES.filter((sp) => !best.has(sp[0])));
  const pool = [...met, ...unmet].slice(0, MATCH_PAIRS);
  const cards = [];
  for (const sp of pool) {
    const b = best.get(sp[0]);
    const art = b ? sp[STAGE_ART[stageOf(Math.max(1, b.lv))]] : silhouette(sp[2]);
    const card = { name: b ? sp[0] : '???', svg: petSvg(art, 3, false) };
    cards.push({ ...card, id: sp[0] }, { ...card, id: sp[0] });
  }
  // 피셔-예이츠 섞기
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  match = { cards, open: [], done: new Set(), tries: 0, lock: false };
  $('matchMsg').hidden = true;
  $('match').innerHTML = cards.map((c, i) => `<button class="mcard" data-i="${i}" aria-label="카드 ${i + 1}">
    <span class="mface">${c.svg}<small>${esc(c.name)}</small></span></button>`).join('');
  for (const el of $('match').querySelectorAll('.mcard')) el.onclick = () => matchFlip(Number(el.dataset.i));
  matchHud();
}
function matchHud() {
  const best = matchBest();
  setText($('matchHud'), `${match.tries}번 뒤집음 · ${match.done.size}/${MATCH_PAIRS}쌍${best ? ` · 최고 ${best}번` : ''}`);
}
function matchFlip(i) {
  const m = match;
  if (!m || m.lock || m.done.has(m.cards[i].id) || m.open.includes(i)) return;
  const el = (k) => $('match').querySelector(`[data-i="${k}"]`);
  el(i).classList.add('open');
  m.open.push(i);
  if (m.open.length < 2) return;
  m.tries++;
  const [a, b] = m.open;
  if (m.cards[a].id === m.cards[b].id) {
    m.done.add(m.cards[a].id);
    el(a).classList.add('done'); el(b).classList.add('done');
    m.open = [];
    matchHud();
    if (m.done.size === MATCH_PAIRS) matchEnd();
    return;
  }
  m.lock = true;
  matchHud();
  setTimeout(() => {
    el(a).classList.remove('open'); el(b).classList.remove('open');
    m.open = []; m.lock = false;
  }, 800);
}
function matchEnd() {
  const tries = match.tries;
  const best = matchBest();
  const record = !best || tries < best;
  if (record) { try { localStorage.setItem('match-best', String(tries)); } catch {} }
  const box = $('matchMsg');
  box.hidden = false;
  box.innerHTML = `<b>${record ? '🎉 최고 기록!' : '다 찾았어요!'} ${tries}번 만에</b>
    <span class="muted">최고 ${record ? tries : best}번 · 6쌍이면 6번이 가장 좋은 기록이에요</span>`;
  for (const [label, fn] of [['한 판 더', matchStart], ['펫 보러 가기', () => showView(null)]]) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = fn;
    box.appendChild(btn);
  }
  petHappyUntil = Date.now() + 5000;
  petHappyLine = tries <= 9 ? '우와, 기억력 천재! 친구들이 다 기억났어요' : tries <= 14 ? `${tries}번 만에 다 찾았어요! 또 해요` : '헤헤, 친구들 얼굴 많이 봤죠?';
  matchHud();
}

$('petName').ondblclick = () => {
  const v = petView();
  if (v.lv === 0 || !v.sp) return;
  const el = $('petName');
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = petData.nameWeek === v.week ? petData.name || '' : '';
  input.placeholder = v.sp[0];
  input.maxLength = 20;
  petEditing = true;
  el.replaceWith(input);
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save) {
      try {
        petData = await (await api('/api/pet', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.value, week: v.week }) })).json();
      } catch {}
    }
    input.replaceWith(el);
    petEditing = false;
    renderPet();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
};

function measureFaces() {
  const probe = document.createElement('span');
  probe.className = 'face';
  probe.style.cssText = 'position:absolute;visibility:hidden;width:auto';
  app.appendChild(probe);
  let max = 0;
  for (const f of Object.values(FACES).flat(2)) {
    probe.textContent = f;
    max = Math.max(max, probe.getBoundingClientRect().width);
  }
  probe.remove();
  app.style.setProperty('--face-w', `${Math.ceil(max)}px`);
}
measureFaces();
document.fonts && document.fonts.ready.then(measureFaces);

// 카오모지 프레임만 갈아끼운다 — 목록 전체를 다시 그리지 않아 깜빡임이 없다. 창이 안 보이면 쉰다.
setInterval(() => {
  if (document.hidden) return;
  tick++;
  for (const r of app.querySelectorAll('.row[data-id]')) {
    const f = r.querySelector('.face');
    if (f) f.textContent = frame(r.dataset.id, r.dataset.st);
  }
}, 700);

function startEdit(btn) {
  const row = btn.closest('.row');
  const nameEl = row.querySelector('.name');
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = btn.dataset.name || '';
  input.placeholder = nameEl.textContent;
  input.maxLength = 40;
  editing = true;
  nameEl.replaceWith(input);
  btn.hidden = true;
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save) {
      await api(`/api/name/${encodeURIComponent(row.dataset.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.value }),
      }).catch(() => {});
    }
    editing = false;
    lastHtml.delete($('list')); // 입력칸으로 바꿔 둔 줄을 같은 내용이어도 다시 그린다
    load();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

$('list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.edit');
  if (btn) { e.stopPropagation(); return startEdit(btn); }
  const row = e.target.closest('.row[data-id]');
  if (!row || editing) return;
  const id = row.dataset.id;

  // ➜ 그 세션이 떠 있는 창(터미널·IDE)으로 이동
  const go = e.target.closest('.go');
  if (go) {
    go.classList.add('busy');
    let msg;
    try {
      const r = await api(`/api/focus/${encodeURIComponent(id)}`, { method: 'POST' });
      const body = await r.json();
      msg = r.ok
        ? { ok: true, text: body.terminal ? 'ε=┌(˙▿˙)┘ 그 탭으로 이동했어요' : 'ε=┌(˙▿˙)┘ 창으로 이동했어요 (탭은 못 찾았어요)' }
        : { ok: false, text: body.error || '창을 찾을 수 없어요' };
    } catch {
      msg = { ok: false, text: '서버 연결 끊김' };
    }
    rowMsgs.set(id, { ...msg, until: Date.now() + (msg.ok ? 2500 : 6000) });
    return load();
  }

  // 요청 내용(3줄)을 눌렀을 때만 펼치고 접는다 — 글자를 고르는 중이면 그대로 둔다
  if (!e.target.closest('.line.prompt') || selecting()) return;
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  render();
});

// Document Picture-in-Picture: 다른 창 위에 항상 떠 있는 작은 창 (Chrome·Edge 116+)
const pin = $('pin');
$('bell').onclick = goWaiting;
$('quit').onclick = () => window.dashApp && dashApp.close();

if (window.dashApp) {
  // 위젯 앱: 📌 아이콘이 창 자체의 「위에 고정」을 토글한다
  document.body.classList.add('desk');
  const pinBtn = $('pinBtn');
  const paint = (on) => {
    pinBtn.classList.toggle('on', !!on);
    pinBtn.title = on ? '위에 고정됨 — 눌러서 해제' : '다른 창 위에 항상 떠 있게';
  };
  pinBtn.hidden = false;
  dashApp.getPin().then(paint);
  pinBtn.onclick = async () => paint(await dashApp.setPin(!pinBtn.classList.contains('on')));
  $('winMin').onclick = () => dashApp.minimize();
  $('miniBtn').hidden = false;
  $('miniBtn').onclick = () => dashApp.setMini(true);
} else if ('documentPictureInPicture' in window) {
  pin.hidden = false;
  pin.onclick = async () => {
    const pip = await documentPictureInPicture.requestWindow({ width: 460, height: 520 });
    for (const st of document.querySelectorAll('style')) pip.document.head.appendChild(st.cloneNode(true));
    pip.document.title = document.title;
    pip.document.body.appendChild(app);
    pin.hidden = true;
    pip.addEventListener('pagehide', () => { document.body.appendChild(app); pin.hidden = false; });
  };
}

// 변경 알림 — 서버가 끊기면 EventSource 가 알아서 다시 붙는다(retry 3초)
// 숨겨 둔 창은 연결을 끊는다: 훅마다 다시 읽지 않고, 서버도 보는 창이 없으면 세션 생존 확인(claude agents)을 멈춘다.
// 처음 한 번은 숨긴 채로도 읽어 둔다 — 창을 띄우는 순간 빈 화면이 보이지 않게.
let events = null;
const listen = () => {
  if (events) return;
  events = new EventSource(`/api/events?k=${encodeURIComponent(BUDDY_KEY || '')}`);
  events.onmessage = () => load();
  events.onerror = () => { disconnected = true; render(); };
};
if (document.hidden) load(); else listen();
// 시간만 흐르는 표시(경과 시간·소화·리셋까지 남은 시간) — 보일 때만 5초마다
setInterval(() => { if (!document.hidden) render(); }, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (events) { events.close(); events = null; } return; }
  render();
  listen(); // 연결되자마자 서버가 change 를 보내 최신으로 다시 읽는다
});
