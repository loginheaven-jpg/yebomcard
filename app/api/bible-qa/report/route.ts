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
import { QA_COLUMNS } from "@/lib/bibleQa/columns";

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
  if (!QA_COLUMNS.some((c) => c.key === column)) {
    return NextResponse.json({ error: "유효한 column이 필요합니다" }, { status: 400 });
  }

  // 자기 질문인지 먼저 본다.
  const { data: own, error: ownError } = await supabaseAdmin
    .from("ai_questions")
    .select("id")
    .eq("id", questionId)
    .eq("user_id", session.user_id)
    .maybeSingle();
  if (ownError) {
    return NextResponse.json({ error: ownError.message }, { status: 500 });
  }
  if (!own) {
    // 남의 질문이거나 없는 질문. 어느 쪽인지 알려 주지 않는다.
    return NextResponse.json({ error: "신고할 수 없는 답입니다" }, { status: 404 });
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
