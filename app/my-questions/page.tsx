"use client";

import { answerLabel } from "@/lib/bibleQa/columns";

/**
 * 나의 질문 (§B-14, 지휘부 2026-09-21)
 *
 * 설정 → 나의 질문. 내가 한 **모든** 질문을 최근 것부터 본다 —
 * 전에는 그 절로 다시 찾아가야만 보였고, 저장하지 않은 질문은 볼 길이 아예 없었다.
 *
 * 여기서 할 수 있는 것: 펼쳐 답 다시 읽기 · **함께보기 켜고 끄기** · 내 절에서 내리기(저장 해제).
 * 보이는 것은 **본인 것뿐이다.** 모든 교인의 질문과 이름은 `/admin/ai-questions`(수퍼어드민)에서 보고,
 * 그 화면은 열어 본 사실을 남긴다(§B-10). 두 화면을 합치면 그 기록을 빠뜨리기 쉬워 일부러 나눴다.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { fetchMyQuestions, setQaSaved, type MyQuestion } from "@/lib/bibleQa/client";

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export default function MyQuestionsPage() {
  const { session, loading } = useSession();
  const loggedIn = !!session?.isLoggedIn;

  const [items, setItems] = useState<MyQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [shareReady, setShareReady] = useState(true);
  const [ready, setReady] = useState(false);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 조회는 effect 안에서만 — effect 밖 함수를 effect 가 부르면 렌더가 연쇄한다(저장소 공통 규칙).
  useEffect(() => {
    if (loading || !loggedIn) return;
    let alive = true;
    (async () => {
      const res = await fetchMyQuestions(page);
      if (!alive) return;
      setItems(res.items);
      setTotal(res.total);
      setPageSize(res.pageSize);
      setShareReady(res.shareReady);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [loading, loggedIn, page]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  /** 함께보기 켜고 끄기. 저장하지 않은 질문은 공유할 수 없다(저장이 곧 내놓는 행위다). */
  const toggleShare = useCallback(
    async (q: MyQuestion) => {
      const next = !q.shared;
      setBusy(q.id);
      const ok = await setQaSaved(q.id, true, next);
      setBusy(null);
      if (!ok) {
        flash("바꾸지 못했습니다.");
        return;
      }
      setItems((prev) =>
        prev.map((x) => (x.id === q.id ? { ...x, shared: next, saved: true } : x)),
      );
      flash(next ? "함께보기로 내놓았습니다(이름은 안 보입니다)." : "나만 보도록 바꿨습니다.");
    },
    [flash],
  );

  /** 내 절에서 내린다. 서버가 공유도 함께 내린다 — 내가 버린 것이 남에게 남아 있으면 안 된다. */
  const unsave = useCallback(
    async (q: MyQuestion) => {
      if (!window.confirm("이 질문을 내 절에서 내릴까요?\n함께보기에서도 내려갑니다.")) return;
      setBusy(q.id);
      const ok = await setQaSaved(q.id, false);
      setBusy(null);
      if (!ok) {
        flash("내리지 못했습니다.");
        return;
      }
      setItems((prev) =>
        prev.map((x) => (x.id === q.id ? { ...x, saved: false, shared: false } : x)),
      );
      flash("내렸습니다. 기록은 남습니다.");
    },
    [flash],
  );

  if (loading) {
    return <p className="p-6 text-sm text-[var(--ink-faint)]">불러오는 중…</p>;
  }
  if (!loggedIn) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--ink-soft)]">로그인하셔야 볼 수 있습니다.</p>
        <Link href="/" className="mt-3 inline-block text-[13px] font-semibold text-[var(--amber-deep)]">
          ‹ 말씀으로 돌아가기
        </Link>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-[var(--canvas)] dark:bg-gray-900">
      <header className="sticky top-0 z-10 bg-[var(--paper)] dark:bg-gray-800 border-b border-[var(--line)] dark:border-gray-700">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" aria-label="말씀으로 돌아가기" className="text-[var(--ink-faint)] text-lg">
            ‹
          </Link>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-[var(--ink)] dark:text-gray-100">나의 질문</h1>
            <p className="text-[11px] text-[var(--ink-faint)]">
              내가 성경을 읽다가 물은 것들 {total > 0 && `· ${total}개`}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4 space-y-2.5">
        {!ready && <p className="text-[13px] text-[var(--ink-faint)]">불러오는 중…</p>}
        {ready && items.length === 0 && (
          <p className="text-[13px] text-[var(--ink-faint)]">
            아직 물으신 것이 없습니다. 본문에서 절을 고르고 ‘질문’ 을 눌러 보세요.
          </p>
        )}

        {items.map((q) => {
          const open = openIds.has(q.id);
          const answers = (q.ai_question_answers ?? []).filter((a) => a.ok && a.content);
          return (
            <div
              key={q.id}
              className="rounded-xl border border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(q.id)) next.delete(q.id);
                    else next.add(q.id);
                    return next;
                  })
                }
                className="w-full text-left px-3.5 py-2.5"
                aria-expanded={open}
              >
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-semibold text-[var(--amber-deep)]">{q.verses_ref ?? "?"}</span>
                  <span className="text-[var(--ink-faint)] tabular-nums">{when(q.asked_at)}</span>
                  {q.input_kind === "voice" && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--ink-faint)]">
                      말로
                    </span>
                  )}
                  {q.is_crisis && (
                    <span className="px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 font-semibold">
                      상담 안내
                    </span>
                  )}
                  {q.saved && q.shared && !q.share_hidden_at && (
                    <span className="px-1.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 font-semibold">
                      함께보기
                    </span>
                  )}
                  {q.share_hidden_at && (
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[var(--ink-faint)]">
                      관리자가 내림
                    </span>
                  )}
                  {!q.saved && (
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[var(--ink-faint)]">
                      저장 안 함
                    </span>
                  )}
                </div>
                <p
                  className={`mt-1 text-[13px] leading-snug text-[var(--ink)] dark:text-gray-100 ${
                    open ? "whitespace-pre-wrap break-words" : "truncate"
                  }`}
                >
                  {q.question}
                </p>
              </button>

              {open && (
                <div className="px-3.5 pb-3 space-y-2">
                  {answers.length === 0 ? (
                    <p className="text-[12px] text-[var(--ink-faint)]">
                      남아 있는 답이 없습니다(위기 안내나 거절이었을 수 있습니다).
                    </p>
                  ) : (
                    answers.map((a) => (
                      <div
                        key={answerLabel(a.column_key, a.model)}
                        className="rounded-lg bg-[var(--paper-2)] dark:bg-gray-900 px-3 py-2"
                      >
                        <div className="text-[11px] font-semibold text-[var(--ink-faint)] mb-1">
                          {answerLabel(a.column_key, a.model)}
                          {a.model ? ` · ${a.model}` : ""}
                        </div>
                        <p className="text-[12.5px] leading-relaxed text-[var(--ink-soft)] dark:text-gray-300 whitespace-pre-wrap break-words">
                          {a.content}
                        </p>
                      </div>
                    ))
                  )}

                  {q.saved && (
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px]">
                      {shareReady && !q.is_crisis && (
                        <button
                          type="button"
                          onClick={() => toggleShare(q)}
                          disabled={busy === q.id || !!q.share_hidden_at}
                          className="font-semibold text-[var(--amber-deep)] disabled:opacity-40"
                        >
                          {q.shared ? "나만 보기로 바꾸기" : "함께보기로 내놓기"}
                        </button>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => unsave(q)}
                        disabled={busy === q.id}
                        className="text-gray-400 hover:text-red-600 disabled:opacity-40"
                      >
                        내 절에서 내리기
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-3 text-[12.5px]">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--ink-soft)] disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-[var(--ink-faint)] tabular-nums">
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="px-3 py-1.5 rounded-lg bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--ink-soft)] disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900 text-white text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
