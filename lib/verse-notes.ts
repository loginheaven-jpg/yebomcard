import type { BibleVersion } from "./types";

// ─── 묵상 노트·하이라이트 (서버 기반, verse_notes 테이블) ───
// 절 단위 개인 하이라이트(색) + 메모. 기기간 동기화.

export const HIGHLIGHT_COLORS = [
  { key: "yellow", label: "노랑", chip: "bg-yellow-300", tint: "bg-yellow-100 dark:bg-yellow-500/20" },
  { key: "pink", label: "분홍", chip: "bg-pink-300", tint: "bg-pink-100 dark:bg-pink-500/20" },
  { key: "blue", label: "파랑", chip: "bg-blue-300", tint: "bg-blue-100 dark:bg-blue-500/20" },
  { key: "green", label: "초록", chip: "bg-green-300", tint: "bg-green-100 dark:bg-green-500/20" },
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["key"];

/** 색 키 → 절 배경 tint className (없으면 빈 문자열) */
export function colorTint(color?: string | null): string {
  return HIGHLIGHT_COLORS.find((c) => c.key === color)?.tint ?? "";
}

export interface VerseNote {
  id: number;
  book_code: string;
  chapter: number;
  verse: number;
  color?: string | null;
  note?: string | null;
  version?: string | null;
  /** 공개 범위 — '홀로'|'목장'|'전체' (메모 공유용) */
  visibility?: string | null;
  updated_at: string;
}

/** 타인의 공개 메모(목장/전체) — 읽기 전용. 하이라이트 색은 공유하지 않음 */
export interface SharedNote {
  id: number;
  verse: number;
  note: string;
  user_id: string;
  user_name: string | null;
  group_id: string | null;
  visibility: string;
  created_at: string;
}

export async function fetchChapterNotes(
  bookCode: string,
  chapter: number
): Promise<{ notes: VerseNote[]; shared: SharedNote[] }> {
  try {
    const res = await fetch(
      `/api/verse-notes?book=${encodeURIComponent(bookCode)}&chapter=${chapter}`
    );
    if (!res.ok) return { notes: [], shared: [] };
    const data = await res.json();
    return { notes: data.notes || [], shared: data.shared || [] };
  } catch {
    return { notes: [], shared: [] };
  }
}

/** 타인 메모 신고 — 서로 다른 2명 누적 시 서버가 자동 임시숨김 */
export async function reportNote(noteId: number): Promise<{ ok: boolean; hidden?: boolean }> {
  try {
    const res = await fetch("/api/verse-notes/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_id: noteId }),
    });
    if (!res.ok) return { ok: false };
    const d = await res.json();
    return { ok: true, hidden: !!d.hidden };
  } catch {
    return { ok: false };
  }
}

export async function saveVerseNote(input: {
  book_code: string;
  chapter: number;
  verse: number;
  color?: string | null;
  note?: string | null;
  version: BibleVersion;
  /** 공개 범위 — 메모 저장 시 '홀로'|'목장'|'전체' (기본 목장) */
  visibility?: string;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/verse-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeVerseNote(
  bookCode: string,
  chapter: number,
  verse: number
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/verse-notes?book=${encodeURIComponent(bookCode)}&chapter=${chapter}&verse=${verse}`,
      { method: "DELETE" }
    );
    return res.ok;
  } catch {
    return false;
  }
}
