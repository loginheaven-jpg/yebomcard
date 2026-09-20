"use client";

/**
 * 말씀의삶 — 진도표 만들기 · 고치기 창 (지휘부 2026-09-20)
 *
 * **자동은 초안만 만든다.** 범위와 기간을 고르면 절 수 기준으로 고르게 나눈 회차가 표로 뜨고,
 * 그 자리에서 회차를 고친다(범위 고치기 · 나누기 · 합치기 · 줄 더하기/빼기 · 이름 바꾸기).
 * AI 한 줄도 같은 자리에 초안을 부어 준다 — 저장은 언제나 사람이 누른다.
 *
 * 검사는 `lib/plans/builder.ts` 가 한다. 화면과 서버가 **같은 함수**를 쓴다 —
 * 한쪽에만 규칙이 있으면 화면에서 통과한 것이 서버에서 막힌다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKS, CHAPTER_COUNTS } from "@/lib/books";
import {
  MAX_PLAN_DESC,
  MAX_PLAN_NAME,
  MAX_UNITS,
  MAX_UNIT_LABEL,
  SCOPES,
  autoUnits,
  formatRanges,
  labelOf,
  mergeWithNext,
  parsePlanLine,
  planStats,
  renumber,
  scopeBooks,
  splitUnit,
  sumVerses,
  chaptersOf,
  unitsForVersesPerDay,
  validateUnits,
  type ScopeKind,
} from "@/lib/plans/builder";
import type { PlanUnit } from "@/lib/plans/engine";
import {
  createPlan,
  draftPlanWithAi,
  fetchPlanDetail,
  updatePlan,
  type PlanSummary,
} from "@/lib/reading-plan";

interface Props {
  /** 고칠 진도표. 없으면 새로 만든다 */
  planId?: string | null;
  onClose: () => void;
  onSaved: (plan: PlanSummary) => void;
}

type Mode = "auto" | "ai";

const inputCls =
  "w-full rounded-lg border border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-[13px] text-[var(--ink)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--amber)]";

export default function PlanBuilderSheet({ planId, onClose, onSaved }: Props) {
  const editing = !!planId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [units, setUnits] = useState<PlanUnit[]>([]);
  /** 회차 줄의 글(편집 중인 것). 저장하면 units 로 옮긴다 */
  const [lineDraft, setLineDraft] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<Mode>("auto");

  // 자동 만들기
  const [scope, setScope] = useState<ScopeKind>("new");
  const [picked, setPicked] = useState<string[]>([]);
  const [unitCount, setUnitCount] = useState("30");
  const [byDay, setByDay] = useState(false);
  const [versesPerDay, setVersesPerDay] = useState("60");
  const [booksOpen, setBooksOpen] = useState(false);

  // AI
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  // 고치기 — 지금 내용을 불러온다
  useEffect(() => {
    if (!planId) return;
    let alive = true;
    (async () => {
      const detail = await fetchPlanDetail(planId);
      if (!alive) return;
      if (detail) {
        setName(detail.plan.name);
        setDescription(detail.plan.description ?? "");
        setVisibility(detail.plan.visibility);
        setUnits(detail.units);
        setLocked(detail.plan.locked);
      } else {
        setError("진도표를 불러오지 못했습니다");
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [planId]);

  const books = useMemo(() => scopeBooks(scope, picked), [scope, picked]);
  const scopeVerses = useMemo(() => sumVerses(chaptersOf(books)), [books]);
  const stats = useMemo(() => planStats(units), [units]);
  const issues = useMemo(() => validateUnits(units, books), [units, books]);

  const generate = useCallback(() => {
    if (books.length === 0) {
      setError("읽을 책을 골라 주세요");
      return;
    }
    setError(null);
    setAiNote(null);
    const next = byDay
      ? unitsForVersesPerDay(books, Number(versesPerDay) || 60)
      : autoUnits(books, Number(unitCount) || 30);
    setUnits(next);
    setLineDraft({});
  }, [books, byDay, unitCount, versesPerDay]);

  const askAi = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    setAiBusy(true);
    setError(null);
    const res = await draftPlanWithAi(prompt);
    setAiBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setUnits(res.units);
    setLineDraft({});
    setAiNote(res.note ?? "AI 가 만든 초안입니다. 아래에서 고친 뒤 저장하세요.");
    if (!name.trim() && res.name) setName(res.name);
  }, [aiPrompt, name]);

  /** 회차 줄을 고쳤다 — 읽어서 범위로 바꾼다. 못 읽으면 그 줄만 빨갛게 둔다 */
  const commitLine = useCallback(
    (index: number, text: string) => {
      const parsed = parsePlanLine(text);
      if (parsed.error || parsed.ranges.length === 0) {
        setError(parsed.error ?? "범위를 읽지 못했습니다");
        return;
      }
      setError(null);
      setUnits((prev) =>
        prev.map((u, i) => (i === index ? { ...u, ranges: parsed.ranges, label: labelOf(parsed.ranges) } : u)),
      );
      setLineDraft((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    },
    [],
  );

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("진도표 이름을 적어 주세요");
      return;
    }
    if (issues.errors.length > 0) {
      setError(issues.errors[0]);
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name: trimmed,
      description: description.trim(),
      visibility,
      units: renumber(units),
    };
    const res = editing
      ? await updatePlan(planId!, locked ? { name: payload.name, description: payload.description, visibility } : payload)
      : await createPlan(payload);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onSaved(res.plan);
  }, [name, description, visibility, units, issues.errors, editing, planId, locked, onSaved]);

  return (
    <div
      className="fixed inset-0 z-[370] bg-black/50 flex items-end sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        className="w-full h-[88vh] sm:w-[90vw] sm:max-w-3xl sm:h-[88vh] bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 머리 */}
        <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-[var(--line)] dark:border-gray-700 flex items-center justify-between gap-2">
          <b className="text-sm font-bold text-[var(--ink)] dark:text-gray-100">
            {editing ? "진도표 고치기" : "새 진도표 만들기"}
          </b>
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
              {locked && (
                <p className="rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[12px] text-[var(--amber-deep)] dark:text-amber-300">
                  다른 분이 이 진도표로 읽고 있어 <b>회차는 고칠 수 없습니다</b>. 이름과 설명만 고쳐집니다.
                  회차를 바꾸려면 진도표 목록에서 <b>복사</b>해 주세요.
                </p>
              )}

              {/* 이름 · 공개 */}
              <label className="block text-[11px] font-semibold text-[var(--ink-soft)]">
                진도표 이름
                <input
                  id="plan-name"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, MAX_PLAN_NAME))}
                  placeholder="예: 우리 목장 신약 90일"
                  className={`${inputCls} mt-0.5`}
                />
              </label>
              <label className="block text-[11px] font-semibold text-[var(--ink-soft)]">
                설명 (없어도 됩니다)
                <input
                  id="plan-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_PLAN_DESC))}
                  className={`${inputCls} mt-0.5`}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                <input
                  id="plan-private"
                  type="checkbox"
                  checked={visibility === "private"}
                  onChange={(e) => setVisibility(e.target.checked ? "private" : "public")}
                />
                나만 쓰기 (목록에서 다른 교인에게 보이지 않습니다)
              </label>

              {!locked && (
                <>
                  {/* 만드는 방법 */}
                  <div className="flex gap-1.5 pt-1" role="tablist" aria-label="만드는 방법">
                    {([["auto", "자동으로 나누기"], ["ai", "AI 에게 맡기기"]] as const).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={mode === k}
                        onClick={() => setMode(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          mode === k
                            ? "bg-[var(--amber)] text-white"
                            : "bg-gray-100 dark:bg-gray-700 text-[var(--ink-soft)] dark:text-gray-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {mode === "auto" ? (
                    <div className="rounded-xl border border-[var(--line)] dark:border-gray-700 p-3 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {SCOPES.map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => {
                              setScope(s.key);
                              if (s.key === "custom") setBooksOpen(true);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold ${
                              scope === s.key
                                ? "bg-[var(--amber-tint)] text-[var(--amber-deep)] border border-[var(--amber)]"
                                : "bg-gray-100 dark:bg-gray-700 text-[var(--ink-soft)] dark:text-gray-300"
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>

                      {scope === "custom" && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setBooksOpen((v) => !v)}
                            className="text-[12px] font-semibold text-[var(--amber-deep)]"
                          >
                            {booksOpen ? "책 접기" : `책 고르기 (${picked.length}권)`}
                          </button>
                          {booksOpen && (
                            <div className="mt-1.5 max-h-40 overflow-y-auto grid grid-cols-3 sm:grid-cols-5 gap-1">
                              {BOOKS.map((b) => {
                                const on = picked.includes(b.code);
                                return (
                                  <button
                                    key={b.code}
                                    type="button"
                                    onClick={() =>
                                      setPicked((prev) =>
                                        on ? prev.filter((c) => c !== b.code) : [...prev, b.code],
                                      )
                                    }
                                    className={`px-1.5 py-1 rounded text-[11px] truncate ${
                                      on
                                        ? "bg-[var(--amber)] text-white"
                                        : "bg-gray-100 dark:bg-gray-700 text-[var(--ink-soft)] dark:text-gray-300"
                                    }`}
                                    title={`${b.nameKr} ${CHAPTER_COUNTS[b.code]}장`}
                                  >
                                    {b.nameKr}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="plan-by"
                            checked={!byDay}
                            onChange={() => setByDay(false)}
                          />
                          회차 수
                          <input
                            id="plan-unit-count"
                            value={unitCount}
                            onChange={(e) => setUnitCount(e.target.value.replace(/\D/g, "").slice(0, 3))}
                            inputMode="numeric"
                            className="w-16 rounded border border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-[12px] tabular-nums"
                          />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name="plan-by"
                            checked={byDay}
                            onChange={() => setByDay(true)}
                          />
                          한 회에
                          <input
                            id="plan-verses-per-day"
                            value={versesPerDay}
                            onChange={(e) => setVersesPerDay(e.target.value.replace(/\D/g, "").slice(0, 3))}
                            inputMode="numeric"
                            className="w-16 rounded border border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-[12px] tabular-nums"
                          />
                          절쯤
                        </label>
                        <span className="text-[11px] text-[var(--ink-faint)]">
                          고른 범위 {books.length}권 · {scopeVerses.toLocaleString()}절
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={generate}
                        className="w-full py-2 rounded-lg text-[13px] font-semibold bg-[var(--amber)] text-white"
                      >
                        이대로 나누기
                      </button>
                      <p className="text-[11px] text-[var(--ink-faint)]">
                        장은 쪼개지 않고 절 수가 고르게 나뉩니다. 나눈 뒤 아래에서 고칠 수 있습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[var(--line)] dark:border-gray-700 p-3 space-y-2">
                      <input
                        id="plan-ai-prompt"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value.slice(0, 200))}
                        placeholder="예: 요한복음을 30일에, 주 5일만"
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={askAi}
                        disabled={aiBusy || !aiPrompt.trim()}
                        className="w-full py-2 rounded-lg text-[13px] font-semibold bg-[var(--amber)] text-white disabled:opacity-40"
                      >
                        {aiBusy ? "초안을 만들고 있습니다…" : "초안 만들기"}
                      </button>
                      <p className="text-[11px] text-[var(--ink-faint)]">
                        AI 는 초안만 만듭니다. 없는 장이나 범위를 넘는 것은 앱이 걸러 내고, 저장은 직접 누르셔야 합니다.
                      </p>
                    </div>
                  )}
                </>
              )}

              {aiNote && (
                <p className="text-[11.5px] text-[var(--amber-deep)] dark:text-amber-300">{aiNote}</p>
              )}

              {/* 회차 표 */}
              {units.length > 0 && (
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <b className="text-[12px] font-semibold text-[var(--ink-soft)]">
                      회차 {stats.unitCount}개
                    </b>
                    <span className="text-[11px] text-[var(--ink-faint)] tabular-nums">
                      {stats.chapterCount}장 · {stats.verseCount.toLocaleString()}절 · 한 회차 {stats.minVerses}~
                      {stats.maxVerses}절
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-[38vh] overflow-y-auto pr-1">
                    {units.map((u, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-[var(--line)] dark:border-gray-700 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 w-7 text-right text-[11px] text-[var(--ink-faint)] tabular-nums">
                            {i + 1}
                          </span>
                          <input
                            id={`plan-unit-${i}`}
                            value={lineDraft[i] ?? formatRanges(u.ranges)}
                            onChange={(e) => setLineDraft((p) => ({ ...p, [i]: e.target.value }))}
                            onBlur={(e) => {
                              if (lineDraft[i] !== undefined) commitLine(i, e.target.value);
                            }}
                            disabled={locked}
                            className={`${inputCls} flex-1 disabled:opacity-60`}
                          />
                        </div>
                        {!locked && (
                          <div className="flex flex-wrap items-center gap-2.5 mt-1 pl-9 text-[11px]">
                            <input
                              id={`plan-unit-label-${i}`}
                              value={u.label}
                              onChange={(e) =>
                                setUnits((prev) =>
                                  prev.map((x, j) =>
                                    j === i ? { ...x, label: e.target.value.slice(0, MAX_UNIT_LABEL) } : x,
                                  ),
                                )
                              }
                              placeholder="회차 이름"
                              className="flex-1 min-w-[100px] rounded border border-[var(--line)] dark:border-gray-700 bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--ink-soft)]"
                            />
                            <button
                              type="button"
                              onClick={() => setUnits((prev) => splitUnit(prev, i))}
                              className="text-[var(--ink-soft)]"
                            >
                              나누기
                            </button>
                            <button
                              type="button"
                              onClick={() => setUnits((prev) => mergeWithNext(prev, i))}
                              disabled={i === units.length - 1}
                              className="text-[var(--ink-soft)] disabled:opacity-30"
                            >
                              다음과 합치기
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setUnits((prev) => renumber(prev.filter((_, j) => j !== i)))
                              }
                              className="text-gray-400 hover:text-red-600"
                            >
                              빼기
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {!locked && units.length < MAX_UNITS && (
                    <button
                      type="button"
                      onClick={() =>
                        setUnits((prev) =>
                          renumber([...prev, { seq: 0, label: "", ranges: [{ book: "gen", fromCh: 1, toCh: 1 }] }]),
                        )
                      }
                      className="mt-1.5 text-[12px] font-semibold text-[var(--amber-deep)]"
                    >
                      + 회차 더하기
                    </button>
                  )}
                </div>
              )}

              {/* 검사 */}
              {issues.errors.length > 0 && (
                <ul className="rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2 text-[11.5px] text-red-700 dark:text-red-300 list-disc list-inside space-y-0.5">
                  {issues.errors.slice(0, 5).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {issues.warnings.length > 0 && (
                <ul className="rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-[11.5px] text-[var(--amber-deep)] dark:text-amber-300 list-disc list-inside space-y-0.5">
                  {issues.warnings.slice(0, 4).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {error && <p className="text-[12.5px] text-red-600">{error}</p>}
            </>
          )}
        </div>

        {/* 발 */}
        <div className="shrink-0 px-4 py-3 border-t border-[var(--line)] dark:border-gray-700 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-gray-100 dark:bg-gray-700 text-[var(--ink-soft)] dark:text-gray-300"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || units.length === 0 || !name.trim()}
            className="flex-1 py-2 rounded-xl text-[13px] font-semibold bg-[var(--amber)] text-white disabled:opacity-40"
          >
            {busy ? "저장 중…" : editing ? "저장" : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}
