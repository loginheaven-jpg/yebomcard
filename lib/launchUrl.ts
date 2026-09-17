/**
 * 앱이 처음 열린 주소 — 이 모듈이 평가되는 순간(React 가 effect 를 돌리기 전)에 떠 둔다.
 *
 * 왜 따로 두는가 (2026-09-17 지휘부 보고: 초대링크를 눌러도 말씀의삶에 가지 않음)
 *   초대링크(`?join=`)·본문가기(`?goto=`)는 page·SearchPanel 이 읽자마자 주소창에서 지운다(새로고침·뒤로가기로
 *   두 번 처리하지 않게). 그런데 카카오톡 등 안드로이드 인앱 브라우저는 `PwaInstall` 이 **크롬으로 다시 여는데**,
 *   그 effect 가 page 보다 뒤에 돌아 `location.href` 가 이미 코드가 빠진 `/` 였다 — 크롬에는 그냥 첫 화면이 열렸다.
 *   카톡으로 받은 링크는 거의 다 이 길을 탄다.
 */
export const LAUNCH_URL = typeof window === "undefined" ? "" : window.location.href;
