import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabase } from "@/lib/supabase";

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

// GET: 내 스크랩 목록 (최신순)
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ scraps: [] });
  }

  const { data } = await supabase
    .from("scraps")
    .select("*")
    .eq("user_id", session.user_id)
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ scraps: data || [] });
}

// POST: 스크랩 추가
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { book_code, chapter, verse_start, verse_end, version, reference, preview } = body;

  const { error } = await supabase.rpc("add_scrap", {
    p_user_id: session.user_id,
    p_user_name: session.name,
    p_book_code: book_code,
    p_chapter: chapter,
    p_verse_start: verse_start,
    p_verse_end: verse_end,
    p_version: version,
    p_reference: reference,
    p_preview: preview,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE: 스크랩 삭제
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "0");

  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다" }, { status: 400 });
  }

  await supabase.rpc("remove_scrap", {
    p_user_id: session.user_id,
    p_id: id,
  });

  return NextResponse.json({ success: true });
}
