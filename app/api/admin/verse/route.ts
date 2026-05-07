import { NextResponse, type NextRequest } from "next/server";
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

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 });
  }

  let body: { id?: number; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const id = Number(body.id);
  const text = (body.text ?? "").trim();
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }
  if (text.length === 0) {
    return NextResponse.json({ error: "본문이 비어있을 수 없습니다" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("bible_verses")
    .update({ text })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, verse: data });
}
