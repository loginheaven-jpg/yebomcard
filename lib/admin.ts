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
const ADMIN_LEVELS = ["admin", "운영자", "superadmin", "수퍼어드민", "super_admin"];

export function isAdmin(session: SessionData | null): boolean {
  if (!session?.isLoggedIn) return false;
  return (
    !!session.permission_level && ADMIN_LEVELS.includes(session.permission_level.toLowerCase())
  );
}
