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

// GET ?book=&chapter= : 해당 장의 내 노트/하이라이트 (장 단위 페치)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ notes: [] });
  }

  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") || "0");
  if (!book || !chapter) {
    return NextResponse.json({ error: "book, chapter가 필요합니다" }, { status: 400 });
  }

  const { data } = await supabaseAdmin
    .from("verse_notes")
    .select("id, book_code, chapter, verse, color, note, version, updated_at")
    .eq("user_id", session.user_id)
    .eq("book_code", book)
    .eq("chapter", chapter)
    .order("verse", { ascending: true });

  return NextResponse.json({ notes: data || [] });
}

// POST: 절 하이라이트/메모 저장 — SELECT-then-UPDATE/INSERT.
//   color·note 둘 다 비면 행 삭제 (빈 행 방지).
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { book_code, chapter, verse, version } = body;
  const color: string | null = body.color || null;
  const note: string | null = body.note ? String(body.note).trim() || null : null;

  if (!book_code || !chapter || !verse) {
    return NextResponse.json({ error: "book_code, chapter, verse가 필요합니다" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("verse_notes")
    .select("id")
    .eq("user_id", session.user_id)
    .eq("book_code", book_code)
    .eq("chapter", chapter)
    .eq("verse", verse)
    .limit(1)
    .maybeSingle();

  // 색·메모 둘 다 없으면 제거
  if (!color && !note) {
    if (existing?.id) {
      await supabaseAdmin.from("verse_notes").delete().eq("id", existing.id);
    }
    return NextResponse.json({ success: true, removed: true });
  }

  if (existing?.id) {
    const { error: updateError } = await supabaseAdmin
      .from("verse_notes")
      .update({ color, note, version: version || null, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, updated: true });
  }

  const { error: insertError } = await supabaseAdmin.from("verse_notes").insert({
    user_id: session.user_id,
    user_name: session.name,
    book_code,
    chapter,
    verse,
    color,
    note,
    version: version || null,
  });

  if (insertError && insertError.code !== "23505") {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE ?book=&chapter=&verse= : 해당 절 노트/하이라이트 제거
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") || "0");
  const verse = parseInt(searchParams.get("verse") || "0");
  if (!book || !chapter || !verse) {
    return NextResponse.json({ error: "book, chapter, verse가 필요합니다" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("verse_notes")
    .delete()
    .eq("user_id", session.user_id)
    .eq("book_code", book)
    .eq("chapter", chapter)
    .eq("verse", verse);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
