import type { BibleVersion } from "./types";
import { BOOKS, CHAPTER_COUNTS, TOTAL_CHAPTERS } from "./books";

// ─── 통독 진도 (서버 기반, reading_progress 테이블) ───
// 읽은 장을 자동 기록. "장 본문이 화면에 떴다 = 읽음"(SearchPanel 3초 트리거).
// localStorage 가 아닌 서버 저장이라 기기간 동기화.

export interface ReadChapter {
  book_code: string;
  chapter: number;
  read_at: string;
}

export async function fetchReadChapters(): Promise<ReadChapter[]> {
  try {
    const res = await fetch("/api/reading-progress");
    if (!res.ok) return [];
    const { progress } = await res.json();
    return progress || [];
  } catch {
    return [];
  }
}

export async function markChapterRead(
  bookCode: string,
  chapter: number,
  version: BibleVersion
): Promise<boolean> {
  try {
    const res = await fetch("/api/reading-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_code: bookCode, chapter, version }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resetReadingProgress(): Promise<boolean> {
  try {
    const res = await fetch("/api/reading-progress?all=1", { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── 진도 계산 (순수 함수) ───

export interface ProgressSummary {
  total: number;
  readCount: number;
  percent: number;
  ot: { total: number; readCount: number; percent: number };
  nt: { total: number; readCount: number; percent: number };
  /** book_code → 읽은 장 번호 Set (권별 dot grid 용) */
  readByBook: Record<string, Set<number>>;
}

const OT_TOTAL = BOOKS.filter((b) => b.testament === "old").reduce(
  (sum, b) => sum + (CHAPTER_COUNTS[b.code] || 0),
  0
);
const NT_TOTAL = TOTAL_CHAPTERS - OT_TOTAL;

const pct = (n: number, total: number) =>
  total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

export function computeProgress(read: ReadChapter[]): ProgressSummary {
  const readByBook: Record<string, Set<number>> = {};
  for (const r of read) {
    const max = CHAPTER_COUNTS[r.book_code];
    // 알 수 없는 책코드 또는 범위 밖 장(데이터 이상) 은 집계 제외
    if (!max || r.chapter < 1 || r.chapter > max) continue;
    (readByBook[r.book_code] ??= new Set()).add(r.chapter);
  }

  let otRead = 0;
  let ntRead = 0;
  for (const b of BOOKS) {
    const cnt = readByBook[b.code]?.size || 0;
    if (b.testament === "old") otRead += cnt;
    else ntRead += cnt;
  }
  const readCount = otRead + ntRead;

  return {
    total: TOTAL_CHAPTERS,
    readCount,
    percent: pct(readCount, TOTAL_CHAPTERS),
    ot: { total: OT_TOTAL, readCount: otRead, percent: pct(otRead, OT_TOTAL) },
    nt: { total: NT_TOTAL, readCount: ntRead, percent: pct(ntRead, NT_TOTAL) },
    readByBook,
  };
}
