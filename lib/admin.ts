import type { SessionData } from "@/lib/auth/session";

/**
 * 관리자 판정 — 교적부 권한 등급만 본다.
 *
 * 2026-09-12 까지는 여기에 이메일 화이트리스트가 있었고, 기본값으로 개인 이메일 하나가 소스에 박혀 있었다.
 * 그 계정은 교적부에 없어 **지금은 아무 권한도 주지 않으면서**, 나중에 그 이메일이 교적부에 등록되는 순간
 * 교적부가 회수할 수 없는 관리자가 되는 잠복 경로였다. `NEXT_PUBLIC_` 이라 클라이언트 번들에도 실렸다.
 * 그래서 지웠다 — 관리자 권한은 교적부 `permission_level` 에서만 나온다(2026-09-12 실측: admin 10 · super_admin 1).
 *
 * 비상 진입로는 **서버 전용** `ADMIN_EMAILS` 로 옮겼다(`lib/auth/verifySession.ts`, 기본값 없음).
 * 그 경로는 서버 API 에만 듣는다 — 브라우저는 서버 env 를 못 읽으므로 화면의 관리자 메뉴는 등급으로만 뜬다.
 */
/**
 * 수퍼어드민만 쓰는 등급. 성경 질문 기록 열람이 여기에 걸린다
 * (docs/BIBLE_QA_DOCTRINE.md §B-10 — "열람은 super_admin 한 사람뿐이고 admin 등급은 못 본다").
 * 소문자로만 적는다 — 비교가 `toLowerCase()` 라 대문자가 섞이면 영원히 매칭되지 않는다.
 */
const SUPER_LEVELS = ["superadmin", "수퍼어드민", "super_admin"];
const ADMIN_ONLY_LEVELS = ["admin", "운영자"];

/** 관리자 = 일반 관리자 + 수퍼어드민. 합집합을 유지해야 수퍼어드민이 관리자 기능에서 빠지지 않는다. */
const ADMIN_LEVELS = [...ADMIN_ONLY_LEVELS, ...SUPER_LEVELS];

function levelOf(session: SessionData | null): string | null {
  if (!session?.isLoggedIn) return null;
  return session.permission_level ? session.permission_level.toLowerCase() : null;
}

export function isAdmin(session: SessionData | null): boolean {
  const level = levelOf(session);
  return !!level && ADMIN_LEVELS.includes(level);
}

/**
 * 수퍼어드민 판정.
 *
 * **서버에서는 쿠키 등급으로 판정하면 안 된다** — 교적부에서 등급을 내려도 400일짜리 쿠키 사본으로
 * 계속 통한다. `requireFreshAdmin()` 이 돌려준 `gate.session`(DB 최신값으로 갈아끼운 것)을 넘겨야 한다.
 *
 * 비상 진입로(`ADMIN_EMAILS`, 서버 전용)는 여기에 **합쳐지지 않는다**. 등급 없이 API 를 여는 길이라
 * 수퍼어드민 전용 기능까지 열어 주면 그 계정이 교인의 질문 기록을 볼 수 있게 된다.
 */
export function isSuperAdmin(session: SessionData | null): boolean {
  const level = levelOf(session);
  return !!level && SUPER_LEVELS.includes(level);
}
