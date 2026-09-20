/**
 * 말씀의삶 — 진도표 목록 · 만들기 (지휘부 2026-09-20)
 *
 *  - 진도표는 **틀(템플릿)이라 서로 보인다.** 진도(누가 어디까지 읽었는지)는 그룹 안에서만 보인다.
 *  - 만든 사람이 '나만 쓰기' 를 고르면 목록에서 빠진다.
 *  - 표준진도표(파일)는 목록 맨 앞에 붙는다 — DB 에 없다.
 *
 * `reading_plans` 는 service_role 전용(RLS 켜고 정책 없음)이라 반드시 supabaseAdmin 으로 접근한다.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { myGroups, readSession } from "@/lib/readingGroups";
import {
  MAX_PLANS_PER_USER,
  MAX_PLAN_DESC,
  MAX_PLAN_NAME,
  sanitizeUnits,
  validateUnits,
} from "@/lib/plans/builder";
import {
  isMissingTable,
  listPlans,
  statsOf,
  summaryFromRow,
  withBuiltins,
  type PlanRow,
} from "@/lib/readingPlans";
import { dbPlanSlug } from "@/lib/plans/registry";

export const dynamic = "force-dynamic";

const NOT_READY = {
  error: "진도표 만들기가 아직 준비 중입니다 (scripts/migration-reading-plans.sql)",
  ready: false,
};

/** GET — 고르기 창이 쓰는 목록. 비로그인도 공개 진도표를 볼 수 있다(틀이니까). */
export async function GET() {
  const session = await readSession();
  const groupPlanIds = session
    ? (await myGroups(session.user_id)).map((g) => g.plan_id).filter((v): v is string => !!v)
    : [];
  const list = await listPlans(session?.user_id ?? null, groupPlanIds);
  return NextResponse.json({
    ready: list.ready,
    // 표준진도표는 언제나 첫 줄 — 표가 없어도 말씀의삶은 그대로 돈다.
    plans: withBuiltins(list.others, list.groupCounts),
    mine: list.mine,
    groupPlanIds,
  });
}

/** POST { name, description, units, visibility } — 새 진도표 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "reading-plans-write", 30, 10 * 60_000);
  if (limited) return limited;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, MAX_PLAN_NAME);
  const description = String(body.description ?? "").trim().slice(0, MAX_PLAN_DESC) || null;
  const visibility = body.visibility === "private" ? "private" : "public";
  if (!name) return NextResponse.json({ error: "진도표 이름을 적어 주세요" }, { status: 400 });

  // 클라이언트가 보낸 회차를 그대로 믿지 않는다 — 거르고, 검사하고, 요약값은 서버가 다시 센다.
  const units = sanitizeUnits(body.units);
  const issues = validateUnits(units);
  if (issues.errors.length > 0) {
    return NextResponse.json({ error: issues.errors[0], errors: issues.errors }, { status: 400 });
  }

  const { count, error: countError } = await supabaseAdmin
    .from("reading_plans")
    .select("id", { count: "exact", head: true })
    .eq("created_by", session.user_id);
  if (countError && isMissingTable(countError)) return NextResponse.json(NOT_READY, { status: 503 });
  if ((count ?? 0) >= MAX_PLANS_PER_USER) {
    return NextResponse.json(
      { error: `만들 수 있는 진도표는 ${MAX_PLANS_PER_USER}개까지입니다` },
      { status: 400 },
    );
  }

  const stats = statsOf(units);
  // slug 는 id 로 만든다(p12). id 를 받기 전이라 임시 값으로 넣고 바로 고친다 — slug 는 UNIQUE 다.
  const temp = `tmp${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const { data, error } = await supabaseAdmin
    .from("reading_plans")
    .insert({
      slug: temp,
      name,
      description,
      units,
      ...stats,
      visibility,
      created_by: session.user_id,
      created_by_name: session.name ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingTable(error)) return NextResponse.json(NOT_READY, { status: 503 });
    return NextResponse.json({ error: error?.message ?? "저장하지 못했습니다" }, { status: 500 });
  }

  const slug = dbPlanSlug(data.id as number);
  const { data: saved, error: slugError } = await supabaseAdmin
    .from("reading_plans")
    .update({ slug })
    .eq("id", data.id)
    .select("id, slug, name, description, unit_count, chapter_count, visibility, created_by, created_by_name, locked_at, hidden_at, report_count, updated_at")
    .single();
  if (slugError || !saved) {
    // 키를 못 붙였으면 남겨 두지 않는다 — 임시 slug 인 채로 남으면 아무도 고를 수 없는 줄이 된다.
    await supabaseAdmin.from("reading_plans").delete().eq("id", data.id);
    return NextResponse.json({ error: "저장하지 못했습니다" }, { status: 500 });
  }

  return NextResponse.json({ plan: summaryFromRow(saved as Partial<PlanRow>, 0), warnings: issues.warnings });
}
