"use client";

/**
 * 말씀의삶 — 그룹 (시안 D).
 *
 * 일정이 없으니 이 화면은 **누가 어디까지 왔는가** 하나만 보여준다.
 * 벌점·독촉·미읽음 알림을 두지 않는 것이 설계 의도다.
 *
 * 순위 규칙은 화면 문구와 서버 정렬이 반드시 같아야 한다 —
 * 완료 회차 내림차순, **같은 회차면 이름순**. (시안의 "먼저 마친 사람이 위"는 폐기했다.
 * read_at 은 재열람마다 갱신되어, 이미 읽은 장을 다시 열면 순위가 뒤집히기 때문이다.)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";
import {
  fetchMyGroups,
  fetchStandings,
  createGroup,
  joinGroup,
  leaveGroup,
  setGroupPlan,
  type ReadingGroup,
  type GroupStanding,
  type PlanSummary,
} from "@/lib/reading-plan";
import PlanPickerSheet from "@/components/PlanPickerSheet";
import PlanBuilderSheet from "@/components/PlanBuilderSheet";
import { BUILTIN_PLANS, DEFAULT_PLAN_ID } from "@/lib/plans/registry";

/** 고르지 않으면 표준진도표. 회차 수는 **그룹마다 다르므로** 카드에서 group.unitCount 를 쓴다. */
const DEFAULT_PLAN_NAME = BUILTIN_PLANS[DEFAULT_PLAN_ID]?.name ?? "표준진도표";

interface Props {
  isLoggedIn: boolean;
  onLogin?: () => void;
  /** 그룹 구성이 바뀌면 요약 스트립도 다시 계산해야 한다 */
  onGroupsChanged?: () => void;
}

type Sheet = "join" | "create" | null;

export default function ReadingGroupsView({ isLoggedIn, onLogin, onGroupsChanged }: Props) {
  const [groups, setGroups] = useState<ReadingGroup[]>([]);
  const [standings, setStandings] = useState<Record<number, GroupStanding[]>>({});
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 참여·탈퇴 후 다시 읽기. effect 밖의 함수를 effect 에서 부르면 렌더가 연쇄하므로
  // (react-hooks/set-state-in-effect) 조회는 전부 effect 안에 두고 이 값으로만 다시 돌린다.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);
  /** 그룹을 만들 때 고른 진도표(2026-09-20). 고르지 않으면 표준진도표 */
  const [newPlan, setNewPlan] = useState<{ id: string; name: string }>({
    id: DEFAULT_PLAN_ID,
    name: DEFAULT_PLAN_NAME,
  });
  /** 진도표 고르기 창 — "create" 면 만들 때, 숫자면 그 그룹의 진도표를 바꾸는 중 */
  const [pickerFor, setPickerFor] = useState<"create" | number | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await (isLoggedIn ? fetchMyGroups() : Promise.resolve<ReadingGroup[]>([]));
      if (!alive) return;
      setGroups(list);
      setLoading(false);
      // 카드마다 순위를 채운다. 실패한 그룹은 이름·인원만 남고 순위 자리가 빈다.
      const results = await Promise.all(list.map((g) => fetchStandings(g.id)));
      if (!alive) return;
      const next: Record<number, GroupStanding[]> = {};
      results.forEach((r, i) => {
        if (r) next[list[i].id] = r.standings;
      });
      setStandings(next);
    })();
    return () => {
      alive = false;
    };
  }, [isLoggedIn, reloadNonce]);

  const copyCode = useCallback(async (g: ReadingGroup) => {
    try {
      await navigator.clipboard.writeText(g.inviteCode);
      setCopied(g.id);
      setTimeout(() => setCopied((v) => (v === g.id ? null : v)), 1500);
    } catch {
      // 클립보드 권한이 없는 브라우저 — 코드는 화면에 그대로 보이니 손으로 옮겨 적으면 된다
      setNotice("복사할 수 없습니다. 코드를 직접 옮겨 적어 주세요");
    }
  }, []);

  /**
   * 초대링크 — `https://bible.yebom.org/?join=코드`. 받은 사람은 누르고 로그인만 하면 참여된다
   * (page.tsx 가 링크를 받아 말씀의삶을 열고, ReadingPlanPanel 이 참여시킨다). 코드 입력 참여도 그대로 있다.
   * 폰에서는 공유 창(카톡 등)을 띄우고, 공유 창이 없는 브라우저는 문구와 링크를 복사한다.
   */
  const shareInvite = useCallback(async (g: ReadingGroup) => {
    const url = `${window.location.origin}/?join=${g.inviteCode}`;
    const text = `예봄성경 말씀의삶 '${g.name}' 그룹에 초대합니다. 링크를 누르고 로그인하면 바로 참여됩니다.`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "말씀의삶 그룹 초대", text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // 공유 창을 닫았다
        // 그 밖의 실패는 복사로 넘어간다
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setNotice("초대링크를 복사했습니다. 카톡 등에 붙여 넣으세요");
    } catch {
      setNotice(`복사할 수 없습니다. 이 주소를 전해 주세요: ${url}`);
    }
  }, []);

  const onLeave = useCallback(
    async (g: ReadingGroup) => {
      setMenuFor(null);
      const last = (standings[g.id]?.length ?? g.memberCount) <= 1;
      const msg = last
        ? `${g.name} — 마지막 멤버라 나가면 그룹이 사라집니다. 계속할까요?`
        : `${g.name} 에서 나갈까요?`;
      if (!window.confirm(msg)) return;
      const res = await leaveGroup(g.id);
      if (!res.ok) {
        setNotice(res.error);
        return;
      }
      setNotice(res.deleted ? "그룹을 나가고 삭제했습니다" : "그룹을 나갔습니다");
      reload();
      onGroupsChanged?.();
    },
    [standings, reload, onGroupsChanged],
  );

  const onSubmitSheet = useCallback(
    async (kind: "join" | "create", value: string): Promise<string | null> => {
      const res = kind === "create" ? await createGroup(value, newPlan.id) : await joinGroup(value);
      if ("error" in res) return res.error;
      setSheet(null);
      setNotice(
        kind === "create"
          ? `그룹을 만들었습니다 · ${res.group.planName ?? newPlan.name}`
          : // 다른 진도표를 읽는 그룹에 들어가는 것을 교인이 알아야 한다.
            `${res.group.name} 에 참여했습니다${res.group.planName ? ` · ${res.group.planName}` : ""}`,
      );
      reload();
      onGroupsChanged?.();
      return null;
    },
    [reload, onGroupsChanged, newPlan],
  );

  /** 그룹이 읽는 진도표 바꾸기 — 그룹을 만든 사람만(서버가 다시 확인한다) */
  const changeGroupPlan = useCallback(
    async (groupId: number, plan: PlanSummary) => {
      const res = await setGroupPlan(groupId, plan.planId);
      if (!res.ok) {
        setNotice(res.error);
        return;
      }
      setNotice(`진도표를 '${res.planName ?? plan.name}' 로 바꿨습니다`);
      reload();
      onGroupsChanged?.();
    },
    [reload, onGroupsChanged],
  );

  if (!isLoggedIn) {
    return (
      <div className="flex-1 px-4 pt-2">
        <div className="px-3.5 py-4 bg-[var(--paper-2)] rounded-xl">
          <p className="text-xs text-[var(--ink-soft)] leading-relaxed">
            로그인하면 함께 읽는 그룹을 만들고 서로의 진도를 볼 수 있습니다.{" "}
            <button
              type="button"
              onClick={onLogin}
              className="font-semibold text-[var(--amber-deep)] underline underline-offset-2"
            >
              로그인
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 pb-4 overscroll-contain">
        {loading ? (
          <p className="text-sm text-[var(--ink-faint)] py-6 text-center">불러오는 중…</p>
        ) : groups.length === 0 ? (
          <div className="px-3.5 py-5 rounded-xl border border-dashed border-[var(--line)] text-center">
            <p className="text-sm text-[var(--ink-soft)]">아직 속한 그룹이 없습니다</p>
            <p className="text-[11px] text-[var(--ink-faint)] mt-1 leading-relaxed">
              초대코드를 받았다면 참여하고,
              <br />
              함께 읽을 모임이 있다면 만들어 코드를 나눠 주세요.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              rows={standings[g.id]}
              copied={copied === g.id}
              menuOpen={menuFor === g.id}
              onToggleMenu={() => setMenuFor((v) => (v === g.id ? null : g.id))}
              onCopy={() => void copyCode(g)}
              onShare={() => void shareInvite(g)}
              onLeave={() => void onLeave(g)}
              onChangePlan={() => setPickerFor(g.id)}
            />
          ))
        )}

        {groups.length > 0 && (
          <p className="text-[11px] text-[var(--ink-faint)] text-center mt-3 leading-relaxed">
            순위는 완료 회차 수 기준. 같은 회차면 이름순.
          </p>
        )}
      </div>

      {/* 하단 고정 — 탭바 위에 얹는다 */}
      <div className="shrink-0 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+72px)] flex gap-2 bg-[var(--paper)]">
        <button
          type="button"
          onClick={() => setSheet("join")}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-[var(--paper-2)] text-[var(--ink-soft)]"
        >
          초대코드로 참여
        </button>
        <button
          type="button"
          onClick={() => setSheet("create")}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-[var(--amber)] text-white"
        >
          그룹 만들기
        </button>
      </div>

      {notice && <Toast text={notice} onDone={() => setNotice(null)} />}
      {sheet && (
        <InputSheet
          kind={sheet}
          onClose={() => setSheet(null)}
          onSubmit={(v) => onSubmitSheet(sheet, v)}
          planName={newPlan.name}
          onPickPlan={() => setPickerFor("create")}
        />
      )}

      {/* 진도표 고르기 — 그룹을 만들 때와, 그룹의 진도표를 바꿀 때 같은 창을 쓴다 */}
      {pickerFor !== null && (
        <PlanPickerSheet
          currentPlanId={
            pickerFor === "create"
              ? newPlan.id
              : groups.find((g) => g.id === pickerFor)?.planId ?? ""
          }
          onPick={(plan) => {
            const target = pickerFor;
            setPickerFor(null);
            if (target === "create") setNewPlan({ id: plan.planId, name: plan.name });
            else if (typeof target === "number") void changeGroupPlan(target, plan);
          }}
          onClose={() => setPickerFor(null)}
          onCreate={() => {
            setPickerFor(null);
            setBuilderOpen(true);
          }}
          onEdit={() => {
            setPickerFor(null);
            setBuilderOpen(true);
          }}
          onLogin={onLogin}
        />
      )}
      {builderOpen && (
        <PlanBuilderSheet
          onClose={() => setBuilderOpen(false)}
          onSaved={(plan) => {
            setBuilderOpen(false);
            // 만든 진도표를 곧바로 '만들 그룹' 의 진도표로 삼는다.
            setNewPlan({ id: plan.planId, name: plan.name });
            setNotice(`'${plan.name}' 을(를) 만들었습니다`);
          }}
        />
      )}
    </>
  );
}

/** 그룹 카드 — 이름 / 인원·평균·완주 / 초대코드 / 멤버 순위 */
function GroupCard({
  group,
  rows,
  copied,
  menuOpen,
  onToggleMenu,
  onCopy,
  onShare,
  onLeave,
  onChangePlan,
}: {
  group: ReadingGroup;
  rows: GroupStanding[] | undefined;
  copied: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCopy: () => void;
  onShare: () => void;
  onLeave: () => void;
  onChangePlan: () => void;
}) {
  // 회차 수는 **이 그룹의 진도표**에서 온다. 91 로 굳으면 막대가 100% 를 넘거나 완주가 안 뜬다.
  const TOTAL = group.unitCount ?? 0;
  const n = rows?.length ?? group.memberCount;
  const avg =
    rows && rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.doneCount, 0) / rows.length)
      : null;
  const finished = rows && TOTAL > 0 ? rows.filter((r) => r.doneCount >= TOTAL).length : 0;

  return (
    <div className="mt-2.5 px-3.5 py-3 rounded-xl border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-[var(--ink)] leading-snug">{group.name}</p>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={onToggleMenu}
            aria-label={`${group.name} 메뉴`}
            aria-expanded={menuOpen}
            className="w-7 h-7 -mr-1 -mt-0.5 flex items-center justify-center text-[var(--ink-faint)] text-base leading-none"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 min-w-[120px] rounded-lg border border-[var(--line)] bg-[var(--paper)] shadow-lg py-1">
              {group.isOwner && (
                <button
                  type="button"
                  onClick={onChangePlan}
                  className="w-full text-left text-xs px-3 py-2 text-[var(--ink-soft)]"
                >
                  진도표 바꾸기
                </button>
              )}
              <button
                type="button"
                onClick={onLeave}
                className="w-full text-left text-xs px-3 py-2 text-[var(--ink-soft)]"
              >
                그룹 나가기
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 이 그룹이 읽는 진도표(2026-09-20). 해제된 그룹은 다시 골라야 한다 */}
      {group.planId ? (
        <p className="text-[11px] text-[var(--ink-soft)] mt-0.5 truncate">
          진도표 <b className="font-semibold">{group.planName ?? "알 수 없음"}</b>
          {TOTAL > 0 ? ` · ${TOTAL}회차` : ""}
        </p>
      ) : (
        <button
          type="button"
          onClick={group.isOwner ? onChangePlan : undefined}
          className="mt-0.5 text-[11px] text-left text-[var(--amber-deep)] font-semibold"
        >
          진도표가 해제되었습니다 —{" "}
          {group.isOwner ? "다시 고르기 ›" : "그룹을 만든 분이 다시 골라야 합니다"}
        </button>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="text-[11px] text-[var(--ink-faint)]">
          {n}명
          {avg !== null && ` · 평균 ${avg}회차`}
          {finished > 0 && ` · 완주 ${finished}명`}
        </span>
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCopy}
            aria-label="초대코드 복사"
            className="text-[11px] font-mono font-semibold tracking-wider px-2 py-1 rounded-md bg-[var(--paper-2)] text-[var(--ink-soft)]"
          >
            {copied ? "복사됨" : group.inviteCode}
          </button>
          {/* 초대링크 — 누르고 로그인만 하면 참여된다(코드를 옮겨 적지 않아도 된다) */}
          <button
            type="button"
            onClick={onShare}
            className="text-[11px] font-semibold px-2 py-1 rounded-md bg-[var(--amber-tint)] text-[var(--amber-deep)]"
          >
            초대링크
          </button>
        </div>
      </div>

      {rows === undefined ? (
        <p className="text-[11px] text-[var(--ink-faint)] mt-2.5">순위를 불러오는 중…</p>
      ) : (
        <div className="mt-2.5">
          {rows.map((r) => (
            <div
              key={r.userId}
              className={`grid items-center gap-2 py-1 px-1.5 rounded-md ${
                r.isMe ? "bg-[var(--amber-tint)]" : ""
              }`}
              style={{ gridTemplateColumns: "18px minmax(48px, 1fr) 2fr 26px" }}
            >
              <span className="text-[11px] text-[var(--ink-faint)] text-center">{r.rank}</span>
              <span
                className={`text-xs truncate ${
                  r.isMe ? "font-semibold text-[var(--amber-deep)]" : "text-[var(--ink)]"
                }`}
              >
                {r.isMe ? "나" : r.name}
              </span>
              <span className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                <span
                  className="block h-full rounded-full bg-[var(--amber)]"
                  style={{
                    width: `${TOTAL > 0 ? Math.min(100, (r.doneCount / TOTAL) * 100).toFixed(1) : 0}%`,
                  }}
                />
              </span>
              <span className="text-[11px] text-[var(--ink-soft)] text-right tabular-nums">
                {r.doneCount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 이름 또는 코드 한 칸짜리 작은 시트 */
function InputSheet({
  kind,
  onClose,
  onSubmit,
  planName,
  onPickPlan,
}: {
  kind: "join" | "create";
  onClose: () => void;
  onSubmit: (value: string) => Promise<string | null>;
  /** 만들 때 고른 진도표 이름 — 그룹마다 다른 진도표를 읽을 수 있다(2026-09-20) */
  planName?: string;
  onPickPlan?: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useHardwareBack(true, onClose);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isJoin = kind === "join";
  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit(v);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative w-full max-w-md bg-[var(--paper)] rounded-t-2xl p-5 pb-8 shadow-2xl">
        <div className="w-10 h-1 rounded-full bg-[var(--line)] mx-auto mb-4" aria-hidden />
        <p className="text-sm font-bold text-[var(--ink)] mb-1">
          {isJoin ? "초대코드로 참여" : "그룹 만들기"}
        </p>
        <p className="text-[11px] text-[var(--ink-faint)] mb-3">
          {isJoin
            ? "받은 6자리 코드를 입력하세요"
            : "만들면 6자리 초대코드가 생깁니다. 코드를 나눠 주세요"}
        </p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) =>
            setValue(isJoin ? e.target.value.toUpperCase().slice(0, 8) : e.target.value.slice(0, 30))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          maxLength={isJoin ? 8 : 30}
          autoCapitalize={isJoin ? "characters" : "off"}
          autoCorrect="off"
          spellCheck={false}
          placeholder={isJoin ? "YB7K2M" : "예: 예봄교회 수요성경반"}
          aria-label={isJoin ? "초대코드" : "그룹 이름"}
          className={`w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] text-sm text-[var(--ink)] outline-none focus:border-[var(--amber)] ${
            isJoin ? "font-mono tracking-[3px] uppercase" : ""
          }`}
        />
        {!isJoin && (
          <button
            type="button"
            onClick={onPickPlan}
            className="w-full mt-2 px-3 py-2 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] flex items-center gap-1.5 text-left"
          >
            <span className="text-[10px] font-semibold text-[var(--ink-faint)] shrink-0">진도표</span>
            <span className="text-[12.5px] font-semibold text-[var(--ink)] truncate">{planName}</span>
            <span className="ml-auto text-[11px] font-semibold text-[var(--amber-deep)] shrink-0">고르기 ›</span>
          </button>
        )}
        {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          className="w-full mt-3 py-3 rounded-xl text-sm font-bold bg-[var(--amber)] text-white disabled:opacity-50"
        >
          {busy ? "처리 중…" : isJoin ? "참여" : "만들기"}
        </button>
      </div>
    </div>
  );
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-[320] px-3.5 py-2 rounded-full bg-black/80 text-white text-xs max-w-[80vw] text-center">
      {text}
    </div>
  );
}
