# Security

Claude Buddy 는 Claude Code 의 프롬프트·응답 일부를 이 PC 에 기록합니다. 그래서 그 데이터가 **PC 밖으로 나가지 않고,
다른 계정·다른 웹사이트가 읽거나 끼어들지 못하게** 하는 것을 최우선으로 설계했습니다.

## 데이터가 흐르는 길

1. **훅 → 우편함 폴더.** Claude Code 훅은 백그라운드(`async`) Git Bash 명령입니다. 이벤트 JSON 을
   `~/.claude/session-dash/inbox/` 에 파일로 남기고 끝납니다. 네트워크를 쓰지 않고, Claude Code 에 아무 응답도 돌려주지 않습니다.
2. **앱 → 우편함 읽기.** 앱이 파일을 시간순으로 읽어 기록에 반영하고 바로 지웁니다.
3. **화면 → 로컬 서버.** 위젯 화면만 `127.0.0.1:7777` 의 내장 서버에서 데이터를 받습니다. 기록 API 는 앱이 실행할 때마다
   새로 만드는 키가 있어야 응답하고, 그 키는 앱 창에만 전달됩니다.

## 위협과 대응

| 위협 | 대응 | 위치 |
|---|---|---|
| 다른 프로그램이 포트를 먼저 잡아 훅 내용을 가로채거나, 응답으로 「허락」을 꾸며 보냄 | 훅은 포트를 쓰지 않는다(우편함 파일). `async` 명령이라 응답 통로 자체가 없다 | `src/main/connect.cjs`, `src/main/inbox.cjs` |
| 같은 PC 의 다른 Windows 계정·브라우저가 기록을 읽음 | 우편함·데이터는 내 사용자 폴더. 기록 API 는 실행마다 새로 만드는 64자 키 필수(상수 시간 비교), 키는 preload 로 우리 창에만 | `server.cjs`, `main.cjs`, `preload.cjs` |
| 같은 네트워크의 다른 PC 가 접속 | 서버를 `127.0.0.1` 에만 바인딩 | `server.cjs` |
| 웹페이지가 `localhost:7777` 을 호출(CSRF) | `Origin` 이 우리 주소가 아니거나 `Sec-Fetch-Site` 가 교차 사이트면 403 | `server.cjs` |
| DNS 리바인딩 | `Host` 헤더가 `127.0.0.1:7777`/`localhost:7777` 이 아니면 403 | `server.cjs` |
| 다른 프로그램이 7777 을 먼저 잡고 위젯 화면을 흉내 | 포트를 못 잡으면 앱이 창을 띄우지 않고 종료 | `main.cjs` |
| 이벤트로 임의 파일 읽기 | `transcript_path` 는 `~/.claude/projects` 아래 `.jsonl` 만. 세션 id 는 `[\w-]{1,80}`, `__proto__` 등 특수 키 거절 | `record.cjs`, `server.cjs` |
| 내려받은 저장소의 `.git` 포인터로 네트워크 공유(SMB) 접속 유도(NTLM 해시 유출) | 브랜치를 읽을 때 `\\server\share` 경로는 열지 않음 | `record.cjs` |
| 큰 입력으로 메모리 고갈 | 우편함 파일 8MB, API 본문 4KB 제한. transcript 는 한 번에 2MB 까지만 | `inbox.cjs`, `server.cjs`, `record.cjs` |
| 기록된 프롬프트 속 스크립트(XSS) | 출력은 모두 이스케이프·숫자 강제, CSP `script-src 'self'`(인라인 스크립트 금지) | `src/renderer/*` |
| 렌더러 탈취 후 시스템 접근 | `sandbox`·`contextIsolation`, `nodeIntegration` 끔. preload 는 함수 몇 개만, 메인이 호출 출처·값을 다시 확인 | `main.cjs`, `preload.cjs` |
| 다른 페이지로 이동·새 창·권한 요청 | 우리 주소 밖 이동 차단, `window.open` 거부, 모든 권한 거부, `<webview>` 차단 | `main.cjs` |
| 실행 파일 변조·디버그 주입 | Electron fuses: `RunAsNode`·`NODE_OPTIONS`·`--inspect` 끔, asar 무결성 검사, asar 에서만 로드 | `package.json` |
| PowerShell 명령 주입(창 이동) — 폴더 이름의 ‘ ’ 같은 유니코드 따옴표 포함 | 문자열은 스크립트에 넣지 않고 base64 로 넘겨 PowerShell 안에서 푼다. PID 는 정수만 | `focus.cjs` |
| 가짜 `claude.bat` 이 끼어듦 | `claude` 는 PATH 에서 찾은 절대 경로로, 셸 없이 실행 | `server.cjs` |
| settings.json 손상 | 쓰기 전 백업(연결 전 원본 + 최근 4개만 보관), JSON 이 깨져 있으면 아무것도 안 함, 임시 파일에 쓰고 다시 읽어 확인 후 교체, 심볼릭 링크는 실제 파일에 씀 | `connect.cjs` |
| 공급망 | 런타임 의존성 0개(Electron 런타임만). 개발 의존성은 버전 고정 | `package.json` |

## 알려진 한계

- **서명되지 않은 exe**: 코드 서명 인증서가 없습니다. 이 저장소의 Releases 에서만 받으세요.
- **같은 계정의 로컬 프로그램**은 막지 못합니다. 내 계정으로 도는 프로그램은 `~/.claude` 를 읽고 쓸 수 있으므로
  우편함과 기록도 읽을 수 있습니다. Claude Code 자신의 기록(`~/.claude/projects`)과 같은 보호 수준입니다.
- **상태줄 체인**: 연결 전에 쓰던 상태줄이 있으면 그 명령을 그대로 실행합니다. 원래 Claude Code 가 실행하던 사용자 자신의
  명령이고, 그 명령이 무엇을 하는지는 Claude Buddy 가 통제하지 않습니다. Claude Buddy 자체의 상태줄 코드는 네트워크를 쓰지 않습니다.
- **백업 파일**: `settings.json.bak-claude-buddy-*` 은 settings.json 의 사본이라 그 안의 `env` 값도 함께 복사됩니다.
  dotfile 저장소에 올릴 때는 제외하세요.

## 시험

```bash
npm run security-test   # 위 표의 서버·우편함 대응을 실제 요청·파일로 확인
npm run check           # 커밋될 파일에 개인 경로·이메일·토큰이 없는지
```

## 신고

보안 문제를 발견하면 공개 이슈 대신 GitHub 의 **Security → Report a vulnerability**(비공개 신고)를 써 주세요.
