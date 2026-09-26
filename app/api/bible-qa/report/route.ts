/**
 * 성경 질문 — '이 답이 이상합니다' (§B-6)
 *
 * "답 아래 '이 답이 이상합니다' 를 두고, 눌린 건은 관리자 화면에서 따로 본다.
 *  문서만 있고 감시 장치가 없으면 기준은 종이로만 남는다."
 *
 * 신고는 **자기 질문의 답에만** 할 수 있다 — 남의 답을 신고할 길을 만들지 않는다.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { columnOf } from "@/lib/bibleQa/columns";

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
  const questionId = Number(body.question_id);
  const column = typeof body.column === "string" ? body.column : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  if (!Number.isFinite(questionId) || questionId <= 0) {
    return NextResponse.json({ error: "유효한 question_id가 필요합니다" }, { status: 400 });
  }
  if (!columnOf(column)) {
    return NextResponse.json({ error: "유효한 column이 필요합니다" }, { status: 400 });
  }

  // 신고할 수 있는 답인지 본다 — **내 질문**이거나 **함께보기로 내놓은 질문**(§B-14, 2026-09-21).
  // 함께보기가 생기기 전에는 내 질문뿐이었다. 남의 답이 교인에게 보이는데 신고할 길이 없으면,
  // 틀린 교리 답이 그 절에 그대로 걸려 있게 된다.
  const { data: row, error: ownError } = await supabaseAdmin
    .from("ai_questions")
    .select("id, user_id, shared, share_hidden_at")
    .eq("id", questionId)
    .maybeSingle();
  if (ownError) {
    // 마이그레이션 전(공유 칸 없음)에는 예전 규칙 그대로 — 내 질문만.
    const { data: own } = await supabaseAdmin
      .from("ai_questions")
      .select("id")
      .eq("id", questionId)
      .eq("user_id", session.user_id)
      .maybeSingle();
    if (!own) return NextResponse.json({ error: "신고할 수 없는 답입니다" }, { status: 404 });
  } else {
    const q = row as { user_id: string; shared?: boolean; share_hidden_at?: string | null } | null;
    const mine = q?.user_id === session.user_id;
    const openToAll = !!q?.shared && !q?.share_hidden_at;
    if (!q || (!mine && !openToAll)) {
      // 남의 비공개 질문이거나 없는 질문. 어느 쪽인지 알려 주지 않는다.
      return NextResponse.json({ error: "신고할 수 없는 답입니다" }, { status: 404 });
    }
  }

  const { error } = await supabaseAdmin
    .from("ai_question_answers")
    .update({ reported: true, report_reason: reason, reported_at: new Date().toISOString() })
    .eq("question_id", questionId)
    .eq("column_key", column);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
