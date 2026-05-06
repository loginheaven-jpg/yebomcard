/**
 * 책갈피 — 마지막으로 읽던 성경 위치
 * localStorage 기반 (1단계). 향후 Supabase user_bookmarks 테이블로 확장 가능.
 */

import type { BibleVersion } from "./types";

const KEY = "yebom_bookmark";

export interface Bookmark {
  book_code: string;
  book_name: string;
  book_abbr: string;
  chapter: number;
  verse?: number;
  version: BibleVersion;
  savedAt: number;
}

export function readBookmark(): Bookmark | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Bookmark;
  } catch {
    return null;
  }
}

export function saveBookmark(bm: Omit<Bookmark, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    const next: Bookmark = { ...bm, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* silent */ }
}

export function clearBookmark() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch {}
}

/** "5분 전", "어제", "3일 전" 등 사용자 친화적 표현 */
export function formatRelativeTime(savedAt: number): string {
  const diff = Date.now() - savedAt;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "어제";
  if (day < 7) return `${day}일 전`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}주 전`;
  const date = new Date(savedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
