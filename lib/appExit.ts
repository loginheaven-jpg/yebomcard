// 의도된 앱 이탈(로그인 이동·종료 등) 표시.
//
// Chrome "trivial session history context"(탭에 히스토리 항목 1개)에선 pushState 가
// replaceState 로 강등돼 history 기반 종료 트랩이 무력화된다. 그 경우 beforeunload 로
// 무확인 종료(뒤로가기/새로고침/탭닫기)를 막되, 사용자가 명시적으로 택한 이동
// (로그인 SSO 이동 등)까지 막으면 안 되므로 이 플래그로 통과시킨다.
let intentional = false;

export function markIntentionalLeave() {
  intentional = true;
  // 이동이 취소돼 페이지가 그대로 유지되면 보호를 재무장 (안전장치)
  setTimeout(() => {
    intentional = false;
  }, 3000);
}

export function isIntentionalLeave() {
  return intentional;
}
