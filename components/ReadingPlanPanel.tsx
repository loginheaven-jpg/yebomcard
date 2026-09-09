"use client";

/**
 * 말씀의삶 — 성경읽기진도표 (하단 6번째 탭).
 *
 * 구성 (시안 A)
 *   1. 헤더    브랜드 + 세그먼트 [진도표 | 그룹]
 *   2. 요약    지금 읽을 회차 · 완료 수 · 진행바 · [종이 체크] 토글 (+ 그룹 순위 1줄)
 *   3. 리스트  91행. 상태별 표시 — 지금 / 완료 / 진행중 / 대기
 *   그룹 세그먼트는 ReadingGroupsView(시안 D)가 3번 자리를 대신 채운다.
 *
 * 데이터는 이 패널이 직접 가져온다. 통독 진도(readChapters)는 SearchPanel 지역 상태라
 * page.tsx 를 거쳐 내려올 경로가 없다. 회차 완료는 저장하지 않고 매번 파생 계산한다.
 *
 * 수동 체크 진입로는 둘이다 — 행을 길게 누르거나(500ms), [종이 체크] 를 켜서 체크박스를
 * 드러내거나. 길게 누름만 두면 고령 교인이 기능을 발견하지 못하고, 체크박스만 상시로 두면
 * 91행을 훑다가 잘못 눌린다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { fetchReadChapters, computeProgress } from "@/lib/reading-progress";
import { fetchUnitChecks, setUnitCheck, fetchGroupSummary } from "@/lib/reading-plan";
import ReadingGroupsView from "@/components/ReadingGroupsView";
import {
  YEBOM91,
  computeUnitProgress,
  type PlanProgress,
  type UnitProgress,
} from "@/lib/plans/yebom91";

interface Props {
  /** 행 탭 → 플랜 모드 진입. 단계 3 에서 연결한다 */
  onOpenUnit?: (seq: number) => void;
  /** 로그인 유도 (비로그인 상태에서 체크를 시도했을 때) */
  onLogin?: () => void;
}

const LONG_PRESS_MS = 500;
const TOTAL = YEBOM91.units.length;

/** 행이 어떻게 보일지 — now 는 status 가 아니라 currentSeq 파생값이라 따로 판단한다 */
type RowState = "now" | "done" | "partial" | "todo";

function rowState(u: UnitProgress, currentSeq: number): RowState {
  if (u.status !== "done" && u.seq === currentSeq) return "now";
  return u.status;
}

export default function ReadingPlanPanel({ onOpenUnit, onLogin }: Props) {
  const { session, loading: sessionLoading } = useSession();
  const isLoggedIn = !!session?.isLoggedIn;

  const [readByBook, setReadByBook] = useState<Record<string, Set<number>>>({});
  const [manualSeqs, setManualSeqs] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [checkMode, setCheckMode] = useState(false);
  const [busySeq, setBusySeq] = useState<number | null>(null);
  const [tab, setTab] = useState<"plan" | "group">("plan");
  const [groupLine, setGroupLine] = useState<{
    name: string;
    memberCount: number;
    myRank: number;
  } | null>(null);
  const [groupNonce, setGroupNonce] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const nowRowRef = useRef<HTMLLIElement | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);
  const scrolledRef = useRef(false);

  // ── 데이터 ──
  useEffect(() => {
    let alive = true;
    (async () => {
      const [read, seqs] = await Promise.all([fetchReadChapters(), fetchUnitChecks()]);
      if (!alive) return;
      setReadByBook(computeProgress(read).readByBook);
      setManualSeqs(new Set(seqs));
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 요약 스트립의 그룹 1줄. 그룹이 없으면 아무것도 붙지 않는다.
  // 그룹 탭에서 참여·탈퇴하면 groupNonce 가 올라 다시 계산한다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const g = await (isLoggedIn ? fetchGroupSummary() : Promise.resolve(null));
      if (alive) setGroupLine(g);
    })();
    return () => {
      alive = false;
    };
  }, [isLoggedIn, groupNonce]);

  const progress: PlanProgress = useMemo(
    () => computeUnitProgress(YEBOM91, readByBook, manualSeqs),
    [readByBook, manualSeqs],
  );

  // ── 마운트 시 '지금' 행을 화면 상단 1/3 에 ──
  // 행 높이가 가변(부제 유무)이라 인덱스 × 고정높이로 계산하면 어긋난다. offsetTop 을 쓴다.
  // 그룹 탭에 있는 동안 리스트는 display:none 이라 offsetTop 이 0 이다 —
  // 그때 계산하면 맨 위로 스크롤한 셈이 되므로 진도표를 보고 있을 때만 맞춘다.
  useEffect(() => {
    if (!loaded || scrolledRef.current || tab !== "plan") return;
    const list = listRef.current;
    const row = nowRowRef.current;
    if (!list || !row) return;
    scrolledRef.current = true;
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 3);
  }, [loaded, tab]);

  // ── 수동 체크 ──
  const toggleCheck = useCallback(
    async (seq: number) => {
      if (!isLoggedIn) {
        onLogin?.();
        return;
      }
      const next = !manualSeqs.has(seq);
      setBusySeq(seq);
      // 낙관적 갱신 — 실패하면 되돌린다
      setManualSeqs((prev) => {
        const s = new Set(prev);
        if (next) s.add(seq);
        else s.delete(seq);
        return s;
      });
      const ok = await setUnitCheck(seq, next);
      if (!ok) {
        setManualSeqs((prev) => {
          const s = new Set(prev);
          if (next) s.delete(seq);
          else s.add(seq);
          return s;
        });
      }
      setBusySeq(null);
    },
    [isLoggedIn, manualSeqs, onLogin],
  );

  const startLongPress = useCallback(
    (seq: number) => {
      longPressedRef.current = false;
      longPressRef.current = setTimeout(() => {
        longPressedRef.current = true;
        void toggleCheck(seq);
      }, LONG_PRESS_MS);
    },
    [toggleCheck],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const handleRowClick = useCallback(
    (seq: number) => {
      // 길게 누름이 이미 처리했으면 탭으로 세지 않는다
      if (longPressedRef.current) {
        longPressedRef.current = false;
        return;
      }
      onOpenUnit?.(seq);
    },
    [onOpenUnit],
  );

  const pct = TOTAL > 0 ? (progress.doneCount / TOTAL) * 100 : 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--paper)]">
      {/* ── 1. 헤더 ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2.5 shrink-0">
        <div className="flex flex-col leading-none">
          <span className="text-[8px] tracking-[5px] pl-[5px] text-[var(--ink-faint)]">YEBOM</span>
          <span className="font-playfair italic text-[19px] mt-1 text-[var(--ink)]">말씀의삶</span>
        </div>
        <div
          role="tablist"
          aria-label="진도표 / 그룹"
          className="flex bg-[var(--paper-2)] rounded-lg p-[3px] gap-[2px]"
        >
          {(["plan", "group"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`text-xs font-semibold px-3 py-[5px] rounded-md ${
                tab === t
                  ? "bg-[var(--paper)] text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "text-[var(--ink-faint)]"
              }`}
            >
              {t === "plan" ? "진도표" : "그룹"}
            </button>
          ))}
        </div>
      </div>

      {/* ── 2. 요약 스트립 — 그룹 탭에서는 카드가 같은 정보를 담으므로 감춘다 ── */}
      {tab === "group" ? null : isLoggedIn ? (
        <div className="mx-4 mb-2.5 px-3.5 py-3 bg-[var(--amber-tint)] rounded-xl flex items-center gap-3.5 shrink-0">
          <div className="leading-none shrink-0">
            <div className="text-[10px] font-semibold text-[var(--amber-deep)] opacity-80 mb-1">
              지금 읽을 회차
            </div>
            <div className="text-[26px] font-bold text-[var(--amber-deep)] tracking-[-0.5px] leading-none">
              {progress.currentSeq}
              <span className="text-xs font-semibold ml-0.5">회차</span>
            </div>
          </div>
          <div className="flex-1 text-xs text-[var(--ink-soft)] leading-normal min-w-0">
            나 <b className="text-[var(--ink)] font-semibold">{progress.doneCount} / {TOTAL}</b> 완료
            {groupLine && (
              <div className="text-[11px] text-[var(--ink-faint)] truncate">
                {groupLine.name} {groupLine.memberCount}명 중{" "}
                <b className="text-[var(--amber-deep)] font-semibold">{groupLine.myRank}번째</b>
              </div>
            )}
            <div
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="진도표 완료율"
              className="h-1.5 bg-[var(--line)] rounded-full overflow-hidden mt-1.5"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--amber)] to-[var(--amber-bright)]"
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCheckMode((v) => !v)}
            aria-pressed={checkMode}
            className={`shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
              checkMode
                ? "bg-[var(--amber)] text-white border-transparent"
                : "bg-[var(--paper)] text-[var(--ink-soft)] border-[var(--line)]"
            }`}
          >
            종이 체크
          </button>
        </div>
      ) : (
        <div className="mx-4 mb-2.5 px-3.5 py-3 bg-[var(--paper-2)] rounded-xl shrink-0">
          <p className="text-xs text-[var(--ink-soft)] leading-relaxed">
            로그인하면 진도가 기록되고 어디까지 읽었는지 표시됩니다.{" "}
            <button
              type="button"
              onClick={onLogin}
              className="font-semibold text-[var(--amber-deep)] underline underline-offset-2"
            >
              로그인
            </button>
          </p>
        </div>
      )}

      {/* ── 3. 그룹 (시안 D) ── */}
      {tab === "group" && (
        <ReadingGroupsView
          isLoggedIn={isLoggedIn}
          onLogin={onLogin}
          onGroupsChanged={() => setGroupNonce((n) => n + 1)}
        />
      )}

      {/* ── 3. 91행 리스트 ── */}
      <div
        ref={listRef}
        hidden={tab !== "plan"}
        className="flex-1 overflow-y-auto px-3 pb-24 overscroll-contain"
      >
        {!loaded && !sessionLoading ? (
          <p className="text-sm text-[var(--ink-faint)] py-6 text-center">불러오는 중…</p>
        ) : null}
        <ul>
          {progress.units.map((u) => {
            const unit = YEBOM91.units[u.seq - 1];
            // 비로그인은 진행 표시를 하지 않는다(지시서 §1). 진도가 없으니 모든 회차가
            // currentSeq=1 로 계산되는데, 그대로 두면 아무 근거 없이 "지금 1회차" 가 뜬다.
            const st: RowState = isLoggedIn ? rowState(u, progress.currentSeq) : "todo";
            const isNow = st === "now";
            const isDone = st === "done";
            const checked = manualSeqs.has(u.seq);

            // 부제 — 상태마다 다른 것을 보여준다
            let sub: string | null = null;
            if (u.manual) sub = "종이로 읽음";
            else if (isNow) {
              const n = progress.nextChapter;
              sub = `${u.readCount} / ${u.total}장`;
              if (n) sub += ` · 다음 읽을 장 ${n.chapter}장`;
            } else if (st === "partial") sub = `${u.readCount} / ${u.total}장`;

            return (
              <li
                key={u.seq}
                ref={isNow ? nowRowRef : undefined}
                className={`grid items-center gap-2 px-1.5 py-2.5 min-h-[48px] ${
                  isNow
                    ? "bg-[var(--amber-tint)] rounded-[10px] my-0.5 border-b border-transparent"
                    : "border-b border-[var(--line-soft)]"
                }`}
                style={{ gridTemplateColumns: "34px 1fr 28px" }}
              >
                <button
                  type="button"
                  onClick={() => handleRowClick(u.seq)}
                  onPointerDown={() => startLongPress(u.seq)}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`text-[13px] font-semibold text-center select-none ${
                    isDone
                      ? "text-[var(--amber)]"
                      : isNow
                        ? "text-[var(--amber-deep)]"
                        : "text-[var(--ink-faint)]"
                  }`}
                  aria-label={`${u.seq}회차`}
                >
                  {u.seq}
                </button>

                <button
                  type="button"
                  onClick={() => handleRowClick(u.seq)}
                  onPointerDown={() => startLongPress(u.seq)}
                  onPointerUp={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  className="text-left min-w-0 select-none"
                >
                  <span
                    className={`block text-sm leading-snug tracking-[-0.2px] ${
                      isNow ? "font-semibold text-[var(--ink)]" : ""
                    } ${isDone ? "text-[var(--ink-soft)]" : "text-[var(--ink)]"}`}
                  >
                    {unit.label}
                    {isNow && (
                      <span className="ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--amber)] text-white">
                        지금
                      </span>
                    )}
                  </span>
                  {sub && (
                    <span className="block text-[11px] text-[var(--ink-faint)] mt-0.5">{sub}</span>
                  )}
                </button>

                <div className="flex items-center justify-center">
                  {!isLoggedIn ? null : checkMode ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busySeq === u.seq}
                      onChange={() => toggleCheck(u.seq)}
                      aria-label={`${u.seq}회차 종이로 읽음`}
                      className="w-5 h-5 accent-[var(--amber)] cursor-pointer"
                    />
                  ) : (
                    <StatusMark state={st} readCount={u.readCount} total={u.total} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** 행 오른쪽 표시 — 완료는 채운 체크, 진행중은 부분 채움 원, 나머지는 빈 원 */
function StatusMark({
  state,
  readCount,
  total,
}: {
  state: RowState;
  readCount: number;
  total: number;
}) {
  if (state === "done") {
    return (
      <span className="w-5 h-5 rounded-md bg-[var(--amber)] border border-[var(--amber)] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (state === "now" || state === "partial") {
    const p = total > 0 ? Math.round((readCount / total) * 100) : 0;
    // 안쪽 채움색은 행 배경과 같아야 도넛으로 보인다 — now 는 amber-tint, partial 은 paper
    const inner = state === "now" ? "var(--amber-tint)" : "var(--paper)";
    return (
      <span
        className="w-5 h-5 rounded-md border border-[var(--amber)] relative"
        style={{ background: `conic-gradient(var(--amber) 0 ${p}%, transparent ${p}% 100%)` }}
        aria-hidden
      >
        <span className="absolute inset-[3px] rounded-sm" style={{ background: inner }} />
      </span>
    );
  }
  return <span className="w-5 h-5 rounded-md border border-[var(--line)]" aria-hidden />;
}
