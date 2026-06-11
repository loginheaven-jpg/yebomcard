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
  updated_at: string;
}

export async function fetchChapterNotes(
  bookCode: string,
  chapter: number
): Promise<VerseNote[]> {
  try {
    const res = await fetch(
      `/api/verse-notes?book=${encodeURIComponent(bookCode)}&chapter=${chapter}`
    );
    if (!res.ok) return [];
    const { notes } = await res.json();
    return notes || [];
  } catch {
    return [];
  }
}

export async function saveVerseNote(input: {
  book_code: string;
  chapter: number;
  verse: number;
  color?: string | null;
  note?: string | null;
  version: BibleVersion;
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
