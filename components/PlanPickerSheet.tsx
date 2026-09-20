"use client";

/**
 * 말씀의삶 — 진도표 고르기 창 (지휘부 2026-09-20)
 *
 * 진도표는 **틀(템플릿)이라 서로 보인다.** 여기 보이는 것은 이름 · 만든 이 · 회차 수뿐이고,
 * 누가 어디까지 읽었는지는 그룹 안에서만 보인다.
 *
 *  - 내 진도표 — 고치기 · 지우기 · 나만 쓰기 표시
 *  - 다른 진도표 — 고르기 · **복사해서 내 것으로** · 신고
 *  - 운영자 · 수퍼어드민은 아무 진도표나 지울 수 있다(부적절한 것). 쓰는 그룹이 있으면 목록에서만 내려가고,
 *    수퍼어드민이 끝내 지우면 그 그룹의 진도표는 **해제**된다.
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { isAdmin, isSuperAdmin } from "@/lib/admin";
import {
  copyPlan,
  deletePlan,
  fetchPlans,
  reportPlan,
  type PlanSummary,
} from "@/lib/reading-plan";

interface Props {
  /** 지금 읽는 진도표 */
  currentPlanId: string;
  onPick: (plan: PlanSummary) => void;
  onClose: () => void;
  /** 새로 만들기 · 고치기 — 부모가 만들기 창을 연다 */
  onCreate: () => void;
  onEdit: (planId: string) => void;
  onLogin?: () => void;
  /** 저장·복사·삭제 뒤 부모가 목록을 다시 읽게 한다 */
  onChanged?: () => void;
}

export default function PlanPickerSheet({
  currentPlanId,
  onPick,
  onClose,
  onCreate,
  onEdit,
  onLogin,
  onChanged,
}: Props) {
  const { session } = useSession();
  const loggedIn = !!session?.isLoggedIn;
  const admin = isAdmin(session);
  const superAdmin = isSuperAdmin(session);

  const [ready, setReady] = useState(true);
  const [mine, setMine] = useState<PlanSummary[]>([]);
  const [others, setOthers] = useState<PlanSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 조회는 전부 effect 안에서 한다. effect 밖의 함수를 effect 가 부르면 렌더가 연쇄한다
  // (react-hooks/set-state-in-effect — 그룹 화면과 같은 방식). 다시 읽기는 이 값으로만.
  const [reloadNonce, setReloadNonce] = useState(0);
  const load = useCallback(async () => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetchPlans();
      if (!alive) return;
      setReady(res.ready);
      setMine(res.mine);
      setOthers(res.plans);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [reloadNonce]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const doCopy = useCallback(
    async (plan: PlanSummary) => {
      if (!loggedIn) {
        onLogin?.();
        return;
      }
      setBusy(true);
      const res = await copyPlan(plan.planId);
      setBusy(false);
      if ("error" in res) {
        flash(res.error);
        return;
      }
      await load();
      onChanged?.();
      flash("내 진도표로 복사했습니다. 이제 고칠 수 있습니다.");
    },
    [loggedIn, onLogin, load, onChanged, flash],
  );

  const doDelete = useCallback(
    async (plan: PlanSummary) => {
      const used = plan.usedByGroups;
      const first =
        used > 0
          ? `'${plan.name}' 은(는) ${used}개 그룹이 읽고 있습니다.\n목록에서만 내릴까요? (그 그룹은 계속 읽습니다)`
          : `'${plan.name}' 을(를) 지울까요? 되돌릴 수 없습니다.`;
      if (!window.confirm(first)) return;

      setBusy(true);
      let res = await deletePlan(plan.planId, false);
      // 쓰는 그룹이 있는데 수퍼어드민이 '완전히' 지우려는 경우만 한 번 더 묻는다.
      if (res.ok && res.hidden && superAdmin) {
        const force = window.confirm(
          `목록에서 내렸습니다.\n\n부적절한 진도표라 완전히 지우시겠습니까?\n읽고 있던 ${used}개 그룹의 진도표가 **해제**되고, 그 그룹은 다시 골라야 합니다.`,
        );
        if (force) res = await deletePlan(plan.planId, true);
      }
      setBusy(false);
      if (!res.ok) {
        flash(res.error);
        return;
      }
      await load();
      onChanged?.();
      flash(res.message);
    },
    [superAdmin, load, onChanged, flash],
  );

  const doReport = useCallback(
    async (plan: PlanSummary) => {
      if (!loggedIn) {
        onLogin?.();
        return;
      }
      const reason = window.prompt(`'${plan.name}' 을(를) 관리자에게 알립니다. 무엇이 문제인가요?`);
      if (reason === null) return;
      const ok = await reportPlan(plan.planId, reason);
      flash(ok ? "알려 주셔서 고맙습니다. 관리자가 확인합니다." : "신고를 보내지 못했습니다");
    },
    [loggedIn, onLogin, flash],
  );

  const row = (plan: PlanSummary, isMine: boolean) => {
    const current = plan.planId === currentPlanId;
    return (
      <div
        key={plan.planId}
        className={`rounded-xl border px-3 py-2.5 ${
          current
            ? "border-[var(--amber)] bg-[var(--amber-tint)]"
            : "border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-800"
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <b className="text-[13.5px] font-semibold text-[var(--ink)] dark:text-gray-100">{plan.name}</b>
              {plan.builtin && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--ink-faint)]">
                  교회 공식
                </span>
              )}
              {current && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--amber)] text-white">
                  읽는 중
                </span>
              )}
              {plan.visibility === "private" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[var(--ink-faint)]">
                  나만 쓰기
                </span>
              )}
              {plan.hidden && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[var(--ink-faint)]">
                  목록에서 내림
                </span>
              )}
              {plan.reportCount > 0 && (admin || isMine) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 font-semibold">
                  신고 {plan.reportCount}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] text-[var(--ink-soft)] dark:text-gray-400 tabular-nums">
              {plan.unitCount}회차 · {plan.chapterCount}장
              {plan.createdByName ? ` · ${plan.createdByName}` : ""}
              {plan.usedByGroups > 0 ? ` · ${plan.usedByGroups}개 그룹` : ""}
            </p>
            {plan.description && (
              <p className="mt-0.5 text-[11.5px] text-[var(--ink-faint)] line-clamp-2">{plan.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onPick(plan)}
            disabled={current}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--amber)] text-white disabled:opacity-40"
          >
            {current ? "읽는 중" : "이걸로"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11.5px]">
          {isMine && !plan.builtin && (
            <button type="button" onClick={() => onEdit(plan.planId)} className="font-semibold text-[var(--amber-deep)]">
              {plan.locked ? "이름 고치기" : "고치기"}
            </button>
          )}
          <button type="button" onClick={() => doCopy(plan)} disabled={busy} className="text-[var(--ink-soft)] disabled:opacity-40">
            복사해서 내 것으로
          </button>
          {!isMine && !plan.builtin && (
            <button type="button" onClick={() => doReport(plan)} className="text-[var(--ink-faint)]">
              신고
            </button>
          )}
          <span className="flex-1" />
          {!plan.builtin && (isMine || admin) && (
            <button
              type="button"
              onClick={() => doDelete(plan)}
              disabled={busy}
              className="text-gray-400 hover:text-red-600 disabled:opacity-40"
            >
              지우기
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[360] bg-black/50 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="w-full h-[82vh] sm:w-[90vw] sm:max-w-2xl sm:h-[80vh] bg-[var(--paper)] dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-[var(--line)] dark:border-gray-700 flex items-center justify-between">
          <div>
            <b className="text-sm font-bold text-[var(--ink)] dark:text-gray-100">진도표 고르기</b>
            <p className="text-[11px] text-[var(--ink-faint)]">
              다른 분이 만든 진도표도 볼 수 있습니다. 진도(누가 어디까지 읽었는지)는 그룹 안에서만 보입니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {!loaded ? (
            <p className="text-[13px] text-[var(--ink-faint)]">불러오는 중…</p>
          ) : (
            <>
              {!ready && (
                <p className="rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[12px] text-[var(--amber-deep)] dark:text-amber-300">
                  진도표 만들기가 아직 준비 중입니다. 지금은 표준진도표만 쓸 수 있습니다.
                </p>
              )}

              {mine.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-[var(--ink-faint)]">내 진도표</div>
                  {mine.map((p) => row(p, true))}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-[var(--ink-faint)]">진도표</div>
                {others.map((p) => row(p, p.createdBy === session?.user_id))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-[var(--line)] dark:border-gray-700">
          <button
            type="button"
            onClick={() => (loggedIn ? onCreate() : onLogin?.())}
            disabled={!ready}
            className="w-full py-2.5 rounded-xl text-[13px] font-semibold bg-[var(--amber)] text-white disabled:opacity-40"
          >
            새 진도표 만들기
          </button>
        </div>

        {toast && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900 text-white text-xs shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
