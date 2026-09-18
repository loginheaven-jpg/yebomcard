/**
 * 성경 질문 — 클라이언트 쪽 얇은 껍데기
 *
 * 이 저장소 관습은 `lib/<기능>.ts` 가 fetch 를 감싸고 컴포넌트는 그 함수만 부르는 것이다.
 * 다만 **실패를 삼키지 않는다** — 묵상 노트와 달리 여기서는 교인이 답을 기다리고 있어서,
 * 조용히 빈 화면이 되면 무슨 일이 생겼는지 알 수 없다. 그래서 오류를 값으로 돌려준다.
 */
import type { ColumnKey } from "./columns";

export interface QaAnswer {
  column: ColumnKey;
  label: string;
  ok: boolean;
  content: string | null;
  model: string | null;
  error: string | null;
  elapsed_ms: number;
  /** 답에 나온 구절 — 서버가 확인하고 본문을 붙여 준다(§B-5·§B-9) */
  refs?: { ref: string; text: string }[];
}

export interface QaCrisisLine {
  title: string;
  body: string;
}

export type QaResult =
  | {
      kind: "pending";
      id: number;
      mode: "single" | "chorus";
      disclaimer: string;
      columns: { column: ColumnKey; label: string }[];
    }
  | { kind: "refused"; id: number; message: string }
  | { kind: "crisis"; id: number; heading: string; body: string; lines: QaCrisisLine[] }
  | { kind: "error"; message: string };

export interface AskInput {
  bookCode: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  version: string;
  question: string;
  columns: ColumnKey[];
  inputKind?: "text" | "voice";
  retry?: boolean;
}

export async function askBibleQa(input: AskInput): Promise<QaResult> {
  try {
    const res = await fetch("/api/bible-qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        book_code: input.bookCode,
        chapter: input.chapter,
        verse_start: input.verseStart,
        verse_end: input.verseEnd,
        version: input.version,
        question: input.question,
        columns: input.columns,
        input_kind: input.inputKind ?? "text",
        retry: input.retry ?? false,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { kind: "error", message: json.error || `요청이 실패했습니다 (${res.status})` };
    }
    return json as QaResult;
  } catch {
    // 오프라인·중간 끊김. 서버는 이미 기록을 남겼을 수도 있다.
    return { kind: "error", message: "연결이 끊겼습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}

/**
 * 2단계 — 한 칸의 답. 칸마다 **동시에** 부르고 먼저 온 것부터 그린다.
 * 실패도 값으로 돌려준다(그 칸만 '답하지 못했습니다' 로 보인다).
 */
export async function answerColumn(
  id: number,
  column: ColumnKey,
  label: string,
  signal?: AbortSignal,
): Promise<QaAnswer> {
  const failed = (msg: string): QaAnswer => ({
    column,
    label,
    ok: false,
    content: null,
    model: null,
    error: msg,
    elapsed_ms: 0,
  });
  try {
    const res = await fetch("/api/bible-qa/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, column }),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return failed(json.error || `HTTP ${res.status}`);
    return json as QaAnswer;
  } catch {
    return failed("연결이 끊겼습니다");
  }
}

/** 교인이 저장·버리기를 누른다. 저장한 것은 그 절에서 다시 볼 수 있다(§B-10). */
export async function setQaSaved(id: number, saved: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/bible-qa/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, saved }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** §B-6 '이 답이 이상합니다' */
export async function reportQaAnswer(
  questionId: number,
  column: ColumnKey,
  reason?: string,
): Promise<boolean> {
  try {
    const res = await fetch("/api/bible-qa/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, column, reason: reason ?? null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── 절에 저장해 둔 내 질문 ────────────────────────────────────────

export interface SavedQaAnswer {
  column_key: string;
  model: string | null;
  ok: boolean;
  content: string | null;
}

export interface SavedQa {
  id: number;
  verse_start: number;
  verse_end: number | null;
  verses_ref: string | null;
  question: string;
  mode: string;
  asked_at: string;
  ai_question_answers: SavedQaAnswer[];
}

/**
 * 이 장에서 내가 저장해 둔 질문. **장 단위로만 부른다** — 전체 페치 금지(노트와 같은 규칙).
 * 표가 없거나 비로그인이면 빈 배열이 온다(화면이 깨지지 않는다).
 */
export async function fetchChapterQas(bookCode: string, chapter: number): Promise<SavedQa[]> {
  try {
    const res = await fetch(
      `/api/bible-qa/saved?book=${encodeURIComponent(bookCode)}&chapter=${chapter}`,
    );
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.items) ? (json.items as SavedQa[]) : [];
  } catch {
    return [];
  }
}

// ─── '이 구절을 다룬 우리 교회 설교' 카드 ──────────────────────────

export interface SermonCard {
  id: number;
  preached_on: string;
  title: string;
  preacher: string | null;
  video_url: string | null;
  summary: string | null;
}

/**
 * 카드는 **질문 POST 와 같은 순간에 따로** 부른다(docs/BIBLE_QA_SERMONS.md).
 * 답을 받은 뒤에 부르면 (수 초 + 카드 시간)이 되어 라우트를 나눈 이득이 사라진다.
 * 절이 바뀔 때 먼저 떠난 응답이 새 절에 붙지 않게 `signal` 을 받는다.
 */
export async function fetchSermonCards(
  input: { bookCode: string; chapter: number; verseStart: number; verseEnd: number | null },
  signal?: AbortSignal,
): Promise<SermonCard[]> {
  try {
    const params = new URLSearchParams({
      book: input.bookCode,
      chapter: String(input.chapter),
      verse_start: String(input.verseStart),
    });
    if (input.verseEnd) params.set("verse_end", String(input.verseEnd));
    const res = await fetch(`/api/bible-qa/sermons?${params}`, { signal });
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.items) ? (json.items as SermonCard[]) : [];
  } catch {
    // 끊김·중단. 카드는 없어도 답은 그대로 보인다.
    return [];
  }
}
