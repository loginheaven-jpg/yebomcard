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
  | { kind: "answered"; id: number; mode: "single" | "chorus"; disclaimer: string; answers: QaAnswer[] }
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
