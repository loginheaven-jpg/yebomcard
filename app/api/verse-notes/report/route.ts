import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// 서로 다른 신고자 N명 누적 시 자동 임시숨김(모두에게 안 보임) → 운영자 검토
const HIDE_THRESHOLD = 2;

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

// POST { note_id } : 타인 메모 신고(사유 불문). 같은 사람 중복 신고는 무시.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const noteId = Number(body.note_id);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return NextResponse.json({ error: "유효한 note_id가 필요합니다" }, { status: 400 });
  }

  // 대상 메모 확인 — 내 메모는 신고 불가
  const { data: target } = await supabaseAdmin
    .from("verse_notes")
    .select("id, user_id")
    .eq("id", noteId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "메모를 찾을 수 없습니다" }, { status: 404 });
  }
  if (target.user_id === session.user_id) {
    return NextResponse.json({ error: "본인 메모는 신고할 수 없습니다" }, { status: 400 });
  }

  // (메모, 신고자) 1회 — 중복은 무시(23505)
  const { error: insErr } = await supabaseAdmin.from("verse_note_reports").insert({
    note_id: noteId,
    reporter_user_id: session.user_id,
    reporter_name: session.name,
  });
  if (insErr && insErr.code !== "23505") {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 서로 다른 신고자 수 집계 → 임계 도달 시 임시숨김
  const { count } = await supabaseAdmin
    .from("verse_note_reports")
    .select("reporter_user_id", { count: "exact", head: true })
    .eq("note_id", noteId);

  let hidden = false;
  if ((count ?? 0) >= HIDE_THRESHOLD) {
    await supabaseAdmin.from("verse_notes").update({ hidden: true }).eq("id", noteId);
    hidden = true;
  }

  return NextResponse.json({ success: true, reports: count ?? 0, hidden });
}
