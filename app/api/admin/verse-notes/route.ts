import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { isAdmin } from "@/lib/admin";
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

// GET : 신고된(또는 자동숨김된) 메모 목록 — 운영자·수퍼어드민(isAdmin)
export async function GET() {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
  }

  // 신고 레코드 수집 → note_id별 신고자/건수 집계
  const { data: reports } = await supabaseAdmin
    .from("verse_note_reports")
    .select("note_id, reporter_name, created_at")
    .order("created_at", { ascending: false });

  const byNote = new Map<number, { count: number; reporters: string[]; last: string }>();
  for (const r of reports || []) {
    const e: { count: number; reporters: string[]; last: string } =
      byNote.get(r.note_id) || { count: 0, reporters: [], last: r.created_at };
    e.count += 1;
    if (r.reporter_name) e.reporters.push(r.reporter_name);
    byNote.set(r.note_id, e);
  }
  const noteIds = [...byNote.keys()];
  if (noteIds.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const { data: notes } = await supabaseAdmin
    .from("verse_notes")
    .select("id, book_code, chapter, verse, note, user_name, group_id, visibility, hidden, created_at")
    .in("id", noteIds);

  const items = (notes || [])
    .map((n) => {
      const r = byNote.get(n.id);
      return {
        ...n,
        report_count: r?.count ?? 0,
        reporters: r?.reporters ?? [],
        last_reported: r?.last ?? null,
      };
    })
    // 숨김(자동) 먼저, 그다음 신고 많은 순
    .sort((a, b) => Number(b.hidden) - Number(a.hidden) || b.report_count - a.report_count);

  return NextResponse.json({ items });
}

// DELETE ?id= : 메모 영구 삭제 (신고 레코드는 cascade 삭제)
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
  }
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from("verse_notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deleted: true });
}

// PATCH { id } : 신고 기각(복원) — 숨김 해제 + 해당 메모 신고 레코드 삭제
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }
  await supabaseAdmin.from("verse_notes").update({ hidden: false }).eq("id", id);
  await supabaseAdmin.from("verse_note_reports").delete().eq("note_id", id);
  return NextResponse.json({ success: true, restored: true });
}
