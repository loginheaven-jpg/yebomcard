import { stripNotes, type BibleVerse, type BibleVersion } from "./types";

// ─── 서버 기반 스크랩 (Supabase) ───

export interface ServerScrap {
  id: number;
  user_id: string;
  user_name: string;
  book_code: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  version: string;
  reference: string;
  preview: string;
  image_url?: string;
  created_at: string;
}

export interface CommunityScrap {
  book_code: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  version: string;
  reference: string;
  preview: string;
  image_url?: string;
  scrap_count: number;
  latest_at: string;
}

export async function fetchMyScraps(): Promise<ServerScrap[]> {
  try {
    const res = await fetch("/api/scrap");
    if (!res.ok) return [];
    const { scraps } = await res.json();
    return scraps || [];
  } catch {
    return [];
  }
}

export async function fetchCommunityScraps(): Promise<CommunityScrap[]> {
  try {
    const res = await fetch("/api/scrap/community");
    if (!res.ok) return [];
    const { scraps } = await res.json();
    return scraps || [];
  } catch {
    return [];
  }
}

export async function addScrapToServer(
  verses: BibleVerse[],
  version: BibleVersion,
  imageUrl?: string
): Promise<boolean> {
  const base = verses[0];
  // 같은 책+장의 절만 필터 → 절 번호순 정렬
  const sameChapter = verses
    .filter((v) => v.book_code === base.book_code && v.chapter === base.chapter)
    .sort((a, b) => a.verse - b.verse);
  if (sameChapter.length === 0) return false;

  const vStart = sameChapter[0].verse;
  const vEnd = sameChapter[sameChapter.length - 1].verse;
  const verseRange = vStart === vEnd ? `${vStart}` : `${vStart}-${vEnd}`;

  try {
    const res = await fetch("/api/scrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        book_code: base.book_code,
        chapter: base.chapter,
        verse_start: vStart,
        verse_end: vEnd,
        version,
        reference: `${base.book_name} ${base.chapter}장 ${verseRange}절`,
        preview: sameChapter
          .map((v) => stripNotes(v.text))
          .join(" ")
          .slice(0, 40),
        image_url: imageUrl,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeScrapFromServer(id: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/scrap?id=${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── localStorage 마이그레이션 ───

const OLD_STORAGE_KEY = "yebom-scraps";
const MIGRATED_KEY = "yebom-scraps-migrated";

interface OldScrapItem {
  id: string;
  verses: { book_code: string; book_name: string; chapter: number; verse: number }[];
  version: string;
  savedAt: number;
  preview: string;
  reference: string;
}

export async function migrateLocalScraps(): Promise<number> {
  if (typeof window === "undefined") return 0;
  if (localStorage.getItem(MIGRATED_KEY) === "1") return 0;

  const raw = localStorage.getItem(OLD_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATED_KEY, "1");
    return 0;
  }

  try {
    const oldScraps: OldScrapItem[] = JSON.parse(raw);
    let migrated = 0;

    for (const scrap of oldScraps) {
      if (scrap.verses.length === 0) continue;
      const first = scrap.verses[0];
      const last = scrap.verses[scrap.verses.length - 1];

      await fetch("/api/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_code: first.book_code,
          chapter: first.chapter,
          verse_start: first.verse,
          verse_end: last.verse,
          version: scrap.version,
          reference: scrap.reference,
          preview: scrap.preview,
        }),
      });
      migrated++;
    }

    localStorage.removeItem(OLD_STORAGE_KEY);
    localStorage.setItem(MIGRATED_KEY, "1");
    return migrated;
  } catch {
    return 0;
  }
}

// ─── 시간 포맷 ───

export function formatScrapTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - date.getTime();
  const today = new Date();

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
