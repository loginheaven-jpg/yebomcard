export interface BibleVerse {
  id: number;
  version: BibleVersion;
  book_code: string;
  book_name: string;
  book_abbr: string;
  book_order: number;
  testament: "old" | "new";
  chapter: number;
  verse: number;
  text: string;
}

export interface BilingualVerse {
  korean: BibleVerse;
  english: BibleVerse | null;
}

export type SearchMode = "search" | "chapter" | "topic";

export type KoreanVersion = "nkrv" | "rnksv" | "easy";
export type EnglishVersion = "kjv" | "nirv" | "gnt" | "web";
export type BibleVersion = KoreanVersion | EnglishVersion;

export type ViewMode = "search" | "display" | "card" | "scrap";

export interface ScrapItem {
  id: string;
  verses: {
    book_code: string;
    book_name: string;
    chapter: number;
    verse: number;
  }[];
  version: BibleVersion;
  savedAt: number;
  preview: string;
  reference: string;
}

export interface AIRecommendation {
  book: string;
  chapter: number;
  verse: number;
  preview: string;
}

/** 새번역 (주: ...) 주석을 제거한 텍스트 반환 — 선택완료 화면용 */
export function stripNotes(text: string): string {
  return text.replace(/\s*\(주\s*:[^)]*\)/g, "").trim();
}
