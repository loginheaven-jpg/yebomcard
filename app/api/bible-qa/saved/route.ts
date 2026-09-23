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

/**
 * 한 장에서 내려보내는 함께보기 개수 상한.
 * 인기 절(요 3:16 · 시 23)에는 질문이 몇십 개씩 쌓인다 — 전부 내려보내면
 * 질문 창을 여는 것만으로 본문보다 긴 글이 따라온다.
 */
const SHARED_LIMIT = 20;

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

/**
 * 함께보기 칸(`shared`)이 아직 없는가 — `scripts/migration-qa-share.sql` 적용 전.
 * PostgREST 는 없는 칸을 42703 으로 돌려준다. 이때도 **저장은 되어야 한다**.
 */
function isMissingShareColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /shared/i.test(error.message ?? "");
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const saved = body.saved === true;
  // 함께보기(§B-14). 안 적어 보내면 **공개가 기본**이다(지휘부 2026-09-21).
  // 저장을 내리면 공유도 함께 내려간다 — 내가 버린 것이 남에게 남아 있으면 안 된다.
  const wantShare = saved && body.shared !== false;
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }

  // 위기·거절은 **공유하지 않는다.** 화면에는 저장 단추 자체가 없지만 여기서 한 번 더 막는다 —
  // 화면만 믿으면, 요청을 직접 만들어 보내는 길이 그대로 열려 있다.
  const shared = wantShare;
  if (wantShare) {
    const { data: row, error: readError } = await supabaseAdmin
      .from("ai_questions")
      .select("is_crisis, gate_result")
      .eq("id", id)
      .eq("user_id", session.user_id)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: "질문을 확인하지 못했습니다" }, { status: 500 });
    if (!row) return NextResponse.json({ error: "질문을 찾을 수 없습니다" }, { status: 404 });
    const r = row as { is_crisis: boolean; gate_result: string } | null;
    if (r?.is_crisis || r?.gate_result === "crisis" || r?.gate_result === "deny") {
      return NextResponse.json({ error: "이 질문은 공개할 수 없습니다" }, { status: 409 });
    }
  }

  // **반드시 user_id 로 스코프한다** — 남의 질문을 저장·해제하지 못하게.
  const { data: updated, error } = await supabaseAdmin
    .from("ai_questions")
    .update({
      saved,
      saved_at: saved ? new Date().toISOString() : null,
      shared,
      shared_at: shared ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("user_id", session.user_id)
    .select("id")
    .maybeSingle();
  if (error) {
    // 공개 요청을 개인 저장으로 바꿔 성공 처리하면 화면이 공개됐다고 거짓 안내한다.
    if (isMissingShareColumn(error)) {
      if (wantShare) {
        return NextResponse.json({ error: "공개 저장을 준비 중입니다. 잠시 후 다시 시도해 주세요" }, { status: 503 });
      }
      const { data: retried, error: retry } = await supabaseAdmin
        .from("ai_questions")
        .update({ saved, saved_at: saved ? new Date().toISOString() : null })
        .eq("id", id)
        .eq("user_id", session.user_id)
        .select("id")
        .maybeSingle();
      if (!retry) {
        if (!retried) return NextResponse.json({ error: "질문을 찾을 수 없습니다" }, { status: 404 });
        return NextResponse.json({ success: true, saved, shared: false });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "질문을 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ success: true, saved, shared });
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

  const COLUMNS =
    "id, verse_start, verse_end, verses_ref, question, mode, asked_at, ai_question_answers(column_key, model, ok, content)";

  const { data, error } = await supabaseAdmin
    .from("ai_questions")
    .select(COLUMNS)
    .eq("user_id", session.user_id)
    .eq("book_code", bookCode)
    .eq("chapter", chapter)
    .eq("saved", true)
    .order("asked_at", { ascending: false });

  // 표가 아직 없으면 기능이 없는 것처럼 조용히 빈 배열 — 절 화면이 깨지면 안 된다.
  if (error) return NextResponse.json({ items: [], shared: [] });

  /**
   * 함께보기 — 다른 교인이 내놓은 질문(§B-14, 지휘부 2026-09-21).
   * **누가 물었는지는 내려보내지 않는다** — `user_id` · `user_name` 을 select 에 넣지 않는다.
   * 여기서 한 칸이라도 흘리면 화면에서 안 그려도 응답 본문에 남는다.
   * 내 것은 위 목록에 이미 있으므로 뺀다. 수퍼어드민이 내린 것(`share_hidden_at`)도 뺀다.
   */
  let shared: unknown[] = [];
  const { data: sharedRows, error: sharedError } = await supabaseAdmin
    .from("ai_questions")
    .select(COLUMNS)
    .eq("book_code", bookCode)
    .eq("chapter", chapter)
    .eq("shared", true)
    .neq("user_id", session.user_id)
    .is("share_hidden_at", null)
    .order("asked_at", { ascending: false })
    .limit(SHARED_LIMIT);
  // 마이그레이션 전이면 함께보기만 조용히 비어 있고 내 저장 목록은 그대로 나온다.
  if (!sharedError) shared = sharedRows ?? [];

  return NextResponse.json({ items: data ?? [], shared });
}
