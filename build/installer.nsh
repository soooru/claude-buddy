; Claude Buddy installer additions (electron-builder NSIS include)
;  - 설치: "바탕화면 바로가기 만들기" 체크박스 페이지(기본 체크). 업데이트 설치일 때는 건너뛴다.
;  - 제거: settings.json 에서 Claude Buddy 항목만 빼고(--disconnect), 바탕화면 바로가기를 지우고, 데이터 삭제 여부를 묻는다.
!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  Var BuddyDesktopCheckbox
  Var BuddyCreateDesktop

  !macro customPageAfterChangeDir
    Page custom BuddyDesktopPage BuddyDesktopPageLeave
  !macroend

  Function BuddyDesktopPage
    ; 업데이트는 조용히(/S) 설치되어 이 페이지가 뜨지 않는다 — 바로가기는 customInstall 에서 업데이트 여부로 거른다
    StrCpy $BuddyCreateDesktop ${BST_CHECKED}
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 20u "바로가기를 어디에 만들까요? 시작 메뉴에는 항상 만들어요."
    Pop $0
    ${NSD_CreateCheckbox} 0 26u 100% 12u "바탕화면에 바로가기 만들기"
    Pop $BuddyDesktopCheckbox
    ${NSD_Check} $BuddyDesktopCheckbox
    nsDialogs::Show
  FunctionEnd

  Function BuddyDesktopPageLeave
    ${NSD_GetState} $BuddyDesktopCheckbox $BuddyCreateDesktop
  FunctionEnd

  !macro customInstall
    ${if} $BuddyCreateDesktop == ${BST_CHECKED}
    ${andIfNot} ${isUpdated}
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ${endif}
  !macroend
!endif

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --disconnect'
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    MessageBox MB_YESNO|MB_ICONQUESTION "Claude Buddy 기록(세션 기록·펫·사용량)도 지울까요?$\r$\n$PROFILE\.claude\session-dash" /SD IDNO IDNO buddyKeepData
      RMDir /r "$PROFILE\.claude\session-dash"
    buddyKeepData:
  ${endif}
!macroend
