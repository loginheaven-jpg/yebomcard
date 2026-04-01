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

export type SearchMode = "reference" | "chapter" | "word";

export type BibleVersion = "nkrv" | "rnksv";

export type ViewMode = "search" | "display";
