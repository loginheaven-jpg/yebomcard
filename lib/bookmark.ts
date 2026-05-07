/**
 * 책갈피 시스템 — 2종 분리
 * - Recent (자동, 단일): 마지막으로 읽던 위치. 본문 진입 후 자동 갱신
 * - Bookmarks (수동, 배열): 사용자가 명시적으로 추가한 책갈피들
 *
 * 1단계: localStorage 기반. 향후 Supabase user_bookmarks 테이블로 확장 가능.
 */

import type { BibleVersion } from "./types";

const RECENT_KEY = "yebom_recent";
const BOOKMARKS_KEY = "yebom_bookmarks";
const LEGACY_KEY = "yebom_bookmark"; // 이전 단일 슬롯 (Recent로 마이그레이션)

const MAX_BOOKMARKS = 30;

export interface BiblePosition {
  book_code: string;
  book_name: string;
  book_abbr: string;
  chapter: number;
  verse?: number;
  version: BibleVersion;
  subVersion?: BibleVersion | "none"; // 대역 버전 (구버전 책갈피 호환: optional)
  savedAt: number;
}

/** 호환용 별칭 — 기존 코드에서 Bookmark 타입 사용 */
export type Bookmark = BiblePosition & { id?: string };

// ─── 마이그레이션: yebom_bookmark → yebom_recent ───
function migrateLegacy() {
  if (typeof window === "undefined") return;
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    const recent = localStorage.getItem(RECENT_KEY);
    if (legacy && !recent) {
      localStorage.setItem(RECENT_KEY, legacy);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {}
}

// ─── Recent (자동 단일) ───

export function readRecent(): BiblePosition | null {
  if (typeof window === "undefined") return null;
  migrateLegacy();
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BiblePosition;
  } catch {
    return null;
  }
}

export function saveRecent(pos: Omit<BiblePosition, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    const next: BiblePosition = { ...pos, savedAt: Date.now() };
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

// ─── Bookmarks (수동 배열) ───

export function readBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeBookmarks(list: Bookmark[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {}
}

export function addBookmark(pos: Omit<Bookmark, "savedAt" | "id">): Bookmark[] {
  const list = readBookmarks();
  // 중복 체크 (같은 book+chapter+version)
  const dupIdx = list.findIndex(
    (b) =>
      b.book_code === pos.book_code &&
      b.chapter === pos.chapter &&
      b.version === pos.version
  );
  const next: Bookmark = {
    ...pos,
    id: crypto.randomUUID?.() ?? `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  if (dupIdx >= 0) {
    list.splice(dupIdx, 1); // 기존 제거 후 맨 위로
  }
  const updated = [next, ...list].slice(0, MAX_BOOKMARKS);
  writeBookmarks(updated);
  return updated;
}

export function removeBookmark(id: string): Bookmark[] {
  const list = readBookmarks().filter((b) => b.id !== id);
  writeBookmarks(list);
  return list;
}

// ─── 시간 포맷 ───

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
