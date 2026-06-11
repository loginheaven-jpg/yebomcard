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

// GET: 내가 읽은 장 목록
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ progress: [] });
  }

  const { data } = await supabaseAdmin
    .from("reading_progress")
    .select("book_code, chapter, read_at")
    .eq("user_id", session.user_id)
    .order("read_at", { ascending: false });

  return NextResponse.json({ progress: data || [] });
}

// POST: 장 읽음 기록 — SELECT-then-UPDATE/INSERT (같은 장 재방문 시 read_at 만 갱신)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { book_code, chapter, version } = body;
  if (!book_code || !chapter) {
    return NextResponse.json({ error: "book_code, chapter가 필요합니다" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("reading_progress")
    .select("id")
    .eq("user_id", session.user_id)
    .eq("book_code", book_code)
    .eq("chapter", chapter)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error: updateError } = await supabaseAdmin
      .from("reading_progress")
      .update({ version: version || null, read_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, updated: true });
  }

  const { error: insertError } = await supabaseAdmin.from("reading_progress").insert({
    user_id: session.user_id,
    book_code,
    chapter,
    version: version || null,
  });

  if (insertError && insertError.code !== "23505") {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE: 진도 초기화 (?all=1) — user_id 스코프 전체 삭제
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("all") !== "1") {
    return NextResponse.json({ error: "all=1이 필요합니다" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("reading_progress")
    .delete()
    .eq("user_id", session.user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
