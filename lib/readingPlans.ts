/**
 * 말씀의삶 — 진도표(DB) 서버 공용 로직.
 *
 * `reading_plans` 는 RLS 를 켜고 정책을 두지 않았다(service_role 전용) — 그룹 표와 같은 규칙이다.
 * anon 클라이언트로 접근하면 오류 없이 빈 배열이 돌아오므로 **반드시 supabaseAdmin 을 쓴다.**
 *
 * 표가 아직 없을 수 있다(마이그레이션 전). 그때는 **표준진도표만 있는 것처럼** 동작한다 —
 * 말씀의삶 자체가 멈추면 안 된다(§B-11 의 목록과 같은 원칙).
 */
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ReadingPlan } from "@/lib/plans/engine";
import { sanitizeUnits, planStats } from "@/lib/plans/builder";
import {
  BUILTIN_PLANS,
  DEFAULT_PLAN_ID,
  builtinSummary,
  dbPlanIdOf,
  dbPlanSlug,
  isBuiltinPlan,
  rememberPlan,
  type PlanSummary,
} from "@/lib/plans/registry";

export { DEFAULT_PLAN_ID };

/** 표가 아직 없을 때의 코드 — Postgres(42P01) · PostgREST 스키마 캐시(PGRST205) */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export interface PlanRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  units: unknown;
  unit_count: number;
  chapter_count: number;
  visibility: string;
  created_by: string;
  created_by_name: string | null;
  copied_from: number | null;
  locked_at: string | null;
  hidden_at: string | null;
  report_count: number;
  report_reason: string | null;
  created_at: string;
  updated_at: string;
}

const ROW_COLUMNS =
  "id, slug, name, description, units, unit_count, chapter_count, visibility, created_by, " +
  "created_by_name, copied_from, locked_at, hidden_at, report_count, report_reason, created_at, updated_at";

/** 목록에 쓰는 가벼운 열 — units 를 빼면 한 줄이 200바이트가 안 된다 */
const LIST_COLUMNS =
  "id, slug, name, description, unit_count, chapter_count, visibility, created_by, " +
  "created_by_name, locked_at, hidden_at, report_count, updated_at";

export async function loadPlanRow(planId: string): Promise<PlanRow | null> {
  const id = dbPlanIdOf(planId);
  if (id === null) return null;
  const { data, error } = await supabaseAdmin
    .from("reading_plans")
    .select(ROW_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  // supabase-js 는 긴 select 문자열의 반환 타입을 추론하지 못해 오류 유니온을 준다 — 한 번 거쳐 캐스팅한다.
  return data as unknown as PlanRow;
}

/**
 * 진도표 하나. 파일 진도표면 그 객체를, DB 진도표면 기억해 둔 객체를 돌려준다.
 * **같은 진도표는 같은 객체여야 한다**(엔진의 WeakMap 캐시) — `rememberPlan` 이 그것을 지킨다.
 */
export async function loadPlan(planId: string | null | undefined): Promise<ReadingPlan | null> {
  if (!planId) return null;
  if (BUILTIN_PLANS[planId]) return BUILTIN_PLANS[planId];
  const row = await loadPlanRow(planId);
  if (!row) return null;
  const units = sanitizeUnits(row.units);
  if (units.length === 0) return null;
  return rememberPlan(row.slug, row.name, units, row.updated_at);
}

/** 그룹이 읽는 진도표. 그룹이 해제 상태(plan_id null)면 null 이다 — 임의로 표준진도표로 바꾸지 않는다. */
export async function loadGroupPlan(planId: string | null): Promise<ReadingPlan | null> {
  return loadPlan(planId);
}

export function summaryFromRow(row: Partial<PlanRow>, usedByGroups = 0): PlanSummary {
  return {
    planId: row.slug ?? dbPlanSlug(Number(row.id)),
    name: row.name ?? "진도표",
    description: row.description ?? null,
    unitCount: row.unit_count ?? 0,
    chapterCount: row.chapter_count ?? 0,
    builtin: false,
    visibility: row.visibility === "private" ? "private" : "public",
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    locked: !!row.locked_at,
    hidden: !!row.hidden_at,
    usedByGroups,
    reportCount: row.report_count ?? 0,
    updatedAt: row.updated_at ?? null,
  };
}

/** 어느 진도표를 몇 그룹이 쓰는가. 지울 수 있는지 판단하고 목록에도 보인다. */
export async function groupUseCounts(planIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (planIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("reading_groups")
    .select("plan_id")
    .in("plan_id", planIds);
  if (error || !data) return out;
  for (const row of data as { plan_id: string | null }[]) {
    if (!row.plan_id) continue;
    out.set(row.plan_id, (out.get(row.plan_id) ?? 0) + 1);
  }
  return out;
}

/**
 * 범위를 잠글 때가 되었는가 — **만든 사람이 아닌 누군가가** 이 진도표로 회차를 체크했으면 잠근다.
 * 혼자 만들며 시험하는 동안은 계속 고칠 수 있고, 남이 읽기 시작하면 그때부터 복사해서 고친다.
 */
export async function lockIfOthersRead(row: PlanRow): Promise<boolean> {
  if (row.locked_at) return true;
  const { data, error } = await supabaseAdmin
    .from("reading_unit_checks")
    .select("user_id")
    .eq("plan_id", row.slug)
    .neq("user_id", row.created_by)
    .limit(1);
  if (error || !data || data.length === 0) return false;
  await supabaseAdmin
    .from("reading_plans")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("locked_at", null);
  return true;
}

export interface PlanListResult {
  ready: boolean;
  mine: PlanSummary[];
  others: PlanSummary[];
}

/**
 * 고르기 창에 쓸 목록.
 *  - `mine` — 내가 만든 것(숨긴 것도 보인다. 내 것이니까)
 *  - `others` — 공개된 남의 진도표(숨긴 것은 빠진다) + 내 그룹이 쓰는 진도표(공개가 아니어도 보인다)
 */
export async function listPlans(userId: string | null, groupPlanIds: string[] = []): Promise<PlanListResult> {
  const { data, error } = await supabaseAdmin
    .from("reading_plans")
    .select(LIST_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) {
    if (isMissingTable(error)) return { ready: false, mine: [], others: [] };
    return { ready: true, mine: [], others: [] };
  }
  const rows = (data ?? []) as Partial<PlanRow>[];
  const counts = await groupUseCounts(rows.map((r) => r.slug!).filter(Boolean));
  const mine: PlanSummary[] = [];
  const others: PlanSummary[] = [];
  for (const row of rows) {
    const s = summaryFromRow(row, counts.get(row.slug ?? "") ?? 0);
    if (userId && row.created_by === userId) mine.push(s);
    else if (!s.hidden && (s.visibility === "public" || groupPlanIds.includes(s.planId))) others.push(s);
  }
  return { ready: true, mine, others };
}

/**
 * 그룹이 고를 수 있는 진도표인가 — 고를 수 있으면 그 키를, 아니면 null.
 *
 * 없는 진도표를 그룹에 붙이면 **오류 없이 순위만 0 이 된다.** 그래서 붙이기 전에 반드시 확인한다.
 * 목록에서 내려간 것(`hidden_at`)은 새로 고를 수 없다 — 쓰던 그룹만 계속 읽는다.
 */
export async function usablePlanId(planId: string, userId: string): Promise<string | null> {
  if (isBuiltinPlan(planId)) return planId;
  const row = await loadPlanRow(planId);
  if (!row) return null;
  const mine = row.created_by === userId;
  if (!mine && (row.visibility === "private" || row.hidden_at)) return null;
  return row.slug;
}

export interface PlanLabel {
  planId: string;
  name: string;
  unitCount: number;
  builtin: boolean;
}

/**
 * 그룹 목록·참여 화면이 쓰는 이름표. 회차 수까지 함께 준다 —
 * 그룹 카드의 막대와 완주 판정이 **그 그룹 진도표의 회차 수**를 알아야 한다(91 로 굳으면 숫자가 틀린다).
 */
export async function planLabels(planIds: (string | null)[]): Promise<Map<string, PlanLabel>> {
  const out = new Map<string, PlanLabel>();
  const wanted = [...new Set(planIds.filter((v): v is string => !!v))];
  const fromDb: number[] = [];
  for (const planId of wanted) {
    const builtin = BUILTIN_PLANS[planId];
    if (builtin) {
      out.set(planId, { planId, name: builtin.name, unitCount: builtin.units.length, builtin: true });
      continue;
    }
    const id = dbPlanIdOf(planId);
    if (id !== null) fromDb.push(id);
  }
  if (fromDb.length > 0) {
    const { data } = await supabaseAdmin
      .from("reading_plans")
      .select("id, slug, name, unit_count")
      .in("id", fromDb);
    for (const row of (data ?? []) as { slug: string; name: string; unit_count: number }[]) {
      out.set(row.slug, { planId: row.slug, name: row.name, unitCount: row.unit_count, builtin: false });
    }
  }
  return out;
}

/** 표준진도표를 목록 맨 앞에 둔다. */
export function withBuiltins(list: PlanSummary[]): PlanSummary[] {
  const builtins = Object.keys(BUILTIN_PLANS)
    .map((id) => builtinSummary(id))
    .filter((s): s is PlanSummary => !!s);
  return [...builtins, ...list];
}

/** 저장 전에 요약값을 다시 센다 — 클라이언트가 보낸 숫자를 믿지 않는다. */
export function statsOf(units: ReturnType<typeof sanitizeUnits>) {
  const s = planStats(units);
  return { unit_count: s.unitCount, chapter_count: s.chapterCount };
}

export { isBuiltinPlan };
