/**
 * 말씀의삶 — 회차 수동 체크 클라이언트 헬퍼.
 *
 * lib/reading-progress.ts 와 같은 관례: 실패 시 throw 하지 않고 빈 값/false 를 돌려준다.
 * 진도표는 비로그인에서도 열람되어야 하므로 화면이 오류로 무너지면 안 된다.
 */
import type { PlanUnit, ReadingPlan } from "@/lib/plans/engine";
import { planFromJson, type PlanSummary } from "@/lib/plans/registry";

export type { PlanSummary };

/**
 * 내가 종이로 읽었다고 표시한 회차 목록. 비로그인·실패 시 빈 배열.
 * **진도표마다 따로 쌓인다**(2026-09-20) — planId 를 빠뜨리면 다른 진도표의 체크를 읽는다.
 */
export async function fetchUnitChecks(planId: string): Promise<number[]> {
  try {
    const res = await fetch(`/api/reading-plan/checks?plan=${encodeURIComponent(planId)}`);
    if (!res.ok) return [];
    const { seqs } = await res.json();
    return Array.isArray(seqs) ? seqs : [];
  } catch {
    return [];
  }
}

/** 회차 체크/해제. 성공 여부만 돌려준다 */
export async function setUnitCheck(planId: string, seq: number, checked: boolean): Promise<boolean> {
  try {
    const res = checked
      ? await fetch("/api/reading-plan/checks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq, planId }),
        })
      : await fetch(`/api/reading-plan/checks?seq=${seq}&plan=${encodeURIComponent(planId)}`, {
          method: "DELETE",
        });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── 그룹 (단계 4) ────────────────────────────────────────────
// 위와 달리 **생성·참여·탈퇴는 오류 문구를 그대로 돌려준다.**
// 조회는 조용히 실패해도 화면이 서지만, 쓰기는 왜 안 됐는지 알려야 다시 시도할 수 있다.

export interface ReadingGroup {
  id: number;
  name: string;
  inviteCode: string;
  memberCount: number;
  isOwner: boolean;
  /** 이 그룹이 읽는 진도표. null 이면 **해제**(쓰던 진도표가 지워졌다 — 다시 골라야 한다) */
  planId?: string | null;
  planName?: string | null;
  /** 그 진도표의 회차 수 — 막대와 완주 판정에 쓴다(91 로 굳으면 숫자가 틀린다) */
  unitCount?: number;
}

export interface GroupStanding {
  userId: string;
  name: string;
  doneCount: number;
  readChapters: number;
  rank: number;
  isMe: boolean;
}

/** 내가 속한 그룹 목록. 비로그인·실패 시 빈 배열 */
export async function fetchMyGroups(): Promise<ReadingGroup[]> {
  try {
    const res = await fetch("/api/reading-groups");
    if (!res.ok) return [];
    const { groups } = await res.json();
    return Array.isArray(groups) ? groups : [];
  } catch {
    return [];
  }
}

type GroupResult = { group: ReadingGroup } | { error: string };

async function postGroup(url: string, body: unknown): Promise<GroupResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || "요청에 실패했습니다" };
    return { group: json.group as ReadingGroup };
  } catch {
    return { error: "연결에 실패했습니다" };
  }
}

export function createGroup(name: string, planId?: string): Promise<GroupResult> {
  return postGroup("/api/reading-groups", { name, planId });
}

/** 그룹이 읽는 진도표 바꾸기 — 그룹을 만든 사람만 */
export async function setGroupPlan(
  groupId: number,
  planId: string,
): Promise<
  { ok: true; planId: string; planName: string | null; unitCount: number } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`/api/reading-groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "바꾸지 못했습니다" };
    return {
      ok: true,
      planId: json.planId,
      planName: json.planName ?? null,
      unitCount: json.unitCount ?? 0,
    };
  } catch {
    return { ok: false, error: "연결에 실패했습니다" };
  }
}

export function joinGroup(code: string): Promise<GroupResult> {
  return postGroup("/api/reading-groups/join", { code });
}

/** 그룹 순위. 멤버가 아니면(403) null */
export async function fetchStandings(
  groupId: number,
): Promise<{ group: ReadingGroup; standings: GroupStanding[]; myRank: number | null } | null> {
  try {
    const res = await fetch(`/api/reading-groups/${groupId}/standings`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 그룹 나가기. 성공 시 그룹이 지워졌는지(마지막 멤버였는지) 함께 알려준다 */
export async function leaveGroup(
  groupId: number,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/reading-groups/${groupId}/leave`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "나가지 못했습니다" };
    return { ok: true, deleted: !!json.deleted };
  } catch {
    return { ok: false, error: "연결에 실패했습니다" };
  }
}

/**
 * 요약 스트립·완료 시트에 붙일 한 줄 — "첫 번째 그룹 N명 중 R번째".
 *
 * 그룹이 없으면 null. standings 는 서버에서 60초 캐시되므로 두 곳에서 불러도 부담이 없다.
 */
export async function fetchGroupSummary(): Promise<{
  name: string;
  memberCount: number;
  myRank: number;
} | null> {
  const groups = await fetchMyGroups();
  if (groups.length === 0) return null;
  const first = groups[0];
  const s = await fetchStandings(first.id);
  if (!s || s.myRank === null) return null;
  return { name: first.name, memberCount: s.standings.length, myRank: s.myRank };
}

// ─── 진도표 (2026-09-20 — 그룹마다 다른 진도표) ────────────────
// 조회는 조용히 실패하고(화면은 표준진도표로 선다), 쓰기는 오류 문구를 그대로 돌려준다.

export interface PlanListResponse {
  /** DB 표가 준비됐는가(마이그레이션 전이면 false — 표준진도표만 쓸 수 있다) */
  ready: boolean;
  /** 표준진도표 + 공개 진도표 + 내 그룹이 읽는 진도표 */
  plans: PlanSummary[];
  /** 내가 만든 것(비공개·숨긴 것 포함) */
  mine: PlanSummary[];
  groupPlanIds: string[];
}

export async function fetchPlans(): Promise<PlanListResponse> {
  try {
    const res = await fetch("/api/reading-plans");
    if (!res.ok) return { ready: false, plans: [], mine: [], groupPlanIds: [] };
    return (await res.json()) as PlanListResponse;
  } catch {
    return { ready: false, plans: [], mine: [], groupPlanIds: [] };
  }
}

export interface PlanDetail {
  plan: PlanSummary;
  units: PlanUnit[];
  mine: boolean;
  updatedAt: string | null;
}

export async function fetchPlanDetail(planId: string): Promise<PlanDetail | null> {
  try {
    const res = await fetch(`/api/reading-plans/${encodeURIComponent(planId)}`);
    if (!res.ok) return null;
    return (await res.json()) as PlanDetail;
  } catch {
    return null;
  }
}

/**
 * 화면이 쓰는 진도표 객체.
 * **같은 진도표는 같은 객체**여야 엔진의 파생 캐시(WeakMap)가 산다 — `planFromJson` 이 그것을 지킨다.
 * 표준진도표는 앱 안에 있어 서버를 부르지 않는다.
 */
export async function loadPlanForClient(planId: string): Promise<ReadingPlan | null> {
  const builtin = planFromJson({ planId });
  if (builtin) return builtin;
  const detail = await fetchPlanDetail(planId);
  if (!detail) return null;
  return planFromJson({
    planId: detail.plan.planId,
    name: detail.plan.name,
    units: detail.units,
    updatedAt: detail.updatedAt,
  });
}

type PlanWrite = { plan: PlanSummary; warnings?: string[] } | { error: string };

async function sendPlan(url: string, method: "POST" | "PATCH", body?: unknown): Promise<PlanWrite> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || "저장하지 못했습니다" };
    return { plan: json.plan as PlanSummary, warnings: json.warnings ?? [] };
  } catch {
    return { error: "연결에 실패했습니다" };
  }
}

export function createPlan(input: {
  name: string;
  description?: string;
  units: PlanUnit[];
  visibility: "public" | "private";
}): Promise<PlanWrite> {
  return sendPlan("/api/reading-plans", "POST", input);
}

export function updatePlan(
  planId: string,
  patch: { name?: string; description?: string; visibility?: "public" | "private"; units?: PlanUnit[] },
): Promise<PlanWrite> {
  return sendPlan(`/api/reading-plans/${encodeURIComponent(planId)}`, "PATCH", patch);
}

export function copyPlan(planId: string): Promise<PlanWrite> {
  return sendPlan(`/api/reading-plans/${encodeURIComponent(planId)}/copy`, "POST");
}

export async function deletePlan(
  planId: string,
  force = false,
): Promise<{ ok: true; message: string; hidden: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/reading-plans/${encodeURIComponent(planId)}${force ? "?force=1" : ""}`,
      { method: "DELETE" },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "지우지 못했습니다" };
    return { ok: true, message: json.message ?? "지웠습니다", hidden: !!json.hidden };
  } catch {
    return { ok: false, error: "연결에 실패했습니다" };
  }
}

export async function reportPlan(planId: string, reason: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/reading-plans/${encodeURIComponent(planId)}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface PlanDraft {
  name: string;
  units: PlanUnit[];
  note: string | null;
  warnings: string[];
  errors: string[];
}

/** AI 초안 — 저장은 사람이 한다. 여기서는 회차만 받아 온다. */
export async function draftPlanWithAi(prompt: string): Promise<PlanDraft | { error: string }> {
  try {
    const res = await fetch("/api/reading-plans/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || "초안을 만들지 못했습니다" };
    return {
      name: json.name ?? "",
      units: json.units ?? [],
      note: json.note ?? null,
      warnings: json.warnings ?? [],
      errors: json.errors ?? [],
    };
  } catch {
    return { error: "연결에 실패했습니다" };
  }
}
