// 로컬 서버 보안 시험 — 임시 데이터 폴더와 다른 포트로 서버를 띄워 요청을 보내 본다.
//   npm run security-test
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-sec-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.CLAUDE_BUDDY_PORT = '17777';
// 개발자 환경 변수가 실제 데이터 폴더를 가리키더라도 시험은 임시 폴더만 쓴다
process.env.CLAUDE_BUDDY_DATA = path.join(home, '.claude', 'session-dash');
delete process.env.CLAUDE_CONFIG_DIR;
const { startServer } = require('../src/main/server.cjs');

const PORT = 17777;
let KEY = '';
// /api 요청에는 기본으로 UI 키를 붙인다(키 없는 경우를 시험할 때는 noKey)
function req({ method = 'GET', url = '/', headers = {}, body, noKey = false }) {
  const keyHeader = url.startsWith('/api') && !noKey ? { 'X-Buddy-Key': KEY } : {};
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: url,
      headers: { Host: `127.0.0.1:${PORT}`, ...keyHeader, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', (e) => resolve({ status: 0, body: String(e) }));
    if (body) r.write(body);
    r.end();
  });
}

let fails = 0;
const expect = (name, ok) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const { processInbox, INBOX } = require('../src/main/inbox.cjs');
const { server, uiKey } = startServer({
  onReady: async () => {
    KEY = uiKey;
    const D = path.join(home, '.claude', 'session-dash');
    // 훅 우편함 — 훅 명령이 만드는 이름만, 크기·나이 제한 안에서만 기록하고 처리한 파일은 지운다
    const drop = (name, body) => fs.writeFileSync(path.join(INBOX, name), body);
    const us = (ms) => String(ms * 1000);

    // UI 키 — 같은 PC 의 다른 계정·브라우저가 기록을 읽지 못하게
    expect('키 없이 세션 목록 401', (await req({ url: '/api/sessions', noKey: true })).status === 401);
    expect('틀린 키 401', (await req({ url: '/api/sessions', headers: { 'X-Buddy-Key': 'b'.repeat(64) } })).status === 401);
    expect('키 없이 SSE 401', (await req({ url: '/api/events', noKey: true })).status === 401);
    expect('키 없이 창 이동 401', (await req({ method: 'POST', url: '/api/focus/s1', noKey: true })).status === 401);
    expect('UI 키는 64자 무작위 16진', /^[a-f0-9]{64}$/.test(uiKey));
    expect('올바른 키 200', (await req({ url: '/api/sessions' })).status === 200);
    expect('특수 키(__proto__) 이름 저장 거절', (await req({ method: 'POST', url: '/api/name/__proto__', body: '{"name":"x"}' })).status === 400);

    expect('정상 페이지 200 + CSP', await req({ url: '/' }).then((r) => r.status === 200 && /script-src 'self'/.test(r.headers['content-security-policy'])));
    expect('다른 Host(DNS 리바인딩) 403', (await req({ url: '/api/sessions', headers: { Host: 'evil.example:17777' } })).status === 403);
    expect('다른 Origin 403', (await req({ url: '/api/sessions', headers: { Origin: 'https://evil.example' } })).status === 403);
    expect('교차 사이트 요청 403', (await req({ url: '/api/sessions', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403);
    expect('교차 사이트 이름 변경 POST 403', (await req({ method: 'POST', url: '/api/name/s1', headers: { Origin: 'https://evil.example' }, body: '{"name":"x"}' })).status === 403);
    expect('HTTP 훅 창구는 없음', (await req({ method: 'POST', url: '/hook', body: '{}' })).status !== 200);
    drop(us(Date.now()) + '-1-1.json', '{"session_id":"s1","hook_event_name":"SessionStart"}');
    drop('evil.json', '{"session_id":"s3","hook_event_name":"SessionStart"}');
    drop(us(Date.now() - 8 * 24 * 3600e3) + '-1-2.json', '{"session_id":"s4","hook_event_name":"SessionStart"}');
    drop(us(Date.now()) + '-1-3.json', JSON.stringify({ session_id: 's2', hook_event_name: 'Stop', x: 'a'.repeat(9 << 20) }));
    drop(us(Date.now()) + '-1-4.json', '{not json');
    drop(us(Date.now()) + '-1-5.json', '{"session_id":"../x","hook_event_name":"Stop"}');
    processInbox();
    expect('우편함: 정상 이벤트 기록', fs.existsSync(path.join(D, 'sessions', 's1.json')));
    expect('우편함: 규칙 밖 이름은 무시', !fs.existsSync(path.join(D, 'sessions', 's3.json')));
    expect('우편함: 일주일 넘은 이벤트는 버림', !fs.existsSync(path.join(D, 'sessions', 's4.json')));
    expect('우편함: 너무 큰 이벤트는 기록 안 함', !fs.existsSync(path.join(D, 'sessions', 's2.json')));
    expect('우편함: 잘못된 세션 id 무시', !fs.existsSync(path.join(D, 'x.json')));
    expect('우편함: 처리한 파일은 지움(규칙 밖 이름은 남김)', JSON.stringify(fs.readdirSync(INBOX)) === '["evil.json"]');
    const notServed = (r) => r.status !== 200 && !r.body.includes('require(') && !r.body.includes('"name"');
    expect('정적 파일 경로 탈출 거절', notServed(await req({ url: '/../package.json' })));
    expect('목록에 없는 파일 거절', notServed(await req({ url: '/main.cjs' })));
    expect('키가 있어도 목록 밖 파일은 404', (await req({ url: '/api/../main/main.cjs' })).status !== 200);
    const prefsPost = (body, headers = {}) => req({ method: 'POST', url: '/api/prefs', headers: { 'Content-Type': 'application/json', ...headers }, body });
    expect('설정 교차 출처 저장 403', (await prefsPost('{"showOffWork":true}', { Origin: 'https://evil.example' })).status === 403);
    const badTime = JSON.parse((await prefsPost('{"offWork":"25:99","showOffWork":"yes"}')).body);
    expect('잘못된 퇴근 시간·형식은 무시', badTime.offWork === '18:00' && badTime.showOffWork === false);
    const goodTime = JSON.parse((await prefsPost('{"offWork":"19:30","showOffWork":true,"evil":"<script>"}')).body);
    expect('올바른 설정 저장·모르는 키 버림', goodTime.offWork === '19:30' && goodTime.showOffWork === true
      && !fs.readFileSync(path.join(home, '.claude', 'session-dash', 'prefs.json'), 'utf8').includes('evil'));
    const collect = (obj) => req({ method: 'POST', url: '/api/pet/collect', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    expect('도감: 모르는 캐릭터 400', (await collect({ week: 'w1', species: '<img>', lv: 3 })).status === 400);
    expect('도감: 범위 밖 레벨 400', (await collect({ week: 'w1', species: '고양이', lv: 99 })).status === 400);
    const c1 = await collect({ week: 'w1', species: '고양이', lv: 3 });
    await collect({ week: 'w1', species: '고양이', lv: 2 });
    const pet = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'session-dash', 'pet.json'), 'utf8'));
    expect('도감: 저장되고 최고 레벨 유지', c1.status === 200 && pet.collection.w1.lv === 3);

    server.close();
    fs.rmSync(home, { recursive: true, force: true });
    console.log(fails ? `\n${fails}건 실패` : '\n전부 통과');
    process.exit(fails ? 1 : 0);
  },
  onError: (e) => { console.error(e); process.exit(1); },
});
