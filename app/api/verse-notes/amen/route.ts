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
    const session = await unsealData<SessionData>(sealed.value, { password: sessionOptions.password });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

// POST { note_id } : '아멘' 토글 (있으면 취소, 없으면 추가). 카운트 미표시 — on/off만.
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

  const { data: existing } = await supabaseAdmin
    .from("verse_note_amens")
    .select("id")
    .eq("note_id", noteId)
    .eq("user_id", session.user_id)
    .maybeSingle();

  if (existing?.id) {
    await supabaseAdmin.from("verse_note_amens").delete().eq("id", existing.id);
    return NextResponse.json({ success: true, amened: false });
  }

  const { error } = await supabaseAdmin
    .from("verse_note_amens")
    .insert({ note_id: noteId, user_id: session.user_id });
  // 동시요청 중복(23505)은 이미 아멘 상태로 간주
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, amened: true });
}
