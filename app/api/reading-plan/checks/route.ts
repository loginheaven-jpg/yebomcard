/**
 * 말씀의삶 — 회차 수동 체크("종이로 읽음").
 *
 * 회차 완료는 대부분 reading_progress 에서 파생 계산한다. 이 라우트가 담는 것은
 * **자동으로 알 수 없는 것 하나** — 앱이 아니라 종이 성경으로 읽은 경우다.
 *
 * reading_unit_checks 는 RLS 를 켜고 정책을 두지 않았다(service_role 전용).
 * anon 클라이언트(lib/supabase)로 접근하면 오류 없이 빈 배열이 돌아오므로,
 * **반드시 supabaseAdmin 을 쓰고 항상 user_id 로 스코프한다.**
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const PLAN_ID = "yebom91";
const MAX_SEQ = 91;

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

/** 1..91 정수만 통과 */
function parseSeq(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_SEQ ? n : null;
}

// GET: 내가 종이로 읽었다고 표시한 회차 목록
// 비로그인은 401 이 아니라 200 + 빈 배열 — 진도표는 로그인 없이도 열람할 수 있어야 한다.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ seqs: [] });
  }

  // 최대 91행이라 페이지네이션이 필요 없다.
  const { data, error } = await supabaseAdmin
    .from("reading_unit_checks")
    .select("seq")
    .eq("user_id", session.user_id)
    .eq("plan_id", PLAN_ID)
    .order("seq");

  if (error) {
    console.error("[reading-plan/checks] 조회 실패", error.message);
    return NextResponse.json({ seqs: [], error: "체크 목록을 불러오지 못했습니다" }, { status: 500 });
  }
  return NextResponse.json({ seqs: (data || []).map((r) => r.seq) });
}

// POST { seq } : 체크. SELECT-then-INSERT (UNIQUE 인덱스는 동시 요청 백스탑)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const seq = parseSeq((body as { seq?: unknown }).seq);
  if (seq === null) {
    return NextResponse.json({ error: `seq 는 1~${MAX_SEQ} 정수여야 합니다` }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("reading_unit_checks")
    .select("id")
    .eq("user_id", session.user_id)
    .eq("plan_id", PLAN_ID)
    .eq("seq", seq)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    // 갱신할 것이 없다 — 체크 시각을 덮어쓰면 "언제 마쳤는가"가 재클릭으로 바뀐다
    return NextResponse.json({ success: true, already: true });
  }

  const { error } = await supabaseAdmin.from("reading_unit_checks").insert({
    user_id: session.user_id,
    plan_id: PLAN_ID,
    seq,
  });
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE ?seq= : 체크 해제
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const seq = parseSeq(searchParams.get("seq"));
  if (seq === null) {
    return NextResponse.json({ error: `seq 는 1~${MAX_SEQ} 정수여야 합니다` }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("reading_unit_checks")
    .delete()
    .eq("user_id", session.user_id)   // 절대 빠뜨리지 말 것 — service_role 은 전 행에 접근한다
    .eq("plan_id", PLAN_ID)
    .eq("seq", seq);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
