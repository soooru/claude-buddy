// 공개 전 점검 — git 이 추적하는(또는 추적할) 파일에 개인 정보·비밀이 섞였는지 찾는다.
//   npm run check   (문제가 있으면 exit 1)
// 찾는 것: 사용자 폴더 절대경로, 이메일, 토큰처럼 생긴 문자열, 개인 키, 그리고 BUDDY_CHECK_DENY 에 넣은 단어(회사명 등)
const { execFileSync } = require('child_process');
const fs = require('fs');

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !/\.(png|ico)$/.test(f));

const deny = (process.env.BUDDY_CHECK_DENY || '').split(',').map((s) => s.trim()).filter(Boolean);
const RULES = [
  ['사용자 폴더 경로', /[A-Za-z]:[\\/]+Users[\\/]+(?!<|%|\$)[^\\/\s"'`]+/i],
  ['이메일', /[\w.+-]+@(?!users\.noreply\.github\.com)[\w-]+\.[\w.]+/],
  ['GitHub 토큰', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['API 키', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['개인 키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['긴 16진 비밀값', /\b[a-f0-9]{48,}\b/],
  ...deny.map((w) => [`금지어 "${w}"`, new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]),
];
const ALLOW = [/noreply@anthropic\.com/];

let bad = 0;
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) {
      // 잠금 파일의 이메일은 외부 패키지 작성자 정보다
      if (name === '이메일' && f === 'package-lock.json') continue;
      const m = line.match(re);
      if (m && !ALLOW.some((a) => a.test(m[0]))) {
        bad++;
        console.log(`${f}:${i + 1}  ${name}: ${m[0].slice(0, 60)}`);
      }
    }
  });
}
console.log(bad ? `\n${bad}건 발견 — 공개 전에 고쳐 주세요.` : `OK — ${files.length}개 파일에서 문제 없음`);
process.exit(bad ? 1 : 0);
