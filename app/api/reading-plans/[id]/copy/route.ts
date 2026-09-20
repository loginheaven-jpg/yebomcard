/**
 * 말씀의삶 — 진도표 복사하기 (지휘부 2026-09-20)
 *
 * 남의 진도표는 고칠 수 없고, **복사하면 내 것**이 된다. 읽기 시작해 잠긴 진도표도 복사는 된다 —
 * 잠금은 '남이 읽는 중에 회차가 밀리는 것' 을 막는 것이지 베껴 쓰는 것을 막는 것이 아니다.
 * 표준진도표(파일)도 복사해서 우리 목장에 맞게 고칠 수 있다.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { readSession } from "@/lib/readingGroups";
import { MAX_PLANS_PER_USER, MAX_PLAN_NAME, sanitizeUnits } from "@/lib/plans/builder";
import { BUILTIN_PLANS, dbPlanSlug } from "@/lib/plans/registry";
import { isMissingTable, loadPlanRow, statsOf, summaryFromRow } from "@/lib/readingPlans";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "reading-plans-write", 30, 10 * 60_000);
  if (limited) return limited;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const { id } = await ctx.params;

  // 파일 진도표(표준진도표)와 DB 진도표를 함께 받는다.
  const builtin = BUILTIN_PLANS[id];
  const row = builtin ? null : await loadPlanRow(id);
  if (!builtin && !row) return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });
  if (row && row.visibility === "private" && row.created_by !== session.user_id) {
    return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });
  }

  const units = builtin ? builtin.units : sanitizeUnits(row!.units);
  if (units.length === 0) return NextResponse.json({ error: "회차가 없습니다" }, { status: 400 });

  const { count, error: countError } = await supabaseAdmin
    .from("reading_plans")
    .select("id", { count: "exact", head: true })
    .eq("created_by", session.user_id);
  if (countError && isMissingTable(countError)) {
    return NextResponse.json({ error: "진도표 만들기가 아직 준비 중입니다" }, { status: 503 });
  }
  if ((count ?? 0) >= MAX_PLANS_PER_USER) {
    return NextResponse.json(
      { error: `만들 수 있는 진도표는 ${MAX_PLANS_PER_USER}개까지입니다` },
      { status: 400 },
    );
  }

  const baseName = builtin ? builtin.name : row!.name;
  const name = `${baseName} (복사)`.slice(0, MAX_PLAN_NAME);
  const temp = `tmp${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  const { data, error } = await supabaseAdmin
    .from("reading_plans")
    .insert({
      slug: temp,
      name,
      description: builtin ? null : row!.description,
      units,
      ...statsOf(units),
      // 복사본은 **공개**로 둔다(지휘부: 기본 공개). 고치는 동안 숨기고 싶으면 '나만 쓰기' 로 바꾼다.
      visibility: "public",
      created_by: session.user_id,
      created_by_name: session.name ?? null,
      copied_from: row ? row.id : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingTable(error)) {
      return NextResponse.json({ error: "진도표 만들기가 아직 준비 중입니다" }, { status: 503 });
    }
    return NextResponse.json({ error: error?.message ?? "복사하지 못했습니다" }, { status: 500 });
  }

  const slug = dbPlanSlug(data.id as number);
  const { data: saved } = await supabaseAdmin
    .from("reading_plans")
    .update({ slug })
    .eq("id", data.id)
    .select("id, slug, name, description, unit_count, chapter_count, visibility, created_by, created_by_name, locked_at, hidden_at, report_count, updated_at")
    .single();
  if (!saved) {
    await supabaseAdmin.from("reading_plans").delete().eq("id", data.id);
    return NextResponse.json({ error: "복사하지 못했습니다" }, { status: 500 });
  }

  return NextResponse.json({ plan: summaryFromRow(saved) });
}
