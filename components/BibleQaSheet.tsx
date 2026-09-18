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
 * **AI 단추가 곧 '묻기'** 다(지휘부 2026-09-18, 시안에서 바뀜) — 질문을 적고 AI 를 누르면 바로 묻는다.
 * 예전에는 위에서 AI 를 고르고 아래 '묻기' 를 한 번 더 눌러야 했다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";
import { useQaVoiceInput } from "@/hooks/useQaVoiceInput";
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
  answerColumn,
  askBibleQa,
  fetchSermonCards,
  reportQaAnswer,
  setQaSaved,
  type QaAnswer,
  type QaResult,
  type SermonCard,
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

/** 입력창 아래 묻기 단추 — 세 AI 와 합창(셋이 함께) */
const ASK_BUTTONS: { key: Pick; label: string }[] = [
  ...QA_COLUMNS.map((c) => ({ key: c.key as Pick, label: c.label })),
  { key: "chorus", label: "합창" },
];

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
  /** 저장했을 때 — 절 화면이 저장 목록을 다시 읽도록 알린다 */
  onSaved?: () => void;
}

export default function BibleQaSheet({ verses, version, onClose, onSaved }: Props) {
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
  // 말로 물었는지 기록에 남긴다(관리자 화면에서 '음성' 으로 보인다)
  const [usedVoice, setUsedVoice] = useState(false);
  // 이 구절을 다룬 우리 교회 설교. 답 **아래**에 붙는다 — 늦게 도착해도 읽는 중인 글이 밀리지 않게.
  const [sermons, setSermons] = useState<SermonCard[]>([]);
  const sermonAcRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * 칸마다 따로 받은 답. **먼저 끝난 칸부터** 그린다(지휘부 2026-09-18 —
   * "셋 다 동시에 보여 주기보다 완료된 것 먼저 차례로").
   * `arrival` 은 도착한 순서다 — 이 순서대로 카드를 놓는다.
   */
  const [answers, setAnswers] = useState<Partial<Record<ColumnKey, QaAnswer>>>({});
  const [arrival, setArrival] = useState<ColumnKey[]>([]);
  const answerAcRef = useRef<AbortController | null>(null);
  /** 기다린 초를 보여 주려고 — 게이트웨이가 느려 수십 초가 걸리는 일이 있다(운영 실측). */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useHardwareBack(true, onClose);

  // 창이 닫히면 카드·답 요청을 끊는다. 서버는 답을 끝까지 만들어 기록에 남긴다.
  useEffect(
    () => () => {
      sermonAcRef.current?.abort();
      answerAcRef.current?.abort();
    },
    [],
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  /**
   * 말로 묻기. 받은 글은 입력창에 **이어 붙인다** — 덮어쓰면 앞서 적어 둔 것이 사라지고,
   * 두 번 말해 보태는 길도 막힌다.
   */
  const voice = useQaVoiceInput(
    useCallback(
      (text: string) => {
        setUsedVoice(true);
        setQuestion((prev) => {
          const joined = prev.trim() ? `${prev.trim()} ${text.trim()}` : text.trim();
          return joined.slice(0, QUESTION_MAX_LENGTH);
        });
      },
      [],
    ),
  );

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

  /**
   * 누른 AI 에게 곧바로 묻는다. AI 단추가 곧 '묻기' 다(지휘부 2026-09-18) — 예전에는 위에서 AI 를
   * 고르고 아래 '묻기' 를 한 번 더 눌러야 했다. 누른 AI 는 기억해 다음에 채워진 단추로 보인다.
   */
  const ask = useCallback(
    async (choice: Pick) => {
      if (!target || asking) return;
      const q = question.trim();
      if (!q) {
        flash("질문을 적어 주세요.");
        return;
      }
      setPick(choice);
      savePick(choice);
      const columns: ColumnKey[] =
        choice === "chorus" ? QA_COLUMNS.map((c) => c.key) : [choice];
      setAsking(true);
      setResult(null);
      setAnswers({});
      setArrival([]);
      setExpanded({});
      setReported({});
      setSaved(false);
      setStartedAt(Date.now());
      setNow(Date.now());

      // **질문과 같은 순간에** 설교 카드를 따로 부른다. 답을 받은 뒤에 부르면
      // (수 초 + 카드 시간)이 되어 라우트를 나눈 이득이 클라이언트에서 사라진다.
      sermonAcRef.current?.abort();
      const sermonAc = new AbortController();
      sermonAcRef.current = sermonAc;
      const sermonsPromise = fetchSermonCards(
        {
          bookCode: target.bookCode,
          chapter: target.chapter,
          verseStart: target.verseStart,
          verseEnd: target.verseEnd,
        },
        sermonAc.signal,
      );

      // ── 1단계: 선별·기록 ──────────────────────────────────────────
      const res = await askBibleQa({
        bookCode: target.bookCode,
        chapter: target.chapter,
        verseStart: target.verseStart,
        verseEnd: target.verseEnd,
        version,
        question: q,
        columns,
        inputKind: usedVoice ? "voice" : "text",
      });
      setResult(res);
      setAsking(false);

      // **위기·거절 화면에서는 설교 카드를 절대 그리지 않는다.** 화면 조건만 두면
      // 요청은 나가고 상태에 남아 다음 렌더에서 튀어나온다 — 여기서 버린다.
      if (res.kind !== "pending") {
        sermonAc.abort();
        setSermons([]);
        setStartedAt(null);
        bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      void sermonsPromise.then((cards) => {
        if (!sermonAc.signal.aborted) setSermons(cards);
      });
      bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });

      // ── 2단계: 칸마다 따로 묻고, 먼저 끝난 것부터 그린다 ─────────────
      answerAcRef.current?.abort();
      const answerAc = new AbortController();
      answerAcRef.current = answerAc;
      let first = true;
      await Promise.all(
        res.columns.map(async ({ column, label }) => {
          const a = await answerColumn(res.id, column, label, answerAc.signal);
          if (answerAc.signal.aborted) return;
          setAnswers((prev) => ({ ...prev, [column]: a }));
          setArrival((prev) => (prev.includes(column) ? prev : [...prev, column]));
          // 합창은 요약만 먼저 보이고 나머지를 접는다(§B-8). 다만 **처음 도착한 답은 펼친다** —
          // 나머지를 기다리는 동안 읽을 것이 있어야 한다.
          if (first && a.ok) {
            first = false;
            setExpanded((prev) => ({ ...prev, [column]: true }));
          }
        }),
      );
      if (!answerAc.signal.aborted) setStartedAt(null);
    },
    [target, asking, question, version, flash, usedVoice],
  );

  // 기다리는 동안 초를 센다(선별 중, 또는 아직 안 온 칸이 있을 때).
  useEffect(() => {
    if (startedAt === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);

  const handleSave = useCallback(async () => {
    if (!result || result.kind !== "pending") return;
    const ok = await setQaSaved(result.id, true);
    if (ok) {
      setSaved(true);
      onSaved?.();
      flash("저장했습니다. 이 절에서 다시 볼 수 있습니다.");
    } else {
      flash("저장하지 못했습니다.");
    }
  }, [result, flash, onSaved]);

  const handleReport = useCallback(
    async (answer: QaAnswer) => {
      if (!result || result.kind !== "pending") return;
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

  const answered = result?.kind === "pending" ? result : null;
  const isChorus = answered?.mode === "chorus";
  const waitedSec = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const arrivedCount = arrival.length;
  /** 아직 오지 않은 칸 — 도착한 카드 뒤에 '찾고 있습니다' 자리로 놓는다 */
  const waitingColumns = answered
    ? answered.columns.filter((c) => !arrival.includes(c.column))
    : [];

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/50 flex items-end sm:items-center sm:justify-center animate-[fadeInUp_0.2s_ease-out]"
      onClick={onClose}
    >
      <div
        // 폰은 아래에서 올라오는 80% 시트, PC 는 화면의 가로·세로 90%(지휘부 2026-09-18 —
        // "PC 풀스크린에서도 좌우 여백이 많다"). 크기 조절(resize)은 그대로 둔다.
        className="w-full h-[80vh] sm:w-[90vw] sm:max-w-none sm:h-[90vh] sm:min-h-[420px] sm:max-h-[90vh] sm:resize-y sm:overflow-auto bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
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
          {/* 합창(세 칸)은 넓어진 폭을 다 쓴다. 하나만 묻거나 입력 중일 때는 **읽기 좋은 폭**으로
              가운데 둔다 — 90% 폭에서 한 줄이 150자를 넘으면 눈이 줄을 놓친다. */}
          <div className={isChorus ? "" : "sm:mx-auto sm:max-w-4xl"}>
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
              {/* 말로 묻기 — 글을 잘 못 쓰시는 어르신도 물을 수 있어야 한다.
                  들은 글은 입력창에 넣어 주고, 보내는 것은 교인이 누른다. */}
              {voice.supported && (
                <div className="mt-2">
                  {voice.state === "idle" && (
                    <button
                      onClick={() => voice.start()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:brightness-95"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                      </svg>
                      말로 묻기
                    </button>
                  )}
                  {voice.state === "recording" && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-[12px] font-semibold text-red-600 dark:text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
                        듣고 있습니다 {voice.seconds}초
                      </span>
                      <button
                        onClick={voice.stop}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--amber)] text-white"
                      >
                        다 말했습니다
                      </button>
                      <button
                        onClick={voice.cancel}
                        className="px-2.5 py-1.5 rounded-lg text-[12px] text-gray-500 dark:text-gray-400"
                      >
                        취소
                      </button>
                    </div>
                  )}
                  {voice.state === "sending" && (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400">
                      말씀을 글로 옮기고 있습니다…
                    </p>
                  )}
                  {voice.error && (
                    <p
                      className="mt-1 text-[11.5px] text-red-600 dark:text-red-400 cursor-pointer"
                      onClick={voice.clearError}
                    >
                      {voice.error}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[10.5px] leading-snug text-gray-400 pr-2">{EXTERNAL_NOTICE}</p>
                <span className="shrink-0 text-[10.5px] text-gray-400 tabular-nums">
                  {question.length}/{QUESTION_MAX_LENGTH}
                </span>
              </div>
              {/* AI 단추가 곧 '묻기' — 누르면 그 AI 에게 바로 묻는다(지휘부 2026-09-18).
                  입력창 바로 아래에 둔다: 창 맨 아래에 붙이면 폰 키보드에 가린다.
                  답을 받은 뒤에는 보이지 않는다(앱은 한 번만 답한다). */}
              <p className="mt-3 mb-1.5 text-[11.5px] font-semibold text-gray-500 dark:text-gray-400">
                {asking
                  ? `질문을 살피고 있습니다… ${waitedSec}초`
                  : "누구에게 물을까요? 누르면 바로 묻습니다"}
              </p>
              <div className="flex gap-1.5" role="group" aria-label="물을 AI">
                {ASK_BUTTONS.map((b) => {
                  const last = pick === b.key;
                  const chorus = b.key === "chorus";
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => ask(b.key)}
                      disabled={asking || question.trim().length === 0}
                      aria-label={chorus ? "세 AI 에게 함께 묻기" : `${b.label} 에게 묻기`}
                      className={`flex-1 min-w-0 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40 ${
                        last
                          ? chorus
                            ? "bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900"
                            : "bg-[var(--amber)] text-white hover:bg-[var(--amber-deep)] disabled:hover:bg-[var(--amber)]"
                          : "border border-[var(--amber)]/60 text-[var(--amber-deep)] dark:text-amber-300 bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-gray-700"
                      }`}
                    >
                      {asking && last ? "…" : b.label}
                    </button>
                  );
                })}
              </div>
              {asking && (
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  {/* 게이트웨이가 느린 날은 선별에만 10~20초가 걸린다(2026-09-18 운영 실측).
                      '10초쯤' 이라고 적어 두면 그보다 늦을 때 멈춘 줄 안다. */}
                  질문이 성경과 이어지는지 먼저 살핍니다. 끝나면 답이 하나씩 도착합니다.
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
              {/* 먼저 끝난 칸이 먼저 놓인다(도착 순서). 아직 안 온 칸은 뒤에 '찾고 있습니다' 로. */}
              {/* 세 칸 나란히는 **폭이 넉넉할 때만**(1024px 이상) — 지휘부 "PC 에서 좌우폭이 충분하면
                  병렬로". 태블릿 폭에서 세 칸이면 한 칸이 200px 안팎이라 읽히지 않는다. */}
              <div className={isChorus ? "lg:grid lg:grid-cols-3 lg:gap-3 lg:items-start" : ""}>
                {arrival.map((key) => {
                  const a = answers[key];
                  if (!a) return null;
                  return (
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
                  );
                })}
                {waitingColumns.map((c) => (
                  <div
                    key={c.column}
                    className="mb-2.5 rounded-xl border border-dashed border-[var(--line)] dark:border-gray-700 px-3 py-3 flex items-center gap-2"
                    aria-live="polite"
                  >
                    <span
                      className="w-2 h-2 rounded-full bg-[var(--amber)] animate-pulse shrink-0"
                      aria-hidden
                    />
                    <span className="text-[12px] font-semibold text-gray-600 dark:text-gray-300">
                      {c.label}
                    </span>
                    <span className="text-[11.5px] text-gray-400">
                      찾고 있습니다… {waitedSec}초
                    </span>
                  </div>
                ))}
              </div>
              {arrivedCount === 0 && (
                <p className="mb-2 text-center text-[11px] text-gray-400">
                  먼저 끝난 AI 의 답부터 차례로 보입니다.
                </p>
              )}
              {/* 이 구절을 다룬 우리 교회 설교 — AI 가 쓴 것이 아니다.
                  답 **아래**에 붙인다(늦게 도착해도 읽는 중인 글이 밀리지 않는다).
                  맞는 것이 없으면 아무것도 그리지 않는다 — '관련 설교 없음' 을 쓰지 않는다. */}
              {sermons.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10.5px] font-bold text-gray-400 mb-1">
                    이 구절을 다룬 우리 교회 설교
                  </div>
                  <div className="space-y-1.5">
                    {sermons.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-xl border border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5"
                      >
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <b className="text-[12.5px] font-bold text-gray-900 dark:text-gray-100">
                            {s.title}
                          </b>
                          <span className="text-[10.5px] text-gray-400">{s.preached_on}</span>
                          {s.preacher && (
                            <span className="text-[10.5px] text-gray-400">{s.preacher}</span>
                          )}
                        </div>
                        {s.summary && (
                          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                            {s.summary}
                          </p>
                        )}
                        {s.video_url && (
                          <a
                            href={s.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-1.5 text-[11.5px] font-semibold text-[var(--amber-deep)]"
                          >
                            설교 영상 보기 ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-2.5 text-[10.5px] leading-snug text-gray-400">{DISCLAIMER}</p>
            </>
          )}
          </div>
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
              // 답이 하나도 오기 전에는 저장할 것이 없다. 하나라도 오면 저장할 수 있고,
              // 뒤에 오는 답도 같은 질문에 붙어 저장한 곳에서 함께 보인다.
              disabled={saved || arrivedCount === 0}
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
