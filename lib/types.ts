export interface BibleVerse {
  id: number;
  version: "nkrv" | "rnksv" | "kjv";
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

export type BibleVersion = "nkrv" | "rnksv";

export type ViewMode = "search" | "display" | "card";

export interface AIRecommendation {
  book: string;
  chapter: number;
  verse: number;
  preview: string;
}
