/**
 * 성경 질문 — 교인이 저장·버리기를 누른다 (§B-10)
 *
 * "교인이 '저장' 한 것은 본인이 그 절에서 보고 지울 수 있다. 교인이 지우면 그 절에서 내려가고,
 *  **관리자 기록은 남는다** — 기록을 지우는 것은 super_admin 의 몫이다."
 *
 * 그래서 여기서는 행을 지우지 않고 `saved` 만 내린다.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const saved = body.saved === true;
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }

  // **반드시 user_id 로 스코프한다** — 남의 질문을 저장·해제하지 못하게.
  const { error } = await supabaseAdmin
    .from("ai_questions")
    .update({ saved, saved_at: saved ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", session.user_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, saved });
}

/**
 * 이 절에 내가 저장해 둔 질문. 비로그인은 401 이 아니라 빈 배열이다(이 저장소의 GET 관습).
 * 답까지 함께 준다 — 절 화면에서 펼쳐 보려면 필요하다.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ items: [] });

  const { searchParams } = new URL(request.url);
  const bookCode = searchParams.get("book");
  const chapter = Number(searchParams.get("chapter"));
  if (!bookCode || !Number.isFinite(chapter)) {
    return NextResponse.json({ error: "book, chapter가 필요합니다" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("ai_questions")
    .select(
      "id, verse_start, verse_end, verses_ref, question, mode, asked_at, ai_question_answers(column_key, model, ok, content)",
    )
    .eq("user_id", session.user_id)
    .eq("book_code", bookCode)
    .eq("chapter", chapter)
    .eq("saved", true)
    .order("asked_at", { ascending: false });

  // 표가 아직 없으면 기능이 없는 것처럼 조용히 빈 배열 — 절 화면이 깨지면 안 된다.
  if (error) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: data ?? [] });
}
