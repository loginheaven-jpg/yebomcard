/**
 * 말씀의삶 — 그룹 순위.
 *
 * 정렬은 완료 회차 내림차순, **동률이면 이름 가나다순**이다.
 * "먼저 마친 사람이 위"는 쓰지 않는다 — read_at 은 재열람마다 갱신되므로
 * 이미 읽은 장을 한 번 다시 열면 순위가 뒤집힌다(규칙과 화면이 어긋나면 순위를 불신한다).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSession, groupStandings } from "@/lib/readingGroups";

export const dynamic = "force-dynamic";

export async function GET(
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

  // **멤버만 본다.** 이 확인을 빠뜨리면 id 를 1씩 올려가며 남의 모임 명단과 진도를 볼 수 있다.
  const { data: me } = await supabaseAdmin
    .from("reading_group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", session.user_id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "이 그룹의 멤버가 아닙니다" }, { status: 403 });
  }

  const { data: group } = await supabaseAdmin
    .from("reading_groups")
    .select("id, name, invite_code, created_by")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "그룹을 찾지 못했습니다" }, { status: 404 });
  }

  const rows = await groupStandings(groupId, Date.now());
  const myRank = rows.findIndex((r) => r.user_id === session.user_id);

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      inviteCode: group.invite_code,
      memberCount: rows.length,
      isOwner: group.created_by === session.user_id,
    },
    // 동점자는 같은 등수다 (1,1,3). 이름순은 같은 등수 안의 표시 순서일 뿐이다 —
    // 이름이 앞선다고 등수가 앞서면 순위가 이름 경쟁이 된다.
    standings: rows.map((r) => ({
      userId: r.user_id,
      name: r.user_name,
      doneCount: r.doneCount,
      readChapters: r.readChapters,
      rank: rows.findIndex((x) => x.doneCount === r.doneCount) + 1,
      isMe: r.user_id === session.user_id,
    })),
    // 내 등수도 같은 규칙(동점 = 같은 등수)으로 낸다. 배열 위치가 아니다.
    myRank:
      myRank >= 0
        ? rows.findIndex((x) => x.doneCount === rows[myRank].doneCount) + 1
        : null,
  });
}
