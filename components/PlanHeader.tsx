"use client";

/**
 * 말씀의삶 — 본문 위 플랜 헤더 (시안 B).
 *
 * 회차·진행·구간 칩을 보여주고, 탭하면 진도표로 돌아간다.
 * 플랜을 벗어난 상태(목차·검색·책갈피로 점프)면 돌아가기 안내로 바뀐다.
 */

import type { PlanUnit, PlanRange } from "@/lib/plans/yebom91";

interface Props {
  unit: PlanUnit;
  /** 이 회차에서 읽은 장 수 / 전체 */
  readCount: number;
  total: number;
  /** 현재 보고 있는 위치 — 구간 칩에서 '현재' 표시에 쓴다 */
  current: { book: string; chapter: number } | null;
  /** 플랜 밖으로 나갔는가 */
  offPlan: boolean;
  /** 책 코드 → 한글 이름 */
  bookName: (code: string) => string;
  onOpenPlan: () => void;
  onReturnToPlan: () => void;
  /** 비로그인이면 진도가 기록되지 않는다는 안내를 붙인다 */
  isLoggedIn: boolean;
}

/** 절 경계를 칩 문구에 반드시 노출한다 — 장 단위 판정이 놓치는 구간을 사람이 알아보게 */
function rangeLabel(r: PlanRange, bookName: (c: string) => string): string {
  const b = bookName(r.book);
  const span = r.fromCh === r.toCh ? `${r.fromCh}` : `${r.fromCh}-${r.toCh}`;
  let s = `${b} ${span}`;
  if (r.fromVs) s += ` · ${r.fromCh}:${r.fromVs}부터`;
  if (r.toVs) s += ` · ${r.toCh}:${r.toVs}까지`;
  return s;
}

export default function PlanHeader({
  unit,
  readCount,
  total,
  current,
  offPlan,
  bookName,
  onOpenPlan,
  onReturnToPlan,
  isLoggedIn,
}: Props) {
  if (offPlan) {
    return (
      <button
        type="button"
        onClick={onReturnToPlan}
        className="w-full mb-3 px-3.5 py-2.5 rounded-xl bg-[var(--paper-2)] border border-[var(--line)] flex items-center justify-between text-left"
      >
        <span className="text-xs text-[var(--ink-soft)]">
          플랜에서 벗어남 · <b className="text-[var(--ink)]">{unit.seq}회차로 돌아가기</b>
        </span>
        <span className="text-[var(--ink-faint)]">›</span>
      </button>
    );
  }

  const pct = total > 0 ? (readCount / total) * 100 : 0;

  return (
    <div className="mb-3 px-3.5 py-3 rounded-xl bg-[var(--amber-tint)]">
      <button
        type="button"
        onClick={onOpenPlan}
        className="w-full flex items-center justify-between text-left mb-2"
      >
        <span className="text-sm font-bold text-[var(--amber-deep)]">
          {unit.seq}회차
          <span className="ml-2 text-xs font-medium text-[var(--ink-soft)]">
            {readCount} / {total}장
          </span>
        </span>
        <span className="text-[11px] text-[var(--ink-soft)]">진도표로 ›</span>
      </button>

      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${unit.seq}회차 진행률`}
        className="h-1.5 bg-[var(--line)] rounded-full overflow-hidden mb-2"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--amber)] to-[var(--amber-bright)]"
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {unit.ranges.map((r, i) => {
          const isCurrent =
            !!current &&
            current.book === r.book &&
            current.chapter >= r.fromCh &&
            current.chapter <= r.toCh;
          return (
            <span
              key={i}
              className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                isCurrent
                  ? "bg-[var(--amber)] text-white font-semibold"
                  : "bg-[var(--paper)] text-[var(--ink-soft)]"
              }`}
            >
              {rangeLabel(r, bookName)}
            </span>
          );
        })}
      </div>

      {!isLoggedIn && (
        <p className="text-[11px] text-[var(--ink-soft)] mt-2">
          로그인하지 않아 <b>기록되지 않습니다</b>
        </p>
      )}
    </div>
  );
}
