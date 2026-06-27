// 최소 서비스워커 — PWA 설치 가능(installability) 조건 충족용.
// Chrome 은 fetch 핸들러를 가진 서비스워커가 등록돼 있어야 beforeinstallprompt 를 발화한다.
// 캐싱은 하지 않는다(본문/오디오 stale·range 요청 문제 회피) — fetch 는 가로채지 않고 네트워크 그대로.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
// fetch 핸들러 "존재"가 설치가능성 요건. respondWith 호출 안 함 → 브라우저 기본 처리(네트워크) 유지.
self.addEventListener("fetch", () => {});
