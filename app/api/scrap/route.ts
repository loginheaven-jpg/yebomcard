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

// POST: 스크랩 추가
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { book_code, chapter, verse_start, verse_end, version, reference, preview, image_url } = body;

  // RPC 대신 직접 supabaseAdmin을 사용하여 scraps 테이블에 저장 (upsert 방식을 사용하여 중복 방지)
  const { error } = await supabaseAdmin.from("scraps").upsert(
    {
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
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id, book_code, chapter, verse_start, version", ignoreDuplicates: false }
  ).select("id").single();
  
  // 만약 고유 키(unique constraint) 에러가 발생한다면, 단순 insert 후 에러 무시 처리
  if (error && error.code === '23505') {
    // Unique violation (이미 스크랩됨)
    return NextResponse.json({ success: true });
  } else if (error && error.code !== '23505') {
    // onConflict 옵션이 동작하지 않는 경우를 대비한 단순 insert 폴백
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
    
    if (insertError && insertError.code !== '23505') {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
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
