/**
 * 말씀의삶 — 그룹 목록·생성.
 *
 * reading_groups / reading_group_members 는 RLS 를 켜고 정책을 두지 않았다(service_role 전용).
 * anon 클라이언트로 접근하면 오류 없이 빈 배열이 돌아오므로 **반드시 supabaseAdmin 을 쓴다.**
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  PLAN_ID,
  readSession,
  myGroups,
  makeInviteCode,
} from "@/lib/readingGroups";

export const dynamic = "force-dynamic";

/** 한 사람이 만들 수 있는 그룹 수 — 실수로 눌러 쌓이는 것만 막는 선 */
const MAX_OWNED = 10;

// GET: 내가 속한 그룹 + 인원수
// 비로그인은 401 이 아니라 200 + 빈 배열 — 진도표 자체는 로그인 없이도 열린다.
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ groups: [] });

  const groups = await myGroups(session.user_id);
  if (groups.length === 0) return NextResponse.json({ groups: [] });

  // 인원수는 그룹 수만큼 쿼리하지 않고 한 번에 세어 나눈다.
  const { data: members } = await supabaseAdmin
    .from("reading_group_members")
    .select("group_id")
    .in("group_id", groups.map((g) => g.id));
  const counts = new Map<number, number>();
  for (const m of members || []) counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      inviteCode: g.invite_code,
      memberCount: counts.get(g.id) ?? 0,
      isOwner: g.created_by === session.user_id,
    })),
  });
}

// POST { name } : 그룹 생성 + 생성자 자동 참여
export async function POST(request: NextRequest) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String((body as { name?: unknown }).name ?? "").trim().slice(0, 30);
  if (!name) {
    return NextResponse.json({ error: "그룹 이름을 입력해 주세요" }, { status: 400 });
  }

  const { count } = await supabaseAdmin
    .from("reading_groups")
    .select("id", { count: "exact", head: true })
    .eq("created_by", session.user_id);
  if ((count ?? 0) >= MAX_OWNED) {
    return NextResponse.json(
      { error: `만들 수 있는 그룹은 ${MAX_OWNED}개까지입니다` },
      { status: 400 },
    );
  }

  // 초대코드는 UNIQUE 라 충돌하면 23505 로 돌아온다. 세 번까지 다시 뽑는다.
  // (32^6 ≈ 10억이라 실제 충돌은 사실상 없지만, 있을 때 500 을 던지지 않기 위한 것)
  for (let attempt = 0; attempt < 3; attempt++) {
    const invite_code = makeInviteCode();
    const { data, error } = await supabaseAdmin
      .from("reading_groups")
      .insert({ name, invite_code, plan_id: PLAN_ID, created_by: session.user_id })
      .select("id, name, invite_code")
      .single();

    if (error) {
      if (error.code === "23505") continue; // 코드 충돌 — 다시 뽑는다
      console.error("[reading-groups] 생성 실패", error.message);
      return NextResponse.json({ error: "그룹을 만들지 못했습니다" }, { status: 500 });
    }

    // 만든 사람은 곧바로 멤버다. 여기서 실패하면 주인 없는 그룹이 남으므로 되돌린다.
    const { error: joinErr } = await supabaseAdmin.from("reading_group_members").insert({
      group_id: data.id,
      user_id: session.user_id,
      user_name: session.name || null,
    });
    if (joinErr && joinErr.code !== "23505") {
      await supabaseAdmin.from("reading_groups").delete().eq("id", data.id);
      console.error("[reading-groups] 생성자 참여 실패", joinErr.message);
      return NextResponse.json({ error: "그룹을 만들지 못했습니다" }, { status: 500 });
    }

    return NextResponse.json({
      group: {
        id: data.id,
        name: data.name,
        inviteCode: data.invite_code,
        memberCount: 1,
        isOwner: true,
      },
    });
  }

  return NextResponse.json({ error: "초대코드를 만들지 못했습니다. 다시 시도해 주세요" }, { status: 500 });
}
