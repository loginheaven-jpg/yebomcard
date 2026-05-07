import type { SessionData } from "@/lib/auth/session";

// 명시적 화이트리스트 (env로 추가 가능)
const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "withdrchoiclinic@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// 교적부 SSO permission_level 중 관리자급으로 간주할 값들
const ADMIN_LEVELS = ["admin", "운영자", "superadmin", "수퍼어드민", "super_admin"];

export function isAdmin(session: SessionData | null): boolean {
  if (!session?.isLoggedIn) return false;
  if (session.email && ADMIN_EMAILS.includes(session.email.toLowerCase())) return true;
  if (session.permission_level && ADMIN_LEVELS.includes(session.permission_level.toLowerCase())) return true;
  return false;
}
