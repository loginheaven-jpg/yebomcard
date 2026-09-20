/**
 * 말씀의삶 — 진도표 하나 (보기 · 고치기 · 지우기)
 *
 * 정한 것(지휘부 2026-09-20)
 *  - **고치기는 만든 사람만.** 다른 사람이 이 진도표로 회차를 체크하면 **범위가 잠긴다**(복사해서 고친다).
 *    이름과 설명은 잠긴 뒤에도 고칠 수 있다 — 오타 하나로 복사본을 만들게 하지 않는다.
 *  - **지우기는 만든 사람 · 운영자 · 수퍼어드민.**
 *    쓰는 그룹이 없으면 지우고, 있으면 목록에서만 내린다(쓰던 그룹은 그대로 읽는다).
 *    수퍼어드민이 끝내 지우면 **그 그룹의 진도표는 해제**된다 — 다른 진도표로 임의로 옮기지 않는다.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { readSession } from "@/lib/readingGroups";
import { requireFreshAdmin } from "@/lib/auth/verifySession";
import { isAdmin, isSuperAdmin } from "@/lib/admin";
import { invalidateStandings } from "@/lib/readingGroups";
import {
  MAX_PLAN_DESC,
  MAX_PLAN_NAME,
  sanitizeUnits,
  validateUnits,
} from "@/lib/plans/builder";
import {
  groupUseCounts,
  isMissingTable,
  loadPlanRow,
  lockIfOthersRead,
  statsOf,
  summaryFromRow,
} from "@/lib/readingPlans";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET — 회차까지 내려준다. 비공개 진도표는 만든 사람만 본다. */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const row = await loadPlanRow(id);
  if (!row) return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });

  const session = await readSession();
  const mine = !!session && session.user_id === row.created_by;
  if (row.visibility === "private" && !mine) {
    // 있는지 없는지도 알려 주지 않는다.
    return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });
  }

  const counts = await groupUseCounts([row.slug]);
  const locked = await lockIfOthersRead(row);
  return NextResponse.json({
    plan: { ...summaryFromRow(row, counts.get(row.slug) ?? 0), locked },
    units: sanitizeUnits(row.units),
    mine,
    updatedAt: row.updated_at,
  });
}

/** PATCH { name?, description?, visibility?, units? } — 만든 사람만 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const limited = rateLimit(request, "reading-plans-write", 30, 10 * 60_000);
  if (limited) return limited;

  const { id } = await ctx.params;
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const row = await loadPlanRow(id);
  if (!row) return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });
  if (row.created_by !== session.user_id) {
    return NextResponse.json({ error: "만든 사람만 고칠 수 있습니다" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("name" in body) {
    const name = String(body.name ?? "").trim().slice(0, MAX_PLAN_NAME);
    if (!name) return NextResponse.json({ error: "진도표 이름을 적어 주세요" }, { status: 400 });
    patch.name = name;
  }
  if ("description" in body) {
    patch.description = String(body.description ?? "").trim().slice(0, MAX_PLAN_DESC) || null;
  }
  if ("visibility" in body) {
    patch.visibility = body.visibility === "private" ? "private" : "public";
  }

  let warnings: string[] = [];
  if ("units" in body) {
    // 잠긴 뒤에는 범위를 못 고친다 — 남이 읽는 중에 회차 번호가 밀리면 그 사람의 체크가 어긋난다.
    if (await lockIfOthersRead(row)) {
      return NextResponse.json(
        {
          error: "다른 분이 이 진도표로 읽고 있어 회차를 고칠 수 없습니다. 복사해서 새 진도표로 고쳐 주세요.",
          locked: true,
        },
        { status: 409 },
      );
    }
    const units = sanitizeUnits(body.units);
    const issues = validateUnits(units);
    if (issues.errors.length > 0) {
      return NextResponse.json({ error: issues.errors[0], errors: issues.errors }, { status: 400 });
    }
    warnings = issues.warnings;
    patch.units = units;
    Object.assign(patch, statsOf(units));
  }

  const { data, error } = await supabaseAdmin
    .from("reading_plans")
    .update(patch)
    .eq("id", row.id)
    .select("id, slug, name, description, unit_count, chapter_count, visibility, created_by, created_by_name, locked_at, hidden_at, report_count, updated_at")
    .single();
  if (error || !data) {
    if (isMissingTable(error)) return NextResponse.json({ error: "준비 중입니다" }, { status: 503 });
    return NextResponse.json({ error: error?.message ?? "저장하지 못했습니다" }, { status: 500 });
  }

  // 회차가 바뀌면 그 진도표를 쓰는 그룹의 순위 캐시가 옛 기준으로 남는다.
  if ("units" in body) invalidateStandings();

  return NextResponse.json({ plan: summaryFromRow(data), warnings });
}

/**
 * DELETE — 만든 사람 · 운영자 · 수퍼어드민.
 * `?force=1` 은 수퍼어드민만: 쓰는 그룹이 있어도 지우고 **그 그룹의 진도표를 해제**한다.
 */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const limited = rateLimit(request, "reading-plans-write", 30, 10 * 60_000);
  if (limited) return limited;

  const { id } = await ctx.params;
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const row = await loadPlanRow(id);
  if (!row) return NextResponse.json({ error: "없는 진도표입니다" }, { status: 404 });

  const mine = row.created_by === session.user_id;
  const force = new URL(request.url).searchParams.get("force") === "1";

  // 관리자 판정은 **DB 최신 등급**으로 한다 — 쿠키 등급은 교적부에서 내려도 400일간 통한다.
  let admin = false;
  let superAdmin = false;
  if (!mine || force) {
    const gate = await requireFreshAdmin();
    if (gate.ok) {
      admin = isAdmin(gate.session);
      superAdmin = isSuperAdmin(gate.session);
    }
  }
  if (!mine && !admin) {
    return NextResponse.json({ error: "만든 사람과 관리자만 지울 수 있습니다" }, { status: 403 });
  }
  if (force && !superAdmin) {
    return NextResponse.json({ error: "쓰는 그룹이 있는 진도표는 수퍼어드민만 지울 수 있습니다" }, { status: 403 });
  }

  const used = (await groupUseCounts([row.slug])).get(row.slug) ?? 0;

  if (used > 0 && !force) {
    // 쓰는 그룹이 있다 — 목록에서만 내린다. 쓰던 그룹은 그대로 읽는다.
    const { error } = await supabaseAdmin
      .from("reading_plans")
      .update({ hidden_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      hidden: true,
      usedByGroups: used,
      message: `${used}개 그룹이 읽고 있어 목록에서만 내렸습니다. 그 그룹은 계속 읽습니다.`,
    });
  }

  // 쓰는 그룹의 진도표를 **해제**한다(지휘부: 임의로 다른 진도표로 옮기지 않는다).
  if (used > 0) {
    const { error: detachError } = await supabaseAdmin
      .from("reading_groups")
      .update({ plan_id: null })
      .eq("plan_id", row.slug);
    if (detachError) return NextResponse.json({ error: detachError.message }, { status: 500 });
  }

  // 이 진도표로 남긴 회차 체크는 진도표가 없으면 뜻이 없다 — 함께 지운다.
  await supabaseAdmin.from("reading_unit_checks").delete().eq("plan_id", row.slug);

  const { error } = await supabaseAdmin.from("reading_plans").delete().eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateStandings();

  return NextResponse.json({
    ok: true,
    deleted: true,
    detachedGroups: used,
    message: used > 0 ? `${used}개 그룹의 진도표가 해제되었습니다.` : "지웠습니다.",
  });
}
