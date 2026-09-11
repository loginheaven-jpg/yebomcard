import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { isAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createRegenRequests } from "@/lib/voiceStudio/verseRegen";

export const dynamic = "force-dynamic";

async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SessionData>(sealed.value, { password: sessionOptions.password });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
  }

  let body: { id?: number; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const id = Number(body.id);
  const text = (body.text ?? "").trim();
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }
  if (text.length === 0) {
    return NextResponse.json({ error: "본문이 비어있을 수 없습니다" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("bible_verses")
    .update({ text })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 새번역은 영희 음원이 있다 — 본문이 바뀌면 음원 열쇠(본문 해시)도 바뀌어 그 절은 대신 읽는 목소리로 넘어간다.
  // 음원 다시 만들기를 자동으로 요청해 둔다(생성 PC 가 10분 안에 가져가 만든다). 요청 실패는 저장을 막지 않는다.
  let regenRequested = false;
  if (data?.version === "rnksv") {
    try {
      const made = await createRegenRequests(
        "f4",
        "rnksv",
        [{ bookCode: data.book_code, chapter: data.chapter, verse: data.verse }],
        "본문 수정",
        session?.email || "관리자",
      );
      regenRequested = made.length > 0;
    } catch {
      /* 무시 — 저장은 이미 끝났다 */
    }
  }

  return NextResponse.json({ ok: true, verse: data, regenRequested });
}
