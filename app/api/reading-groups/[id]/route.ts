/**
 * 말씀의삶 — 그룹 하나 고치기 (지금은 **진도표 바꾸기**뿐, 2026-09-20)
 *
 * 그룹을 만든 사람만 바꾼다. 회차 수가 다른 진도표로 바꾸면 "몇 회차 읽음" 의 기준이 달라지므로
 * 화면이 먼저 알린다. 회차 체크는 진도표별로 따로 쌓이니(`reading_unit_checks.plan_id`)
 * 되돌리면 예전 기록이 그대로 살아난다.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { invalidateStandings, readSession } from "@/lib/readingGroups";
import { planLabels, usablePlanId } from "@/lib/readingPlans";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "reading-groups-write", 30, 10 * 60_000);
  if (limited) return limited;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const { id } = await ctx.params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return NextResponse.json({ error: "잘못된 그룹입니다" }, { status: 400 });
  }

  const { data: group } = await supabaseAdmin
    .from("reading_groups")
    .select("id, created_by, plan_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return NextResponse.json({ error: "그룹을 찾지 못했습니다" }, { status: 404 });
  if (group.created_by !== session.user_id) {
    return NextResponse.json({ error: "그룹을 만든 분만 바꿀 수 있습니다" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const wanted = String((body as { planId?: unknown }).planId ?? "").trim();
  if (!wanted) return NextResponse.json({ error: "진도표를 골라 주세요" }, { status: 400 });

  const planId = await usablePlanId(wanted, session.user_id);
  if (!planId) return NextResponse.json({ error: "고르신 진도표를 찾지 못했습니다" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("reading_groups")
    .update({ plan_id: planId })
    .eq("id", groupId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 캐시를 버리지 않으면 최대 60초 동안 **옛 진도표 기준 순위**가 남는다.
  invalidateStandings(groupId);

  const label = (await planLabels([planId])).get(planId);
  return NextResponse.json({
    ok: true,
    planId,
    planName: label?.name ?? null,
    unitCount: label?.unitCount ?? 0,
  });
}
