import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { unsealData } from "iron-session";

const COOKIE_NAME = "saint_record_session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 정적 파일, API 무시
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // SSO 쿠키가 있으면 유효성만 검증 (유효하지 않으면 삭제)
  // 쿠키가 없어도 페이지 접근은 허용 (비로그인 사용 가능)
  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (sessionCookie) {
    try {
      const session = (await unsealData(sessionCookie.value, {
        password: process.env.SESSION_SECRET!,
      })) as { isLoggedIn?: boolean };
      if (session?.isLoggedIn) {
        return NextResponse.next(); // 유효한 세션 → 통과
      }
    } catch {
      // 복호화 실패
    }
    // 유효하지 않은 쿠키 정리 (페이지는 차단하지 않음)
    const response = NextResponse.next();
    response.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
    const domain = process.env.COOKIE_DOMAIN;
    if (domain)
      response.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/", domain });
    return response;
  }

  // 쿠키 없음 → 그래도 페이지 접근 허용 (비로그인 기능 사용 가능)
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
