"use client";

/**
 * 성경 질문 — 절을 고르고 '질문' 을 누르면 열리는 창
 *
 * 재가받은 시안: docs/tasks/성경질문_화면시안.html
 * 규칙: docs/BIBLE_QA_DOCTRINE.md §B (앱이 맡는 몫)
 *  - §B-2 면책 문구는 앱이 한 번만 붙인다
 *  - §B-3 합창일 때 '갈리는 대목' 한 줄
 *  - §B-6 답마다 '이 답이 이상합니다'
 *  - §B-7 입력창 아래 외부 전송 고지
 *  - §B-8 긴 답은 한 줄 요약만 먼저 보이고 나머지는 접는다
 *  - §B-9 답에 나온 구절의 본문은 앱이 붙인다(서버가 확인해 보내 준다)
 *
 * 화면은 폰에서 위에서 아래로 세 카드, PC 에서 좌우로 세 칸(지휘부 2026-09-18).
 * **앱은 한 번만 답한다** — 이어서 묻고 싶으면 그 AI 로 넘긴다.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";
import { stripNotes, type BibleVerse } from "@/lib/types";
import { getVersionLabel } from "@/lib/versions";
import { QA_COLUMNS, type ColumnKey } from "@/lib/bibleQa/columns";
import {
  DISCLAIMER,
  DIVERGENCE_NOTE,
  EXTERNAL_NOTICE,
  QUESTION_MAX_LENGTH,
} from "@/lib/bibleQa/texts";
import {
  handoffText,
  handoffUrl,
  parseAnswer,
  supportsPrefill,
} from "@/lib/bibleQa/answerFormat";
import {
  askBibleQa,
  reportQaAnswer,
  setQaSaved,
  type QaAnswer,
  type QaResult,
} from "@/lib/bibleQa/client";

/** 마지막에 고른 AI 를 기억한다 — 처음 쓰는 교인은 Gemini(지휘부). */
const PICK_KEY = "yebom_qa_ai";
type Pick = ColumnKey | "chorus";

function loadPick(): Pick {
  try {
    const raw = localStorage.getItem(PICK_KEY);
    if (raw === "chorus" || QA_COLUMNS.some((c) => c.key === raw)) return raw as Pick;
  } catch {
    // 시크릿 창·저장 차단. 기본값으로 간다.
  }
  return "gemini";
}

function savePick(pick: Pick) {
  try {
    localStorage.setItem(PICK_KEY, pick);
  } catch {
    // 못 적어도 이번 질문은 그대로 된다.
  }
}

interface Props {
  /** 고른 절. 첫 절의 책·장을 기준으로 삼고 같은 장의 절만 쓴다. */
  verses: BibleVerse[];
  version: string;
  onClose: () => void;
}

export default function BibleQaSheet({ verses, version, onClose }: Props) {
  // 이 창은 절을 고르고 단추를 눌러야 열린다 — 서버에서 그려지는 일이 없으므로
  // 첫 렌더에 바로 기억한 값을 읽어도 어긋나지 않는다(loadPick 이 실패를 삼킨다).
  const [pick, setPick] = useState<Pick>(loadPick);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<QaResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  useHardwareBack(true, onClose);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  // ── 고른 절 정리 — 첫 절과 같은 책·장만, 절 번호로 정렬 ──────────────
  // 탭한 순서가 아니라 읽는 순서를 따른다(3절→1절로 눌러도 1절부터).
  const target = useMemo(() => {
    if (verses.length === 0) return null;
    const base = verses[0];
    const same = verses
      .filter((v) => v.book_code === base.book_code && v.chapter === base.chapter)
      .sort((a, b) => a.verse - b.verse);
    const start = same[0]?.verse ?? base.verse;
    const end = same[same.length - 1]?.verse ?? start;
    return {
      bookCode: base.book_code,
      bookName: base.book_name,
      chapter: base.chapter,
      verseStart: start,
      verseEnd: end > start ? end : null,
      ref: end > start
        ? `${base.book_name} ${base.chapter}:${start}-${end}`
        : `${base.book_name} ${base.chapter}:${start}`,
      text: same.map((v) => stripNotes(v.text)).join(" "),
      dropped: verses.length - same.length,
    };
  }, [verses]);

  const columns: ColumnKey[] = useMemo(
    () => (pick === "chorus" ? QA_COLUMNS.map((c) => c.key) : [pick]),
    [pick],
  );

  const ask = useCallback(
    async (retry = false) => {
      if (!target || asking) return;
      const q = question.trim();
      if (!q) {
        flash("질문을 적어 주세요.");
        return;
      }
      setAsking(true);
      if (!retry) setResult(null);
      const res = await askBibleQa({
        bookCode: target.bookCode,
        chapter: target.chapter,
        verseStart: target.verseStart,
        verseEnd: target.verseEnd,
        version,
        question: q,
        columns,
        retry,
      });
      setResult(res);
      setSaved(false);
      setAsking(false);
      // 답이 오면 위부터 읽도록 되돌린다
      bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [target, asking, question, columns, version, flash],
  );

  const handleSave = useCallback(async () => {
    if (!result || result.kind === "error") return;
    const ok = await setQaSaved(result.id, true);
    if (ok) {
      setSaved(true);
      flash("저장했습니다. 이 절에서 다시 볼 수 있습니다.");
    } else {
      flash("저장하지 못했습니다.");
    }
  }, [result, flash]);

  const handleReport = useCallback(
    async (answer: QaAnswer) => {
      if (!result || result.kind !== "answered") return;
      const ok = await reportQaAnswer(result.id, answer.column);
      if (ok) {
        setReported((prev) => ({ ...prev, [answer.column]: true }));
        flash("알려 주셔서 고맙습니다. 관리자가 확인합니다.");
      } else {
        flash("신고를 보내지 못했습니다.");
      }
    },
    [result, flash],
  );

  const handleHandoff = useCallback(
    async (answer: QaAnswer) => {
      if (!target) return;
      const text = handoffText({
        versesRef: target.ref,
        versionName: getVersionLabel(version as never),
        versesText: target.text,
        question: question.trim(),
        answer: answer.content ?? "",
        label: answer.label,
      });
      // 주소로 못 넣는 AI 도 있으니 전문은 언제나 클립보드에 넣는다.
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
      const url = handoffUrl(answer.column, text);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      if (supportsPrefill(answer.column)) {
        flash(`${answer.label} 창에 옮겼습니다.`);
      } else if (copied) {
        flash(`${answer.label} 는 주소로 못 옮겨 복사해 두었습니다. 붙여넣기 해 주세요.`);
      } else {
        flash(`${answer.label} 창을 열었습니다. 내용을 직접 옮겨 주세요.`);
      }
    },
    [target, question, version, flash],
  );

  if (!target) return null;

  const answered = result?.kind === "answered" ? result : null;
  const isChorus = answered?.mode === "chorus";

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/50 flex items-end sm:items-center sm:justify-center animate-[fadeInUp_0.2s_ease-out]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-3xl h-[80vh] sm:h-[78vh] sm:min-h-[420px] sm:max-h-[90vh] sm:resize-y sm:overflow-auto bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 머리 — 고른 절 */}
        <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-[var(--line)] dark:border-gray-700 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <b className="text-sm font-bold text-gray-900 dark:text-gray-100">{target.ref}</b>
              <em className="not-italic text-[11px] text-gray-400">
                {getVersionLabel(version as never)}
              </em>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2">
              {target.text}
            </p>
            {target.dropped > 0 && (
              <p className="mt-0.5 text-[10.5px] text-gray-400">
                다른 장에서 고른 {target.dropped}절은 이 질문에 넣지 않았습니다.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="닫기"
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        {/* 몸 */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3">
          {/* AI 고르기 — 답을 받은 뒤에는 바꿀 수 없다(앱은 한 번만 답한다) */}
          {!result && (
            <div className="flex gap-1.5 mb-3" role="group" aria-label="AI 고르기">
              {QA_COLUMNS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setPick(c.key);
                    savePick(c.key);
                  }}
                  className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                    pick === c.key
                      ? "bg-[var(--amber)] text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:brightness-95"
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPick("chorus");
                  savePick("chorus");
                }}
                className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                  pick === "chorus"
                    ? "bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:brightness-95"
                }`}
              >
                합창
              </button>
            </div>
          )}

          {/* 묻기 전 — 입력 */}
          {!result && (
            <>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, QUESTION_MAX_LENGTH))}
                rows={5}
                autoFocus
                placeholder="이 말씀을 읽다가 생긴 질문을 적어 주세요."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-sm text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--amber)]"
              />
              <div className="mt-1 flex items-center justify-between">
                <p className="text-[10.5px] leading-snug text-gray-400 pr-2">{EXTERNAL_NOTICE}</p>
                <span className="shrink-0 text-[10.5px] text-gray-400 tabular-nums">
                  {question.length}/{QUESTION_MAX_LENGTH}
                </span>
              </div>
              <button
                onClick={() => ask(false)}
                disabled={asking || question.trim().length === 0}
                className="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--amber)] text-white hover:bg-[var(--amber-deep)] disabled:opacity-40 disabled:hover:bg-[var(--amber)]"
              >
                {asking
                  ? pick === "chorus"
                    ? "세 AI 가 찾고 있습니다…"
                    : "찾고 있습니다…"
                  : pick === "chorus"
                    ? "세 AI 에게 묻기"
                    : `${QA_COLUMNS.find((c) => c.key === pick)?.label} 에게 묻기`}
              </button>
              {asking && (
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  성경을 찾아 답을 만드는 데 10초쯤 걸립니다.
                </p>
              )}
            </>
          )}

          {/* 내 질문 (답을 받은 뒤) */}
          {result && result.kind !== "error" && (
            <div className="mb-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-[var(--line)] dark:border-gray-700 p-3">
              <div className="text-[10.5px] font-semibold text-gray-400 mb-1">내 질문</div>
              <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                {question.trim()}
              </p>
            </div>
          )}

          {/* 위기 — AI 를 부르지 않는다 */}
          {result?.kind === "crisis" && (
            <div>
              <p className="text-[15px] font-bold text-gray-900 dark:text-gray-100">
                {result.heading}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                {result.body}
              </p>
              <div className="mt-3 space-y-1.5">
                {result.lines.map((line) => {
                  const number = (line.body.match(/[\d-]{3,}/) ?? [])[0] ?? "";
                  return (
                    <a
                      key={line.title}
                      href={number ? `tel:${number.replace(/-/g, "")}` : undefined}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] dark:border-gray-700 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-200">
                        {line.title}
                      </span>
                      <span className="text-[13px] font-bold text-[var(--amber-deep)] tabular-nums">
                        {line.body}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* 거절 — 창을 닫지 않고 다시 물을 수 있어야 한다 */}
          {result?.kind === "refused" && (
            <>
              <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
                {result.message}
              </p>
              <button
                onClick={() => setResult(null)}
                className="mt-3 px-4 py-2 rounded-xl text-[12.5px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                다시 묻기
              </button>
            </>
          )}

          {/* 실패 */}
          {result?.kind === "error" && (
            <div className="py-6 text-center">
              <p className="text-[13px] text-gray-600 dark:text-gray-300">{result.message}</p>
              <button
                onClick={() => setResult(null)}
                className="mt-3 px-4 py-2 rounded-xl text-[12.5px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                다시 쓰기
              </button>
            </div>
          )}

          {/* 답 */}
          {answered && (
            <>
              {isChorus && (
                <p className="mb-2.5 text-[11.5px] text-center text-gray-500 dark:text-gray-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg py-1.5 px-2">
                  {DIVERGENCE_NOTE}
                </p>
              )}
              <div className={isChorus ? "sm:grid sm:grid-cols-3 sm:gap-2.5" : ""}>
                {answered.answers.map((a) => (
                  <AnswerCard
                    key={a.column}
                    answer={a}
                    // 합창은 요약만 먼저 보이고 나머지를 접는다(§B-8). 하나만 물었으면 다 펼친다.
                    open={isChorus ? !!expanded[a.column] : true}
                    onToggle={() =>
                      setExpanded((prev) => ({ ...prev, [a.column]: !prev[a.column] }))
                    }
                    collapsible={isChorus}
                    reported={!!reported[a.column]}
                    onReport={() => handleReport(a)}
                    onHandoff={() => handleHandoff(a)}
                  />
                ))}
              </div>
              <p className="mt-2.5 text-[10.5px] leading-snug text-gray-400">{DISCLAIMER}</p>
            </>
          )}
        </div>

        {/* 발 — 답을 받았을 때만 저장·버리기.
            위기·거절 화면에는 고를 것을 두지 않는다. 특히 위기에 있는 사람에게
            '저장할까 버릴까' 를 묻는 것은 그 순간에 필요 없는 결정이다. */}
        {answered && (
          <div className="shrink-0 px-4 py-2.5 border-t border-[var(--line)] dark:border-gray-700 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              버리기
            </button>
            <button
              onClick={handleSave}
              disabled={saved}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--amber)] text-white hover:bg-[var(--amber-deep)] disabled:opacity-50"
            >
              {saved ? "저장됨" : "저장"}
            </button>
          </div>
        )}
        {(result?.kind === "crisis" || result?.kind === "refused") && (
          <div className="shrink-0 px-4 py-2.5 border-t border-[var(--line)] dark:border-gray-700">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              닫기
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-3 py-2 bg-amber-600 text-white text-[12.5px] rounded-lg shadow-lg z-[200]">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── 답 한 칸 ─────────────────────────────────────────────────────

function AnswerCard({
  answer,
  open,
  onToggle,
  collapsible,
  reported,
  onReport,
  onHandoff,
}: {
  answer: QaAnswer;
  open: boolean;
  onToggle: () => void;
  collapsible: boolean;
  reported: boolean;
  onReport: () => void;
  onHandoff: () => void;
}) {
  const parsed = useMemo(() => parseAnswer(answer.content ?? ""), [answer.content]);
  const summary = parsed.sections.find((s) => s.heading === "한 줄 요약");
  const rest = parsed.sections.filter((s) => s.heading !== "한 줄 요약");

  return (
    <article className="mb-2.5 rounded-xl border border-[var(--line)] dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
      <header className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-[var(--line)] dark:border-gray-700">
        <span className="text-[11.5px] font-bold text-gray-700 dark:text-gray-200">
          {answer.label}
        </span>
        {answer.model && (
          <small className="text-[10px] text-gray-400 truncate">{answer.model}</small>
        )}
        <span className="flex-1" />
        {answer.ok && (
          <small className="text-[10px] text-gray-400 tabular-nums">
            {(answer.elapsed_ms / 1000).toFixed(1)}초
          </small>
        )}
      </header>

      {!answer.ok ? (
        <div className="px-3 py-3">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            이 AI 는 답하지 못했습니다. 다른 칸의 답을 보아 주세요.
          </p>
          {/* 왜 비었는지 교인에게 기술 용어로 말하지 않는다. 사유는 기록에 남는다. */}
        </div>
      ) : (
        <div className="px-3 py-2.5">
          {parsed.wellFormed ? (
            <>
              {summary && (
                <p className="text-[13px] font-semibold leading-relaxed text-gray-900 dark:text-gray-100">
                  {summary.body}
                </p>
              )}
              {(open || !collapsible) && (
                <dl className="mt-2 space-y-2">
                  {rest.map((s) => (
                    <div key={s.heading}>
                      <dt className="text-[10.5px] font-bold text-gray-400 mb-0.5">{s.heading}</dt>
                      <dd className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                        {s.body}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {collapsible && (
                <button
                  onClick={onToggle}
                  className="mt-1.5 text-[11.5px] font-semibold text-[var(--amber-deep)]"
                >
                  {open ? "접기" : "더 보기"}
                </button>
              )}
            </>
          ) : (
            // 네 줄 틀을 못 맞춘 답도 통째로 보인다 — 글을 잃어버리지 않는다.
            <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
              {answer.content}
            </p>
          )}

          {/* §B-9 답에 나온 구절의 본문은 앱이 붙인다 */}
          {(open || !collapsible) && answer.refs && answer.refs.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {answer.refs.map((r) => (
                <div
                  key={r.ref}
                  className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-[var(--line)] dark:border-gray-700 px-2.5 py-2"
                >
                  <div className="text-[10px] font-bold text-gray-400 mb-0.5">{r.ref}</div>
                  <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                    {r.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 좁은 칸(PC 3분할)에서는 두 줄로 내려간다 — 낱말 가운데서 끊기지 않게 flex-wrap 을 쓴다 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-t border-[var(--line)] dark:border-gray-700">
        {answer.ok && (
          <button
            onClick={onHandoff}
            className="whitespace-nowrap text-[11.5px] font-semibold text-gray-600 dark:text-gray-300 hover:text-[var(--amber-deep)]"
          >
            {answer.label} 로 이어가기 ↗
          </button>
        )}
        <button
          onClick={onReport}
          disabled={reported}
          className="ml-auto whitespace-nowrap text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-60"
        >
          {reported ? "알렸습니다" : "이 답이 이상합니다"}
        </button>
      </div>
    </article>
  );
}
