"use client";

import { answerLabel } from "@/lib/bibleQa/columns";

/**
 * 성경 질문 기록 — 수퍼어드민 화면
 *
 * docs/BIBLE_QA_DOCTRINE.md §B-10 (지휘부 2026-09-18)
 *  - 누가 무엇을 묻고 어떤 답이 나갔는지 본다. **위기 건은 눈에 띄게** 표시한다
 *  - 열람은 **수퍼어드민만**. admin 등급은 못 본다
 *  - **열어 본 사실도 남는다**(서버가 `ai_question_views` 에 적는다)
 *  - 보관은 무기한. 수퍼어드민이 개별 기록을 지울 수 있다
 *
 * 화면의 `isSuperAdmin` 은 표시 제어일 뿐이다 — 실제 차단은 API 안의 게이트다.
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { isSuperAdmin } from "@/lib/admin";

interface AnswerRow {
  column_key: string;
  provider_alias: string | null;
  model: string | null;
  ok: boolean;
  content: string | null;
  error: string | null;
  removed_refs: string[] | null;
  input_tokens: number | null;
  output_tokens: number | null;
  elapsed_ms: number | null;
  reported: boolean;
  report_reason: string | null;
}

interface QuestionRow {
  id: number;
  user_id: string;
  user_name: string | null;
  verses_ref: string | null;
  question: string;
  input_kind: string;
  gate_result: string;
  is_crisis: boolean;
  crisis_reviewed: boolean | null;
  crisis_note: string | null;
  mode: string;
  housechurch: boolean;
  prompt_version: string;
  saved: boolean;
  /** 함께보기로 내놓았는가(§B-14) */
  shared?: boolean;
  share_hidden_at?: string | null;
  asked_at: string;
  ai_question_answers: AnswerRow[];
}

type Filter = "all" | "crisis" | "reported";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "crisis", label: "위기" },
  { key: "reported", label: "신고된 답" },
];



function fmt(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export default function AdminAiQuestionsPage() {
  const { session, loading } = useSession();
  const superAdmin = isSuperAdmin(session);

  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<QuestionRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [ready, setReady] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    setError(null);
    try {
      const params = new URLSearchParams({ filter });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/ai-questions?${params}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReady(d.ready !== false);
        setError(d.error || `불러오지 못했습니다 (${res.status})`);
        setItems([]);
        return;
      }
      setReady(true);
      setItems(d.items || []);
      setTotal(typeof d.total === "number" ? d.total : null);
    } finally {
      setLoaded(true);
    }
  }, [filter, q]);

  useEffect(() => {
    if (superAdmin) load();
  }, [superAdmin, load]);

  async function remove(id: number) {
    if (!window.confirm("이 기록을 영구 삭제할까요? 되돌릴 수 없고, 지웠다는 사실은 열람 기록에 남습니다.")) {
      return;
    }
    setBusy(true);
    await fetch(`/api/admin/ai-questions?id=${id}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  /**
   * 함께보기 내리기·올리기(§B-14). **기록은 지우지 않는다** — 목록에서만 내려간다.
   * 앱은 한 번만 답하므로 잘못 나간 답을 고칠 길이 없다. 내릴 수는 있어야 한다.
   */
  async function hideShare(id: number, hide: boolean) {
    setBusy(true);
    await fetch("/api/admin/ai-questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, share_hidden: hide }),
    });
    setBusy(false);
    load();
  }

  async function review(id: number, reviewed: boolean) {
    setBusy(true);
    await fetch("/api/admin/ai-questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, crisis_reviewed: reviewed }),
    });
    setBusy(false);
    load();
  }

  // 로딩을 먼저 본다 — 순서를 바꾸면 새로고침마다 '전용 페이지' 가 번쩍인다.
  if (loading) return <div className="p-6 text-sm text-gray-500">확인 중…</div>;
  if (!superAdmin) {
    return (
      <div className="p-6 text-sm text-red-600">
        이 기록은 수퍼어드민만 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 pb-24">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">성경 질문 기록</h1>
      <p className="text-xs text-gray-400 mb-3">
        누가 무엇을 묻고 어떤 답이 나갔는지 봅니다. <b>위기</b> 건은 붉게 표시됩니다.
        보관은 무기한이고, 지우면 되돌릴 수 없습니다. <b>열어 본 기록도 남습니다.</b>
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              filter === f.key
                ? "bg-[var(--amber)] text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load();
          }}
          placeholder="질문 글 찾기"
          className="flex-1 min-w-[120px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs"
        />
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
        >
          찾기
        </button>
      </div>

      {!ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
          기록 표가 아직 만들어지지 않았습니다. <code>scripts/migration-bible-qa.sql</code> 을 실행해야 합니다.
        </div>
      )}
      {ready && error && <div className="text-sm text-red-600">{error}</div>}

      {!loaded ? (
        <div className="text-sm text-gray-500">불러오는 중…</div>
      ) : items.length === 0 && ready && !error ? (
        <div className="text-sm text-gray-400">해당하는 기록이 없습니다.</div>
      ) : (
        <>
          {total !== null && (
            <p className="text-[11px] text-gray-400 mb-2">
              모두 {total}건 가운데 최근 {items.length}건
            </p>
          )}
          <div className="space-y-2">
            {items.map((row) => {
              const isOpen = open.has(row.id);
              const reportedCount = (row.ai_question_answers ?? []).filter((a) => a.reported).length;
              const failedCount = (row.ai_question_answers ?? []).filter((a) => !a.ok).length;
              return (
                <div
                  key={row.id}
                  className={`rounded-xl border p-3 ${
                    row.is_crisis
                      ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20"
                      : "border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-800"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                    {row.is_crisis && (
                      <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-bold">위기</span>
                    )}
                    {row.is_crisis && row.crisis_reviewed && (
                      <span className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700">검토함</span>
                    )}
                    <span className="font-semibold text-gray-700 dark:text-gray-200">
                      {row.user_name || row.user_id}
                    </span>
                    <span>{row.verses_ref}</span>
                    <span>{fmt(row.asked_at)}</span>
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">
                      {row.mode === "chorus" ? "합창" : "하나만"}
                    </span>
                    {row.input_kind === "voice" && (
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">음성</span>
                    )}
                    {row.gate_result === "error" && (
                      <span
                        className="px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40"
                        title="선별이 실패해 통과시킨 건"
                      >
                        선별실패
                      </span>
                    )}
                    {row.housechurch && (
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">가정교회</span>
                    )}
                    {row.saved && (
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">교인 저장</span>
                    )}
                    {reportedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 font-semibold">
                        신고 {reportedCount}
                      </span>
                    )}
                    {failedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">
                        빈 칸 {failedCount}
                      </span>
                    )}
                    <span className="opacity-60">{row.prompt_version}</span>
                  </div>

                  <p className="text-[13px] leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                    {row.question}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 mt-2 text-[11.5px]">
                    <button
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                      className="font-semibold text-[var(--amber-deep)]"
                    >
                      {isOpen ? "답 접기" : `답 보기 (${(row.ai_question_answers ?? []).length})`}
                    </button>
                    {row.is_crisis && (
                      <button
                        onClick={() => review(row.id, !row.crisis_reviewed)}
                        disabled={busy}
                        className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
                      >
                        {row.crisis_reviewed ? "검토 해제" : "검토함으로 표시"}
                      </button>
                    )}
                    {row.shared && (
                      <button
                        onClick={() => hideShare(row.id, !row.share_hidden_at)}
                        disabled={busy}
                        className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50"
                      >
                        {row.share_hidden_at ? "함께보기 올리기" : "함께보기 내리기"}
                      </button>
                    )}
                    <span className="flex-1" />
                    <button
                      onClick={() => remove(row.id)}
                      disabled={busy}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-2 space-y-2 border-t border-[var(--line)] dark:border-gray-700 pt-2">
                      {(row.ai_question_answers ?? []).length === 0 && (
                        <p className="text-[12px] text-gray-400">
                          답이 없습니다 — 위기·거절이거나 모델을 부르기 전에 끝난 건입니다.
                        </p>
                      )}
                      {(row.ai_question_answers ?? []).map((a) => (
                        <div key={a.column_key}>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-gray-400 mb-0.5">
                            <b className="text-gray-600 dark:text-gray-300">
                              {answerLabel(a.column_key, a.model)}
                            </b>
                            <span>{a.model || a.provider_alias}</span>
                            {a.elapsed_ms != null && <span>{(a.elapsed_ms / 1000).toFixed(1)}초</span>}
                            {a.output_tokens != null && <span>{a.output_tokens}토큰</span>}
                            {a.reported && (
                              <span className="px-1 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 font-semibold">
                                신고됨
                              </span>
                            )}
                            {a.removed_refs && a.removed_refs.length > 0 && (
                              <span
                                className="px-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                                title="성경에 없는 주소가 있어 화면에서 지웠다"
                              >
                                없는 구절: {a.removed_refs.join(", ")}
                              </span>
                            )}
                          </div>
                          {a.ok ? (
                            <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                              {a.content}
                            </p>
                          ) : (
                            <p className="text-[12px] text-gray-500">빈 칸 — {a.error}</p>
                          )}
                          {a.report_reason && (
                            <p className="mt-0.5 text-[11.5px] text-orange-700 dark:text-orange-300">
                              신고 사유: {a.report_reason}
                            </p>
                          )}
                        </div>
                      ))}
                      {row.crisis_note && (
                        <p className="text-[11.5px] text-gray-500">검토 메모: {row.crisis_note}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
