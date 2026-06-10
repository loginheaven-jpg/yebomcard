import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabase } from "@/lib/supabase";
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

// POST: 스크랩 추가 — 중복 방지를 위해 SELECT-then-UPDATE/INSERT (UNIQUE constraint 가 있든 없든 동작)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { book_code, chapter, verse_start, verse_end, version, reference, preview, image_url } = body;

  // 같은 (user_id, book_code, chapter, verse_start, version) 가 이미 있는지 확인
  const { data: existing } = await supabaseAdmin
    .from("scraps")
    .select("id")
    .eq("user_id", session.user_id)
    .eq("book_code", book_code)
    .eq("chapter", chapter)
    .eq("verse_start", verse_start)
    .eq("version", version)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    // 기존 row UPDATE — verse_end, reference, preview, image_url, created_at 갱신
    const { error: updateError } = await supabaseAdmin
      .from("scraps")
      .update({
        verse_end,
        reference,
        preview,
        image_url: image_url || null,
        created_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, updated: true });
  }

  // 신규 INSERT
  const { error: insertError } = await supabaseAdmin.from("scraps").insert({
    user_id: session.user_id,
    user_name: session.name,
    book_code,
    chapter,
    verse_start,
    verse_end,
    version,
    reference,
    preview,
    image_url: image_url || null,
  });

  if (insertError && insertError.code !== "23505") {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
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
