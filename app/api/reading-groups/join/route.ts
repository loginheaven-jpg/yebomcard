/**
 * 말씀의삶 — 초대코드로 그룹 참여.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSession, normalizeCode, invalidateStandings } from "@/lib/readingGroups";

export const dynamic = "force-dynamic";

/** 한 사람이 속할 수 있는 그룹 수 */
const MAX_JOINED = 20;

// POST { code } : 대소문자·공백·하이픈 무시하고 코드로 찾아 참여
export async function POST(request: NextRequest) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const code = normalizeCode(String((body as { code?: unknown }).code ?? ""));
  if (code.length !== 6) {
    return NextResponse.json({ error: "초대코드는 6자리입니다" }, { status: 400 });
  }

  const { data: group } = await supabaseAdmin
    .from("reading_groups")
    .select("id, name, invite_code, created_by")
    .eq("invite_code", code)
    .maybeSingle();

  if (!group) {
    // 존재 여부를 숨기지 않는다 — 코드를 잘못 받아적은 교인에게 알려줘야 한다.
    return NextResponse.json({ error: "그 코드의 그룹을 찾지 못했습니다" }, { status: 404 });
  }

  const { count } = await supabaseAdmin
    .from("reading_group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", session.user_id);
  if ((count ?? 0) >= MAX_JOINED) {
    return NextResponse.json(
      { error: `참여할 수 있는 그룹은 ${MAX_JOINED}개까지입니다` },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin.from("reading_group_members").insert({
    group_id: group.id,
    user_id: session.user_id,
    user_name: session.name || null,
  });
  // 23505 = 이미 멤버. 오류가 아니라 정상 결과로 되돌려준다(코드를 두 번 눌러도 같은 화면).
  if (error && error.code !== "23505") {
    console.error("[reading-groups/join] 참여 실패", error.message);
    return NextResponse.json({ error: "그룹에 참여하지 못했습니다" }, { status: 500 });
  }

  invalidateStandings(group.id); // 새 멤버가 순위에 즉시 보여야 한다

  const { count: memberCount } = await supabaseAdmin
    .from("reading_group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", group.id);

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      inviteCode: group.invite_code,
      memberCount: memberCount ?? 1,
      isOwner: group.created_by === session.user_id,
    },
    already: !!error,
  });
}
