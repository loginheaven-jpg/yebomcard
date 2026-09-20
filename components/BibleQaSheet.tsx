"use client";

/**
 * 성경 질문 — 절을 고르고 '질문' 을 누르면 열리는 창
 *
 * 재가받은 시안: docs/tasks/성경질문_화면시안.html
 * 규칙: docs/BIBLE_QA_DOCTRINE.md §B (앱이 맡는 몫)
 *  - §B-2 면책 문구는 앱이 한 번만 붙인다
 *  - §B-3 여러 답 위에 '갈리는 대목' 한 줄
 *  - §B-6 답마다 '이 답이 이상합니다'
 *  - §B-7 입력창 아래 주의 한 줄 · 외부 전송 고지
 *  - §B-8 긴 답은 한 줄 요약만 먼저 보이고 나머지는 접는다
 *  - §B-9 답에 나온 구절의 본문은 앱이 붙인다(서버가 확인해 보내 준다)
 *
 * **AI 를 고르지 않는다**(지휘부 2026-09-19, §B-3-1). '묻기' 하나만 있고, 서버가 선별 결과로 칸을 정한다 —
 * 늘 Gemini · ChatGPT 두 칸, 교리가 걸린 질문이면 Claude 까지 세 칸. (예전에는 AI 단추 넷 — Gemini ·
 * ChatGPT · Claude · 합창 — 이 곧 '묻기' 였고 마지막에 고른 것을 기억했다.)
 * 화면은 폰에서 위에서 아래로 카드, PC 에서 좌우로 칸(지휘부 2026-09-18).
 * **앱은 한 번만 답한다** — 이어서 묻고 싶으면 그 AI 로 넘긴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";
import { useQaVoiceInput } from "@/hooks/useQaVoiceInput";
import { stripNotes, type BibleVerse } from "@/lib/types";
import { getVersionLabel } from "@/lib/versions";
import { QA_COLUMNS, type ColumnKey } from "@/lib/bibleQa/columns";
import {
  AUTO_SEND_SECONDS,
  CAUTION_NOTICE,
  DISCLAIMER,
  DIVERGENCE_NOTE,
  EXTERNAL_NOTICE,
  QUESTION_MAX_LENGTH,
} from "@/lib/bibleQa/texts";
import {
  handoffText,
  handoffUrl,
  isHandoffTruncated,
  parseAnswer,
  supportsPrefill,
} from "@/lib/bibleQa/answerFormat";
import {
  answerColumn,
  askBibleQa,
  fetchChapterQas,
  fetchSermonCards,
  reportQaAnswer,
  setQaSaved,
  type QaAnswer,
  type QaResult,
  type SavedQa,
  type SermonCard,
} from "@/lib/bibleQa/client";

/**
 * 다른 AI 로 이어가기 — 떠나기 **전에** 띄우는 안내(지휘부 2026-09-18).
 * 예전에는 새 창을 연 뒤 떠나온 창에 안내를 띄워 교인이 보지 못했고, Gemini 는 빈 대화창으로만 넘어갔다.
 */
interface HandoffState {
  column: ColumnKey;
  label: string;
  url: string | null;
  text: string;
  copied: boolean;
  truncated: boolean;
}

/** 저장해 둔 답을 카드가 읽는 꼴로 */
function savedToAnswer(a: SavedQa["ai_question_answers"][number]): QaAnswer {
  const col = QA_COLUMNS.find((c) => c.key === a.column_key);
  return {
    column: (col?.key ?? "gemini") as ColumnKey,
    label: col?.label ?? a.column_key,
    ok: a.ok,
    content: a.content,
    model: a.model,
    error: null,
    elapsed_ms: 0,
    refs: [],
  };
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

  /** 이어가기 안내 — 떠나기 전에 보인다. 열린 동안 뒤로가기는 안내만 닫는다. */
  const [handoff, setHandoff] = useState<HandoffState | null>(null);

  /**
   * 이 절에 이미 저장해 둔 질문(지휘부 2026-09-18 — "이미 응답이 저장된 구절에서 질문을 눌렀을 때,
   * 기존 저장된 응답을 물고 들어가야"). 묻기 전 화면 맨 위에 접어서 보인다.
   * 앱은 한 번만 답한다 — 저장한 답은 다시 읽거나 그 AI 로 이어가는 데 쓴다.
   */
  const [savedHere, setSavedHere] = useState<SavedQa[]>([]);
  const [savedOpen, setSavedOpen] = useState<Set<number>>(new Set());

  useHardwareBack(true, onClose);
  useHardwareBack(!!handoff, () => setHandoff(null));

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
   *
   * 글이 오면 **세고 나서 스스로 묻는다**(§B-13, 지휘부 2026-09-21) — 말로 묻는 분이
   * 다시 화면을 찾아 누르지 않게. 글은 입력창에 보이는 채로 세므로 '보고 있다' 는 지켜진다.
   */
  const [autoSend, setAutoSend] = useState<number | null>(null);
  const voice = useQaVoiceInput(
    useCallback(
      (text: string) => {
        setUsedVoice(true);
        setQuestion((prev) => {
          const joined = prev.trim() ? `${prev.trim()} ${text.trim()}` : text.trim();
          return joined.slice(0, QUESTION_MAX_LENGTH);
        });
        setAutoSend(AUTO_SEND_SECONDS);
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

  // 이 절에 저장해 둔 질문 — 창이 열릴 때 한 번 읽는다(장 단위로 읽고 고른 범위와 겹치는 것만).
  // 검색 결과 화면처럼 본문 화면이 아닌 곳에서 열려도 보이도록 창이 스스로 읽는다.
  useEffect(() => {
    if (!target) return;
    let alive = true;
    const from = target.verseStart;
    const to = target.verseEnd ?? target.verseStart;
    fetchChapterQas(target.bookCode, target.chapter).then((items) => {
      if (!alive) return;
      setSavedHere(
        items.filter((q) => {
          const qs = q.verse_start;
          const qe = q.verse_end ?? q.verse_start;
          return qs <= to && qe >= from;
        }),
      );
    });
    return () => {
      alive = false;
    };
  }, [target]);

  /**
   * 묻는다. 어느 AI 가 답할지는 서버가 선별 결과로 정한다(§B-3-1) — 1단계 응답의 `columns` 를 따른다.
   */
  const ask = useCallback(
    async () => {
      if (!target || asking) return;
      const q = question.trim();
      if (!q) {
        flash("질문을 적어 주세요.");
        return;
      }
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

  /**
   * 말로 물었을 때의 자동 제출 셈. 1초마다 줄고 0 이 되면 스스로 묻는다.
   * `ask` 는 글자를 칠 때마다 새로 만들어지므로 **ref 로 최신 것을 부른다** —
   * 의존성에 넣으면 한 글자 고칠 때마다 셈이 처음부터 다시 돈다.
   */
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);
  useEffect(() => {
    if (autoSend === null) return;
    // 셈도 묻는 것도 **타이머 안에서** 한다 — effect 본문에서 곧바로 상태를 바꾸면
    // 렌더가 연쇄한다(react-hooks/set-state-in-effect, 저장소 공통 규칙).
    const t = window.setTimeout(() => {
      if (autoSend <= 1) {
        setAutoSend(null);
        void askRef.current();
      } else {
        setAutoSend(autoSend - 1);
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [autoSend]);
  /** 셈을 멈춘다 — '잠깐, 고칠게요' · 입력창을 건드림 · 다시 말하기 */
  const stopAutoSend = useCallback(() => setAutoSend(null), []);

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

  /**
   * '이 답이 이상합니다'. 지금 받은 답이면 이번 질문 id, 저장해 둔 답이면 그 질문 id 로 보낸다
   * (서버가 자기 질문인지 확인한다). `key` 는 화면에서 '알렸습니다' 를 칠할 자리다.
   */
  const reportAnswer = useCallback(
    async (questionId: number, answer: QaAnswer, key: string) => {
      const ok = await reportQaAnswer(questionId, answer.column);
      if (ok) {
        setReported((prev) => ({ ...prev, [key]: true }));
        flash("알려 주셔서 고맙습니다. 관리자가 확인합니다.");
      } else {
        flash("신고를 보내지 못했습니다.");
      }
    },
    [flash],
  );

  const handleReport = useCallback(
    async (answer: QaAnswer) => {
      if (!result || result.kind !== "pending") return;
      await reportAnswer(result.id, answer, answer.column);
    },
    [result, reportAnswer],
  );

  /**
   * 이어가기 1단계 — 복사하고 **안내를 먼저 띄운다**. 창은 아직 열지 않는다.
   *
   * 예전에는 복사 뒤 곧바로 새 창을 열고 안내 토스트를 **떠나온 창에** 띄워 교인이 보지 못했다
   * (지휘부 2026-09-18 — "조용히 공백의 대화창으로 인도한다"). 게다가 `await` 뒤에 창을 열면
   * 아이폰 사파리는 사용자 동작이 끊긴 것으로 보고 새 창을 막는다 — 창은 안내의 '열기' 를 누를 때 연다.
   *
   * `questionText` 는 저장해 둔 질문으로 이어갈 때 넘긴다(없으면 지금 입력한 질문).
   */
  const handleHandoff = useCallback(
    async (answer: QaAnswer, questionText?: string) => {
      if (!target) return;
      const text = handoffText({
        versesRef: target.ref,
        versionName: getVersionLabel(version as never),
        versesText: target.text,
        question: (questionText ?? question).trim(),
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
      setHandoff({
        column: answer.column,
        label: answer.label,
        url: handoffUrl(answer.column, text),
        text,
        copied,
        truncated: supportsPrefill(answer.column) && isHandoffTruncated(text),
      });
    },
    [target, question, version],
  );

  /** 이어가기 2단계 — 안내의 '열기' 에서 **동기로** 연다(아이폰 팝업 차단을 피한다). */
  const openHandoff = useCallback(() => {
    if (handoff?.url) window.open(handoff.url, "_blank", "noopener,noreferrer");
    setHandoff(null);
  }, [handoff]);

  if (!target) return null;

  const answered = result?.kind === "pending" ? result : null;
  // 여러 칸이 답하는가 — 이제 늘 그렇다(두 칸, 교리 질문이면 세 칸). 칸 수는 서버가 정한다.
  const columnCount = answered?.columns.length ?? 0;
  const isChorus = columnCount > 1;
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
        className="w-full h-[80vh] sm:w-[90vw] sm:max-w-none sm:h-[90vh] sm:min-h-[420px] sm:max-h-[90vh] sm:resize-y sm:overflow-auto bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col relative"
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
              {/* 이 절에 저장해 둔 질문 — 접혀 있다. 앱은 한 번만 답하므로 여기서 이어 묻지는 않고,
                  다시 읽거나 그 AI 로 이어간다(지휘부 2026-09-18). */}
              {savedHere.length > 0 && (
                <div className="mb-3 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/60 dark:bg-violet-950/20 overflow-hidden">
                  <div className="px-3 py-2 text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">
                    이 절에 저장한 질문 {savedHere.length}개
                  </div>
                  {savedHere.map((q) => {
                    const open = savedOpen.has(q.id);
                    const shown = (q.ai_question_answers ?? []).filter((a) => a.ok && a.content);
                    return (
                      <div key={q.id} className="border-t border-violet-100 dark:border-violet-900/40">
                        <button
                          type="button"
                          onClick={() =>
                            setSavedOpen((prev) => {
                              const next = new Set(prev);
                              if (next.has(q.id)) next.delete(q.id);
                              else next.add(q.id);
                              return next;
                            })
                          }
                          className="w-full text-left px-3 py-2 flex items-start gap-1.5"
                          aria-expanded={open}
                        >
                          <span className="shrink-0" aria-hidden>
                            ❓
                          </span>
                          <span
                            className={`min-w-0 flex-1 text-[12.5px] leading-snug text-gray-700 dark:text-gray-200 ${
                              open ? "whitespace-pre-wrap break-words" : "truncate"
                            }`}
                          >
                            {q.question}
                          </span>
                          <span className="shrink-0 text-violet-400 select-none" aria-hidden>
                            {open ? "▾" : "▸"}
                          </span>
                        </button>
                        {open && (
                          <div className="px-3 pb-3">
                            {shown.length === 0 && (
                              <p className="text-[11.5px] text-gray-400">남아 있는 답이 없습니다.</p>
                            )}
                            {shown.map((raw) => {
                              const a = savedToAnswer(raw);
                              const key = `s${q.id}:${a.column}`;
                              return (
                                <AnswerCard
                                  key={key}
                                  answer={a}
                                  open
                                  onToggle={() => {}}
                                  collapsible={false}
                                  reported={!!reported[key]}
                                  onReport={() => reportAnswer(q.id, a, key)}
                                  onHandoff={() => handleHandoff(a, q.question)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <textarea
                value={question}
                onChange={(e) => {
                  stopAutoSend(); // 고치기 시작하면 자동 제출을 멈춘다
                  setQuestion(e.target.value.slice(0, QUESTION_MAX_LENGTH));
                }}
                onFocus={stopAutoSend}
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
                      onClick={() => {
                        stopAutoSend(); // 다시 말하려는 것이니 앞서 돌던 셈은 멈춘다
                        void voice.start();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:brightness-95"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                      </svg>
                      말로 묻기
                    </button>
                  )}
                  {voice.state === "recording" && (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-[12px] font-semibold text-red-600 dark:text-red-400">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
                          {/* 말이 끊기면 스스로 마감한다 — 마지막 몇 초는 셈을 보여 줘서
                              더 말할 분이 말을 이어 시계를 되돌릴 수 있게 한다(§B-13) */}
                          {voice.countdown !== null
                            ? `곧 마칩니다 ${voice.countdown}`
                            : `듣고 있습니다 ${voice.seconds}초`}
                        </span>
                        <button
                          onClick={voice.stop}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--amber)] text-white"
                        >
                          듣기 마감
                        </button>
                        <button
                          onClick={voice.cancel}
                          className="px-2.5 py-1.5 rounded-lg text-[12px] text-gray-500 dark:text-gray-400"
                        >
                          취소
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">
                        {voice.noisy
                          ? "주변이 시끄러워 자동 마감을 껐습니다. 다 말씀하시면 '듣기 마감' 을 눌러 주세요."
                          : "말씀을 마치고 잠시 쉬면 저절로 마칩니다."}
                      </p>
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
              {/* §B-7 주의 한 줄(지휘부 2026-09-19) — 묻기 **전에** 읽게 입력창 바로 아래, 외부 전송 고지 위에 둔다 */}
              <p className="mt-1.5 text-[11px] leading-snug font-medium text-[var(--amber-deep)] dark:text-amber-300">
                {CAUTION_NOTICE}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-[10.5px] leading-snug text-gray-400 pr-2">{EXTERNAL_NOTICE}</p>
                <span className="shrink-0 text-[10.5px] text-gray-400 tabular-nums">
                  {question.length}/{QUESTION_MAX_LENGTH}
                </span>
              </div>
              {/* '묻기' 하나 — 어느 AI 가 답할지는 서버가 정한다(§B-3-1).
                  입력창 바로 아래에 둔다: 창 맨 아래에 붙이면 폰 키보드에 가린다.
                  답을 받은 뒤에는 보이지 않는다(앱은 한 번만 답한다). */}
              {/* 말로 물었을 때의 자동 제출 셈(§B-13) — 글은 위 입력창에 보이는 채로 센다.
                  '보고 누른다' 의 **보는 것**은 그대로 두고, 누르는 것만 셈이 대신한다. */}
              {autoSend !== null && !asking && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--amber-tint)] px-3 py-2.5">
                  <span className="text-[12.5px] font-semibold text-[var(--amber-deep)] tabular-nums">
                    {autoSend}초 뒤에 묻습니다
                  </span>
                  <button
                    type="button"
                    onClick={stopAutoSend}
                    className="ml-auto shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white dark:bg-gray-800 text-[var(--ink-soft)] dark:text-gray-300 border border-[var(--line)] dark:border-gray-700"
                  >
                    잠깐, 고칠게요
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  stopAutoSend();
                  void ask();
                }}
                disabled={asking || question.trim().length === 0}
                className="mt-3 w-full py-2.5 rounded-xl text-[13.5px] font-semibold bg-[var(--amber)] text-white transition-colors hover:bg-[var(--amber-deep)] disabled:opacity-40 disabled:hover:bg-[var(--amber)]"
              >
                {asking ? `질문을 살피고 있습니다… ${waitedSec}초` : "묻기"}
              </button>
              {asking && (
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  {/* 게이트웨이가 느린 날은 선별에만 10~20초가 걸린다(2026-09-18 운영 실측).
                      '10초쯤' 이라고 적어 두면 그보다 늦을 때 멈춘 줄 안다. */}
                  질문을 먼저 살핍니다. 끝나면 AI 들의 답이 하나씩 도착합니다.
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
                  {/* Claude 가 더해졌으면 왜 칸이 셋인지 먼저 알린다(§B-3-1) */}
                  {answered.extended_note ? (
                    <>
                      {answered.extended_note}
                      <br />
                    </>
                  ) : null}
                  {DIVERGENCE_NOTE}
                </p>
              )}
              {/* 먼저 끝난 칸이 먼저 놓인다(도착 순서). 아직 안 온 칸은 뒤에 '찾고 있습니다' 로. */}
              {/* 나란히는 **폭이 넉넉할 때만**(1024px 이상) — 지휘부 "PC 에서 좌우폭이 충분하면
                  병렬로". 태블릿 폭에서 세 칸이면 한 칸이 200px 안팎이라 읽히지 않는다.
                  칸 수(둘 · 셋)에 맞춰 나눈다 — 두 칸을 세 칸 격자에 두면 오른쪽 1/3 이 빈다. */}
              <div
                className={
                  !isChorus
                    ? ""
                    : columnCount >= 3
                      ? "lg:grid lg:grid-cols-3 lg:gap-3 lg:items-start"
                      : "lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start"
                }
              >
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

      {/* 이어가기 안내 — 떠나기 **전에** 보인다. 창은 '열기' 를 누를 때 연다. */}
      {handoff && (
        <HandoffNotice handoff={handoff} onOpen={openHandoff} onCancel={() => setHandoff(null)} />
      )}

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
        {answer.ok && answer.elapsed_ms > 0 && (
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

// ─── 이어가기 안내 ─────────────────────────────────────────────────

/**
 * 다른 AI 로 넘어가기 **전에** 무엇을 하면 되는지 알려 준다(지휘부 2026-09-18).
 *
 *  - Gemini 는 주소로 내용을 미리 채울 수 없다 → 붙여넣기를 분명히 안내한다
 *  - ChatGPT·Claude 는 채워 주지만 가끔 빈 창으로 열린다는 보고가 있고, 글이 길면 앞부분만 채운다
 *  - 폰에서 'Ctrl+V' 는 뜻이 없다 — 폰은 '입력칸을 길게 눌러 붙여넣기'
 *  - 복사가 막힌 기기(권한·오래된 브라우저)에서는 글을 직접 보여 주어 손으로 복사하게 한다
 *  - 그 사이트에 로그인해야 이어서 물을 수 있다(계정이 없는 어르신이 많다)
 */
function HandoffNotice({
  handoff,
  onOpen,
  onCancel,
}: {
  handoff: HandoffState;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const touch =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const paste = touch ? "입력칸을 길게 눌러 '붙여넣기'" : "입력칸을 누르고 Ctrl+V 로 붙여넣기";
  const prefill = supportsPrefill(handoff.column);

  let how: string;
  if (!prefill) {
    how = `${handoff.label} 는 내용을 미리 채워 줄 수 없습니다. 창이 열리면 ${paste} 하세요.`;
  } else if (handoff.truncated) {
    how = `글이 길어 앞부분만 채워 둡니다. 창이 열리면 채워진 글을 지우고 ${paste} 하세요.`;
  } else {
    how = `창이 열리면 입력칸에 채워져 있습니다. 비어 있으면 ${paste} 하세요.`;
  }

  return (
    <div
      className="absolute inset-0 z-10 bg-black/40 flex items-end sm:items-center justify-center p-3 rounded-t-2xl sm:rounded-2xl"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${handoff.label} 로 이어가기`}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-bold text-gray-900 dark:text-gray-100">
          {handoff.label} 로 이어가기
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">
          {handoff.copied
            ? "질문과 답을 복사해 두었습니다."
            : "복사하지 못했습니다. 아래 글을 길게 눌러 모두 선택해 복사해 주세요."}
        </p>
        {!handoff.copied && (
          <textarea
            readOnly
            value={handoff.text}
            rows={5}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2 text-[11.5px] text-gray-700 dark:text-gray-200 resize-none"
          />
        )}
        <p className="mt-2 text-[13px] leading-relaxed text-gray-700 dark:text-gray-200">{how}</p>
        <p className="mt-2 text-[11.5px] leading-snug text-gray-400">
          {handoff.label} 사이트에 로그인돼 있어야 이어서 물을 수 있습니다.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={!handoff.url}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--amber)] text-white hover:bg-[var(--amber-deep)] disabled:opacity-40"
          >
            {handoff.label} 열기 ↗
          </button>
        </div>
      </div>
    </div>
  );
}
