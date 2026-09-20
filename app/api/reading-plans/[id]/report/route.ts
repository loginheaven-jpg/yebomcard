/**
 * 말씀의삶 — 진도표 신고 (지휘부 2026-09-20)
 *
 * 진도표는 서로 보이는 틀이라, 이름이나 회차 이름에 이상한 글이 올라올 수 있다.
 * 교인이 알리면 목록에서 관리자에게 **신고 N** 으로 보이고, 운영자·수퍼어드민이 지운다.
 * 별도 표를 두지 않는다 — 건수와 마지막 사유만 알면 판단할 수 있다.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { readSession } from "@/lib/readingGroups";
import { loadPlanRow } from "@/lib/readingPlans";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "reading-plans-report", 10, 10 * 60_000);
  if (limited) return limited;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const { id } = await ctx.params;
  const row = await loadPlanRow(id);
  if (!row) return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const reason = String((body as { reason?: unknown }).reason ?? "").trim().slice(0, 200) || null;

  const { error } = await supabaseAdmin
    .from("reading_plans")
    .update({
      report_count: (row.report_count ?? 0) + 1,
      report_reason: reason ?? row.report_reason,
    })
    .eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
