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

// GET: 내 동기화 상태 전체 (key/value/updated_at)
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ state: [] });
  }

  const { data } = await supabaseAdmin
    .from("user_state")
    .select("key, value, updated_at")
    .eq("user_id", session.user_id);

  return NextResponse.json({ state: data || [] });
}

// POST {key, value}: upsert (user_id, key) — last-write-wins
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json();
  const { key, value } = body;
  if (!key) {
    return NextResponse.json({ error: "key가 필요합니다" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("user_state").upsert(
    {
      user_id: session.user_id,
      key,
      value: value ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
