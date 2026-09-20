"use client";

/**
 * 말씀의삶 — 회차 완료 시트 (시안 C).
 *
 * 회차의 마지막 장을 3초 열람하면 자동 판정이 완료로 바뀌고 이 시트가 한 번 뜬다.
 * "한 번"은 세션 메모리가 아니라 localStorage 로 기억한다 — 새로고침하면 다시 뜨기 때문이다.
 */

import { useEffect, useState } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";
import { fetchGroupSummary } from "@/lib/reading-plan";

/**
 * 보여준 회차 기억. **진도표마다 따로 센다**(2026-09-20 — 그룹마다 다른 진도표) —
 * 진도표가 달라도 회차 번호는 1부터라, 한 배열에 담으면 새 진도표의 1회차 시트가 뜨지 않는다.
 * 옛 값(회차 번호 배열)은 표준진도표 것으로 보고 한 번 옮긴다.
 */
const LS_KEY = "yebom_plan_unit_sheet_shown";
const LEGACY_PLAN_ID = "yebom91";

function readShown(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { [LEGACY_PLAN_ID]: parsed as number[] };
    return (parsed ?? {}) as Record<string, number[]>;
  } catch {
    return {};
  }
}

/** 이미 보여준 회차인가 */
export function wasUnitSheetShown(planId: string, seq: number): boolean {
  return (readShown()[planId] ?? []).includes(seq);
}

export function markUnitSheetShown(planId: string, seq: number): void {
  try {
    const all = readShown();
    const list = all[planId] ?? [];
    if (!list.includes(seq)) {
      all[planId] = [...list, seq];
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    }
  } catch {
    /* 저장 못 해도 시트 자체는 떠야 한다 */
  }
}

interface Props {
  /** 어느 진도표의 회차인가 — 기억을 진도표별로 나눈다 */
  planId: string;
  seq: number;
  label: string;
  totalChapters: number;
  /** 이 진도표의 회차 수 — 완주 문구에 쓴다 */
  totalUnits: number;
  /** 다음 회차 — 마지막 회차면 null */
  next: { seq: number; label: string } | null;
  onOpenPlan: () => void;
  onReadNext: () => void;
  onClose: () => void;
}

export default function UnitCompleteSheet({
  planId,
  seq,
  label,
  totalChapters,
  totalUnits,
  next,
  onOpenPlan,
  onReadNext,
  onClose,
}: Props) {
  useHardwareBack(true, onClose);

  useEffect(() => {
    markUnitSheetShown(planId, seq);
  }, [planId, seq]);

  // 그룹에 속해 있으면 "N명 중 R번째" 한 줄 — 함께 읽는다는 느낌이 이 시트의 목적이다.
  // 없으면 아무것도 붙지 않는다. 순위 조회는 시트를 여는 것을 막지 않는다.
  const [groupLine, setGroupLine] = useState<{
    name: string;
    memberCount: number;
    myRank: number;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchGroupSummary().then((g) => {
      if (alive) setGroupLine(g);
    });
    return () => {
      alive = false;
    };
  }, [seq]);

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative w-full max-w-md bg-[var(--paper)] rounded-t-2xl p-5 pb-8 shadow-2xl">
        {/* 그립 — pointer capture 영역 안의 버튼은 onPointerDown 을 막아야 한다(IA 문서 §2) */}
        <div className="w-10 h-1 rounded-full bg-[var(--line)] mx-auto mb-4" aria-hidden />

        <p className="text-[13px] text-[var(--amber-deep)] font-semibold mb-1">
          {seq}회차를 마쳤습니다
        </p>
        <p className="text-lg font-bold text-[var(--ink)] mb-0.5">{label}</p>
        <p className="text-xs text-[var(--ink-faint)] mb-4">
          {totalChapters}장
          {groupLine && (
            <span className="ml-1.5">
              · {groupLine.name} {groupLine.memberCount}명 중{" "}
              <b className="text-[var(--amber-deep)] font-semibold">{groupLine.myRank}번째</b>
            </span>
          )}
        </p>

        {next ? (
          <div className="rounded-xl bg-[var(--amber-tint)] px-3.5 py-3 mb-4">
            <p className="text-[11px] text-[var(--amber-deep)] font-semibold mb-0.5">
              다음 {next.seq}회차
            </p>
            <p className="text-sm text-[var(--ink)]">{next.label}</p>
          </div>
        ) : (
          <div className="rounded-xl bg-[var(--amber-tint)] px-3.5 py-3 mb-4">
            {/* 회차 수는 진도표마다 다르다(2026-09-20) — 91 로 굳으면 다른 진도표에서 틀린 말이 된다 */}
            <p className="text-sm font-bold text-[var(--amber-deep)]">{totalUnits}회차 완주</p>
            <p className="text-[11px] text-[var(--ink-soft)] mt-0.5">
              진도표를 처음부터 끝까지 마치셨습니다.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpenPlan}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[var(--paper-2)] text-[var(--ink-soft)]"
          >
            진도표 보기
          </button>
          {next && (
            <button
              type="button"
              onClick={onReadNext}
              className="flex-1 py-3 rounded-xl text-sm font-bold bg-[var(--amber)] text-white"
            >
              다음 회차 첫 장 읽기
            </button>
          )}
        </div>

        <p className="text-[11px] text-[var(--ink-faint)] text-center mt-3">
          시트를 내리면 현재 장에 머뭅니다
        </p>
      </div>
    </div>
  );
}
