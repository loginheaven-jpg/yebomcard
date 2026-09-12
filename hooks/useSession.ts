"use client";

/**
 * 세션 훅 — 실제 상태는 `contexts/SessionContext` 한 곳에만 있다.
 *
 * 전에는 이 파일이 컴포넌트마다 따로 `useState` 와 fetch 를 들고 있어, 로그아웃이 다른 화면에
 * 전달되지 않았다(특히 로그인 게이트가 로그아웃 뒤에도 통과). 호출부 7곳을 그대로 두려고
 * 이름과 반환 모양은 유지한 채 provider 소비만 재수출한다. 반환값에 `deviceReady` 가 늘었다 —
 * 기기 주인 판정이 끝났는지로, 로그인 동기화·스크랩 이관·그룹 자동참여가 이걸 기다린다.
 */
export { LOGIN_URL, useSession } from "@/contexts/SessionContext";
