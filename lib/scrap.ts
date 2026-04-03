import type { BibleVerse, BibleVersion, ScrapItem } from "./types";

const STORAGE_KEY = "yebom-scraps";
const MAX_SCRAPS = 100;

export function getScraps(): ScrapItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items: ScrapItem[] = JSON.parse(raw);
    return items.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/**
 * 스크랩 추가 (중복이면 시간만 업데이트)
 */
export function addScrap(verses: BibleVerse[], version: BibleVersion): ScrapItem {
  const scraps = getScraps();

  // 중복 체크: 같은 버전 + 같은 구절 세트
  const verseKey = verses
    .map((v) => `${v.book_code}.${v.chapter}.${v.verse}`)
    .sort()
    .join(",");

  const existing = scraps.find((s) => {
    const sKey = s.verses
      .map((v) => `${v.book_code}.${v.chapter}.${v.verse}`)
      .sort()
      .join(",");
    return s.version === version && sKey === verseKey;
  });

  if (existing) {
    existing.savedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scraps));
    return existing;
  }

  // 새 스크랩 생성
  const firstVerse = verses[0];
  const verseRange =
    verses.length === 1
      ? `${verses[0].verse}`
      : `${verses[0].verse}-${verses[verses.length - 1].verse}`;

  const newScrap: ScrapItem = {
    id: Date.now().toString(),
    verses: verses.map((v) => ({
      book_code: v.book_code,
      book_name: v.book_name,
      chapter: v.chapter,
      verse: v.verse,
    })),
    version,
    savedAt: Date.now(),
    preview: verses.map((v) => v.text).join(" ").slice(0, 40),
    reference: `${firstVerse.book_name} ${firstVerse.chapter}장 ${verseRange}절`,
  };

  scraps.unshift(newScrap);

  // 최대 개수 초과 시 가장 오래된 것 삭제
  if (scraps.length > MAX_SCRAPS) {
    scraps.splice(MAX_SCRAPS);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(scraps));
  return newScrap;
}

export function removeScrap(id: string): void {
  const scraps = getScraps().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scraps));
}

/**
 * 시간 표시: 오늘이면 상대시간, 다른 날이면 날짜+시간
 */
export function formatScrapTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const today = new Date();
  const date = new Date(timestamp);

  const isToday =
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate();

  if (isToday) {
    if (diff < 60_000) return "방금 전";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
    return `${Math.floor(diff / 3_600_000)}시간 전`;
  }

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${m}/${d} ${h}:${min}`;
}
