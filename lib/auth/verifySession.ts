/**
 * 서버에서 세션을 **공유 DB 와 대조**한다 — 관리자 기능 전용 관문.
 *
 * 왜 필요한가. 이 앱의 API 는 쿠키를 스스로 복호화해서만 신뢰한다. 그런데 봉인 쿠키의 수명은 교적부가
 * 정하고('로그인 유지' 세션은 400일), 교적부에서 강제 로그아웃하거나 권한을 낮춰도 이 앱 서버는 그것을
 * 모른다. 브라우저는 다음 체크인에서 쿠키가 지워지지만, **밖으로 복사해 둔 쿠키**(이 저장소는 음원 PC
 * 등록 때 쿠키를 직접 복사하도록 안내한다)는 그 뒤로도 계속 통한다. 그 사본으로 할 수 있는 일 가운데
 * 성경 본문 전역 수정·보류 음원 영구 삭제·180일 기기 토큰 발급은 되돌리기 어렵다.
 *
 * 그래서 **관리자 기능에만** 교적부 `revalidateSession` 과 같은 판정을 한 번 더 한다(2026-09-12 결정 3).
 *  - `users.session_version` 이 쿠키의 `sv` 와 다르면 거부 — 교적부 '모든 기기 로그아웃'이 바로 듣는다
 *  - 승인 취소(`is_approved=false`, premember 제외) 거부 — 이 앱은 여태 이것을 본 적이 없다
 *  - 권한(`permission_level`)은 **DB 최신값**으로 바꿔 판정한다 — 쿠키에 박힌 옛 등급을 믿지 않는다
 *
 * 읽기 전용 조회만 한다(스키마 변경 없음). 교적부 서버로 되묻지 않고 공유 DB 를 직접 보는 이유는,
 * 관리자 기능이 교적부 가용성에 묶이지 않게 하려는 것이다.
 *
 * 비상 진입로(결정 4)는 여기 **서버 전용 env** 로만 둔다 — `lib/admin.ts` 의 이메일 화이트리스트와 소스에
 * 박혀 있던 기본 이메일은 지웠다(잠복 백도어 + 클라이언트 번들 노출). 여기 든 계정도 세션 폐기는 그대로
 * 적용되므로, 유출 시 교적부 '모든 기기 로그아웃' 이 지렛대가 된다.
 *
 * 읽기 핫패스(본문·노트·진도 등)는 손대지 않았다. 그쪽까지 넓히려면 라우트마다 복사돼 있는 세션 판독을
 * 헬퍼 하나로 합치는 일이 먼저다(plan.md 기록).
 */

import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { NextResponse } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { isAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** 봉인 쿠키에는 이 앱 타입에 없는 판별값이 더 들어 있다 — 세션 판(sv)이 그것이다 */
type SealedSession = SessionData & { sv?: number };

/**
 * 비상 진입로 — 교적부 등급을 못 읽거나 잘못됐을 때 쓸 서버 전용 통로. **기본값 없음**(설정하지 않으면
 * 아무에게도 해당되지 않는다). `NEXT_PUBLIC_` 이 아니라 클라이언트 번들에 실리지 않는다 — 그래서 이
 * 통로로는 서버 API 만 열리고 화면의 관리자 메뉴는 뜨지 않는다(메뉴까지 필요하면 교적부 등급을 고칠 것).
 */
const EMERGENCY_ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminOrEmergency(session: SessionData): boolean {
  if (isAdmin(session)) return true;
  return !!session.email && EMERGENCY_ADMIN_EMAILS.includes(session.email.toLowerCase());
}

type UserRow = {
  name: string | null;
  permission_level: string | null;
  is_approved: boolean | null;
  member_id: string | null;
  session_version: number | null;
};

/** 같은 사용자를 잇따라 확인할 때의 왕복을 줄인다(관리자 화면은 포커스마다 배지를 확인한다).
 *  폐기 반영이 최대 이만큼 늦어진다 — 서버 인스턴스별 메모리라 오래 살지도 않는다. */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; row: UserRow | null }>();

export async function readSealedSession(): Promise<SealedSession | null> {
  try {
    const store = await cookies();
    const sealed = store.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SealedSession>(sealed.value, {
      password: sessionOptions.password,
    });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

type Verdict =
  | { ok: true; session: SessionData }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** 쿠키 세션을 공유 DB 와 대조해 최신 세션을 돌려준다. 조회 실패는 통과시키지 않는다(관리자 기능 한정) */
export async function verifySession(session: SealedSession | null): Promise<Verdict> {
  if (!session?.isLoggedIn || !session.user_id) {
    return { ok: false, status: 401, error: "로그인이 필요합니다" };
  }

  const hit = cache.get(session.user_id);
  let row: UserRow | null;
  if (hit && Date.now() - hit.at < CACHE_MS) {
    row = hit.row;
  } else {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("name, permission_level, is_approved, member_id, session_version")
      .eq("user_id", session.user_id)
      .maybeSingle();
    if (error) {
      // 조회 실패를 통과로 처리하면 검사가 무의미해진다 — 관리자 기능은 잠시 막고 다시 시도하게 한다
      return { ok: false, status: 503, error: "권한을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    }
    row = (data as UserRow | null) ?? null;
    cache.set(session.user_id, { at: Date.now(), row });
  }

  if (!row) return { ok: false, status: 401, error: "계정을 찾을 수 없습니다" };
  if ((row.session_version ?? 0) !== (session.sv ?? 0)) {
    return { ok: false, status: 401, error: "다른 기기에서 로그아웃되었습니다. 다시 로그인해 주세요." };
  }
  if (!row.is_approved && row.permission_level !== "premember") {
    return { ok: false, status: 403, error: "승인 대기 중인 계정입니다" };
  }

  // 이메일은 교적부도 쿠키 사본을 쓴다(DB 조회 대상이 아니다) — 그대로 둔다
  return {
    ok: true,
    session: {
      ...session,
      name: row.name ?? session.name,
      permission_level: row.permission_level ?? session.permission_level,
      is_approved: row.is_approved ?? session.is_approved,
      member_id: row.member_id ?? session.member_id,
    },
  };
}

/** 관리자면 **최신 정보로 확인된** 세션, 아니면 거절 응답 */
export async function requireFreshAdmin(): Promise<
  { ok: true; session: SessionData } | { ok: false; res: NextResponse }
> {
  const verdict = await verifySession(await readSealedSession());
  if (!verdict.ok) {
    return { ok: false, res: NextResponse.json({ error: verdict.error }, { status: verdict.status }) };
  }
  if (!isAdminOrEmergency(verdict.session)) {
    return {
      ok: false,
      res: NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 }),
    };
  }
  return { ok: true, session: verdict.session };
}
