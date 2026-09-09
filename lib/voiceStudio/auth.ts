/**
 * 음원 생성 스튜디오 API 의 두 가지 관문 — 서버 전용.
 *
 *  - requireAdmin : 사람이 브라우저로 접근 (설치 파일 발급, 보이스 등록/폐기)
 *  - requireDevice: 설치된 PC 가 토큰으로 접근 (코드·설정·보이스 내려받기, 음원 업로드)
 *
 * 보이스 참조음은 목소리 복제 데이터다. 받아 간 쪽은 그 목소리로 무엇이든
 * 말하게 만들 수 있으므로, 두 관문 모두 반드시 통과시킨 뒤에만 내보낸다.
 */

import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { NextResponse } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { isAdmin } from "@/lib/admin";
import { verifyRequest, type StudioToken } from "./token";

export async function getSession(): Promise<SessionData | null> {
  try {
    const store = await cookies();
    const sealed = store.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

/** 관리자면 세션, 아니면 403 응답 */
export async function requireAdmin(): Promise<
  { ok: true; session: SessionData } | { ok: false; res: NextResponse }
> {
  const session = await getSession();
  if (!isAdmin(session)) {
    return {
      ok: false,
      res: NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 }),
    };
  }
  return { ok: true, session: session! };
}

/** 유효한 기기 토큰이면 claims, 아니면 401 응답 */
export async function requireDevice(
  req: Request,
): Promise<{ ok: true; claims: StudioToken } | { ok: false; res: NextResponse }> {
  const claims = await verifyRequest(req);
  if (!claims) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "기기 토큰이 없거나 만료·폐기되었습니다. 설치 파일을 다시 받아 주세요." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, claims };
}
