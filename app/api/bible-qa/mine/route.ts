/**
 * 성경 질문 — '나의 질문' (§B-14, 지휘부 2026-09-21)
 *
 * 설정 → 나의 질문. **내가 한 모든 질문**을 최근 것부터 본다 —
 * 전에는 그 절로 다시 찾아가야만 자기 질문이 보였고, 저장하지 않은 질문은 볼 길이 없었다.
 *
 * 여기서 보이는 것은 **본인 것뿐이다.** 모든 교인의 질문과 이름은 수퍼어드민 화면
 * (`/admin/ai-questions`)에서 본다 — 그 화면은 **열어 본 사실을 `ai_question_views` 에 남긴다**(§B-10).
 * 두 화면을 합치면 그 열람 기록을 빠뜨리기 쉬워 일부러 나눠 둔다.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** 한 번에 읽어 오는 건수. PostgREST 는 1000행에서 경고 없이 자른다. */
const PAGE_SIZE = 50;

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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(0, Math.floor(Number(searchParams.get("page")) || 0));
  const from = page * PAGE_SIZE;

  const { data, error, count } = await supabaseAdmin
    .from("ai_questions")
    .select(
      "id, book_code, chapter, verse_start, verse_end, verses_ref, question, mode, input_kind, gate_result, is_crisis, saved, shared, share_hidden_at, asked_at, ai_question_answers(column_key, model, ok, content)",
      { count: "exact" },
    )
    .eq("user_id", session.user_id)
    .order("asked_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    // 마이그레이션 전이면 공유 칸이 없다 — 그래도 목록은 보여야 한다.
    const { data: plain, count: plainCount } = await supabaseAdmin
      .from("ai_questions")
      .select(
        "id, book_code, chapter, verse_start, verse_end, verses_ref, question, mode, input_kind, gate_result, is_crisis, saved, asked_at, ai_question_answers(column_key, model, ok, content)",
        { count: "exact" },
      )
      .eq("user_id", session.user_id)
      .order("asked_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    return NextResponse.json({
      items: plain ?? [],
      total: plainCount ?? 0,
      pageSize: PAGE_SIZE,
      shareReady: false,
    });
  }

  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    pageSize: PAGE_SIZE,
    shareReady: true,
  });
}
