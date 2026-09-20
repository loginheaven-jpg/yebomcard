/**
 * 말씀의삶 — 진도표 레지스트리 (파일 진도표 + DB 진도표를 한 창구로)
 *
 * 진도표는 두 곳에 산다.
 *  - **표준진도표**(`yebom91`)는 파일이다 — 재가받은 데이터라 git 이력과 검증 스크립트가 붙어 있어야 한다.
 *  - 교인이 만든 것은 DB(`reading_plans`)에 있다(지휘부 2026-09-20).
 * 화면과 서버는 이 파일의 함수만 부르고, 어디서 왔는지는 모른다.
 *
 * **객체 아이덴티티를 고정한다.** 엔진의 파생 캐시(`unitChapters` · `flattenPlan` · `boundaryChapters`)가
 * 전부 WeakMap(객체 키)이라, 같은 진도표를 부를 때마다 새 객체를 만들면 캐시가 통째로 죽어
 * 1,199개 장을 매 렌더 다시 만든다. 그래서 id 마다 **한 객체를 기억**한다.
 */
import { YEBOM91, YEBOM91_ID } from "./yebom91";
import type { ReadingPlan, PlanUnit } from "./engine";
import { sanitizeUnits } from "./builder";

export const DEFAULT_PLAN_ID = YEBOM91_ID;

/** 파일에 있는 진도표. 앞으로 교회 공식 진도표가 늘면 여기에 더한다. */
export const BUILTIN_PLANS: Record<string, ReadingPlan> = {
  [YEBOM91_ID]: YEBOM91,
};

export function isBuiltinPlan(planId: string | null | undefined): boolean {
  return !!planId && planId in BUILTIN_PLANS;
}

/** DB 진도표의 키 꼴 — 'p12'. 서버가 만든다(클라이언트가 정하지 않는다). */
export function dbPlanSlug(id: number): string {
  return `p${id}`;
}

export function isDbPlanSlug(planId: string | null | undefined): boolean {
  return !!planId && /^p\d+$/.test(planId);
}

export function dbPlanIdOf(planId: string): number | null {
  const m = /^p(\d+)$/.exec(planId);
  return m ? Number(m[1]) : null;
}

/** 진도표 한 줄의 겉모습(목록·고르기 창이 쓰는 것). units 는 들어 있지 않다. */
export interface PlanSummary {
  planId: string;
  name: string;
  description: string | null;
  unitCount: number;
  chapterCount: number;
  /** 파일 진도표(표준진도표)인가 — 고치거나 지울 수 없다 */
  builtin: boolean;
  visibility: "public" | "private";
  createdBy: string | null;
  createdByName: string | null;
  /** 범위를 고칠 수 없는가(다른 사람이 이 진도표로 회차를 체크했다) */
  locked: boolean;
  /** 목록에서 내려간 것(쓰는 그룹이 있어 지우지 못한 것) */
  hidden: boolean;
  usedByGroups: number;
  reportCount: number;
  updatedAt: string | null;
}

export function builtinSummary(planId: string): PlanSummary | null {
  const plan = BUILTIN_PLANS[planId];
  if (!plan) return null;
  const chapters = new Set<string>();
  for (const u of plan.units) {
    for (const r of u.ranges) for (let c = r.fromCh; c <= r.toCh; c++) chapters.add(`${r.book}:${c}`);
  }
  return {
    planId,
    name: plan.name,
    description: "예봄교회 성경읽기진도표 91회차 — 교회 공식 진도표입니다.",
    unitCount: plan.units.length,
    chapterCount: chapters.size,
    builtin: true,
    visibility: "public",
    createdBy: null,
    createdByName: "예봄교회",
    locked: true,
    hidden: false,
    usedByGroups: 0,
    reportCount: 0,
    updatedAt: null,
  };
}

// ───────────────────────── 객체 기억 ─────────────────────────

/**
 * id 마다 한 객체. 값은 `{ key, plan }` 인데, `key` 는 DB 의 `updated_at` 이다 —
 * 진도표를 고치면 key 가 달라져 새 객체를 만들고(캐시가 갱신되고), 그 밖에는 같은 객체를 돌려준다.
 */
const remembered = new Map<string, { key: string; plan: ReadingPlan }>();

export function rememberPlan(planId: string, name: string, units: PlanUnit[], key: string): ReadingPlan {
  const hit = remembered.get(planId);
  if (hit && hit.key === key) return hit.plan;
  const plan: ReadingPlan = { id: planId, name, units };
  remembered.set(planId, { key, plan });
  return plan;
}

/** 이미 기억한 진도표(없으면 null). 파일 진도표는 언제나 있다. */
export function cachedPlan(planId: string | null | undefined): ReadingPlan | null {
  if (!planId) return null;
  if (BUILTIN_PLANS[planId]) return BUILTIN_PLANS[planId];
  return remembered.get(planId)?.plan ?? null;
}

/** 서버가 내려준 진도표(JSON)를 엔진이 읽는 객체로. 믿을 수 없는 값도 안전하게 거른다. */
export function planFromJson(raw: {
  planId?: string;
  name?: string;
  units?: unknown;
  updatedAt?: string | null;
}): ReadingPlan | null {
  const planId = String(raw.planId ?? "");
  if (!planId) return null;
  if (BUILTIN_PLANS[planId]) return BUILTIN_PLANS[planId];
  const units = sanitizeUnits(raw.units);
  if (units.length === 0) return null;
  return rememberPlan(planId, String(raw.name ?? "진도표"), units, String(raw.updatedAt ?? ""));
}
