/**
 * 말씀의삶 — 그룹 나가기.
 *
 * 만든 사람도 나갈 수 있다. 단 혼자 남았을 때만이고, 그때는 그룹이 사라진다.
 * (다른 멤버가 있는데 방장만 빠지면 아무도 관리할 수 없는 그룹이 남는다.)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSession, invalidateStandings } from "@/lib/readingGroups";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return NextResponse.json({ error: "잘못된 그룹입니다" }, { status: 400 });
  }

  const { data: group } = await supabaseAdmin
    .from("reading_groups")
    .select("id, created_by")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "그룹을 찾지 못했습니다" }, { status: 404 });
  }

  const { data: members } = await supabaseAdmin
    .from("reading_group_members")
    .select("user_id")
    .eq("group_id", groupId);
  const list = members || [];
  if (!list.some((m) => m.user_id === session.user_id)) {
    return NextResponse.json({ error: "이 그룹의 멤버가 아닙니다" }, { status: 403 });
  }

  if (group.created_by === session.user_id && list.length > 1) {
    return NextResponse.json(
      { error: "다른 멤버가 있는 동안에는 만든 사람이 나갈 수 없습니다" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("reading_group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", session.user_id); // 절대 빠뜨리지 말 것 — service_role 은 전 행에 접근한다
  if (error) {
    console.error("[reading-groups/leave] 탈퇴 실패", error.message);
    return NextResponse.json({ error: "그룹을 나가지 못했습니다" }, { status: 500 });
  }

  // 마지막 한 사람이 나가면 빈 그룹이 남는다. 이름과 초대코드를 붙잡고 있을 이유가 없다.
  let deleted = false;
  if (list.length === 1) {
    await supabaseAdmin.from("reading_groups").delete().eq("id", groupId);
    deleted = true;
  }

  invalidateStandings(groupId);
  return NextResponse.json({ success: true, deleted });
}
