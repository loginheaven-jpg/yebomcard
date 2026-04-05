import { NextResponse } from "next/server";
import { sessionOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ success: true });
  const cookieOpts = sessionOptions.cookieOptions || {};

  // 양쪽 도메인의 쿠키 모두 삭제
  response.cookies.set(sessionOptions.cookieName, "", { maxAge: 0, path: "/" });
  if (cookieOpts.domain) {
    response.cookies.set(sessionOptions.cookieName, "", {
      maxAge: 0,
      path: "/",
      domain: cookieOpts.domain,
    });
  }

  return response;
}
