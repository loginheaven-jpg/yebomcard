import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const VISIBILITIES = ["홀로", "목장", "전체"] as const;

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

// GET ?book=&chapter= : 내 노트/하이라이트 + 타인의 공개 메모(목장/전체)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ notes: [], shared: [] });
  }

  const { searchParams } = new URL(request.url);
  const book = searchParams.get("book");
  const chapter = parseInt(searchParams.get("chapter") || "0");
  if (!book || !chapter) {
    return NextResponse.json({ error: "book, chapter가 필요합니다" }, { status: 400 });
  }

  // 내 노트(하이라이트 color + 메모 note) — 기존과 동일
  const { data: mine } = await supabaseAdmin
    .from("verse_notes")
    .select("id, book_code, chapter, verse, color, note, version, visibility, updated_at")
    .eq("user_id", session.user_id)
    .eq("book_code", book)
    .eq("chapter", chapter)
    .order("verse", { ascending: true });

  // 타인의 공개 메모 — 숨김 제외, 메모 있는 것만. color(하이라이트)는 개인용이라 공유 안 함.
  const cols = "id, verse, note, user_id, user_name, group_id, visibility, created_at";
  const base = () =>
    supabaseAdmin
      .from("verse_notes")
      .select(cols)
      .eq("book_code", book)
      .eq("chapter", chapter)
      .eq("hidden", false)
      .neq("user_id", session.user_id)
      .not("note", "is", null);

  const { data: pub } = await base().eq("visibility", "전체");
  let grp: typeof pub = [];
  if (session.group_id) {
    const { data } = await base().eq("visibility", "목장").eq("group_id", session.group_id);
    grp = data || [];
  }
  const shared = [...(pub || []), ...(grp || [])].sort((a, b) =>
    (a.created_at || "").localeCompare(b.created_at || ""),
  );

  // 내가 '아멘'한 공유 메모 표시 (카운트 없이 본인 토글 상태만)
  let sharedOut = shared;
  if (shared.length > 0) {
    const ids = shared.map((s) => s.id);
    const { data: amens } = await supabaseAdmin
      .from("verse_note_amens")
      .select("note_id")
      .eq("user_id", session.user_id)
      .in("note_id", ids);
    const amenedSet = new Set((amens || []).map((a) => a.note_id));
    sharedOut = shared.map((s) => ({ ...s, i_amened: amenedSet.has(s.id) }));
  }

  return NextResponse.json({ notes: mine || [], shared: sharedOut });
}

// POST: 절 하이라이트/메모 저장 — SELECT-then-UPDATE/INSERT. color·note 둘 다 비면 행 삭제.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { book_code, chapter, verse, version } = body;
  const color: string | null = body.color || null;
  const note: string | null = body.note ? String(body.note).trim() || null : null;
  // 공개 범위 — 전달되면 사용, 미전달이면 업데이트 시 기존값 보존 / 신규는 '홀로'.
  // (하이라이트 등 visibility 미전달 저장이 공유 메모를 '홀로'로 덮어쓰지 않도록)
  const visibilityIn: string | null = VISIBILITIES.includes(body.visibility) ? body.visibility : null;

  if (!book_code || !chapter || !verse) {
    return NextResponse.json({ error: "book_code, chapter, verse가 필요합니다" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("verse_notes")
    .select("id, visibility")
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
      .update({
        color,
        note,
        version: version || null,
        visibility: visibilityIn ?? existing.visibility ?? "홀로",
        group_id: session.group_id || null,
        updated_at: new Date().toISOString(),
      })
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
    visibility: visibilityIn ?? "홀로",
    group_id: session.group_id || null,
  });

  if (insertError && insertError.code !== "23505") {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE ?book=&chapter=&verse= : 해당 절 내 노트/하이라이트 제거
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
