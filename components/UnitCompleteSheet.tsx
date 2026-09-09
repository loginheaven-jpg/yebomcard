"use client";

/**
 * 말씀의삶 — 회차 완료 시트 (시안 C).
 *
 * 회차의 마지막 장을 3초 열람하면 자동 판정이 완료로 바뀌고 이 시트가 한 번 뜬다.
 * "한 번"은 세션 메모리가 아니라 localStorage 로 기억한다 — 새로고침하면 다시 뜨기 때문이다.
 */

import { useEffect } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";

const LS_KEY = "yebom_plan_unit_sheet_shown";

/** 이미 보여준 회차인가 */
export function wasUnitSheetShown(seq: number): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as number[]).includes(seq) : false;
  } catch {
    return false;
  }
}

export function markUnitSheetShown(seq: number): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list: number[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(seq)) {
      list.push(seq);
      localStorage.setItem(LS_KEY, JSON.stringify(list));
    }
  } catch {
    /* 저장 못 해도 시트 자체는 떠야 한다 */
  }
}

interface Props {
  seq: number;
  label: string;
  totalChapters: number;
  /** 다음 회차 — 마지막 회차면 null */
  next: { seq: number; label: string } | null;
  onOpenPlan: () => void;
  onReadNext: () => void;
  onClose: () => void;
}

export default function UnitCompleteSheet({
  seq,
  label,
  totalChapters,
  next,
  onOpenPlan,
  onReadNext,
  onClose,
}: Props) {
  useHardwareBack(true, onClose);

  useEffect(() => {
    markUnitSheetShown(seq);
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
        <p className="text-xs text-[var(--ink-faint)] mb-4">{totalChapters}장</p>

        {next ? (
          <div className="rounded-xl bg-[var(--amber-tint)] px-3.5 py-3 mb-4">
            <p className="text-[11px] text-[var(--amber-deep)] font-semibold mb-0.5">
              다음 {next.seq}회차
            </p>
            <p className="text-sm text-[var(--ink)]">{next.label}</p>
          </div>
        ) : (
          <div className="rounded-xl bg-[var(--amber-tint)] px-3.5 py-3 mb-4">
            <p className="text-sm font-bold text-[var(--amber-deep)]">91회차 완주</p>
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
