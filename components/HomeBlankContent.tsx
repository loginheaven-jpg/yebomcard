"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import {
  formatRelativeTime,
  type BiblePosition,
  type Bookmark,
} from "@/lib/bookmark";
import { getVersionLabel } from "@/lib/versions";
import { stripNotes, type BibleVersion } from "@/lib/types";
import { VERSE_OF_DAY, todaysVerseIndex } from "@/lib/verseOfDay";

type PreviewMap = Record<string, string>;

const PREVIEW_CACHE_KEY = "yebom_preview_cache_v1";
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

function readPreviewCache(): PreviewMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { ts: number; data: PreviewMap };
    if (!parsed || typeof parsed.ts !== "number") return {};
    if (Date.now() - parsed.ts > PREVIEW_TTL_MS) return {};
    return parsed.data || {};
  } catch {
    return {};
  }
}

function writePreviewCache(data: PreviewMap) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      PREVIEW_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {}
}

function previewKey(version: string, book_code: string, chapter: number) {
  return `${version}-${book_code}-${chapter}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

interface Props {
  recent: BiblePosition | null;
  bookmarks: Bookmark[];
  mainVersion: BibleVersion;
  onJump: (pos: BiblePosition | Bookmark) => void;
  onOpenAllBookmarks: () => void;
}

export default function HomeBlankContent({
  recent,
  bookmarks,
  mainVersion,
  onJump,
  onOpenAllBookmarks,
}: Props) {
  const [previews, setPreviews] = useState<PreviewMap>(() => readPreviewCache());
  const [verseOfDay, setVerseOfDay] = useState<{
    text: string;
    ref: string;
  } | null>(null);

  const isEmpty = !recent && bookmarks.length === 0;
  const topBookmarks = useMemo(() => bookmarks.slice(0, 3), [bookmarks]);
  const todayIdx = useMemo(() => todaysVerseIndex(), []);
  const todayEntry = VERSE_OF_DAY[todayIdx];

  useEffect(() => {
    if (isEmpty) return;
    const targets: { version: string; book_code: string; chapter: number }[] = [];
    if (recent)
      targets.push({
        version: recent.version,
        book_code: recent.book_code,
        chapter: recent.chapter,
      });
    for (const b of topBookmarks) {
      targets.push({
        version: b.version,
        book_code: b.book_code,
        chapter: b.chapter,
      });
    }
    const seen = new Set<string>();
    const missing = targets.filter((t) => {
      const k = previewKey(t.version, t.book_code, t.chapter);
      if (previews[k]) return false;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        missing.map((t) =>
          supabase
            .from("bible_verses")
            .select("text")
            .eq("version", t.version)
            .eq("book_code", t.book_code)
            .eq("chapter", t.chapter)
            .eq("verse", 1)
            .maybeSingle(),
        ),
      );
      if (cancelled) return;
      const next = { ...previews };
      results.forEach((r, i) => {
        const text = (r as { data?: { text?: string } }).data?.text;
        if (text) {
          next[previewKey(missing[i].version, missing[i].book_code, missing[i].chapter)] =
            stripNotes(text);
        }
      });
      setPreviews(next);
      writePreviewCache(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isEmpty,
    recent,
    topBookmarks,
    previews,
  ]);

  useEffect(() => {
    if (!isEmpty) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("bible_verses")
        .select("text")
        .eq("version", mainVersion)
        .eq("book_code", todayEntry.book_code)
        .eq("chapter", todayEntry.chapter)
        .eq("verse", todayEntry.verse)
        .maybeSingle();
      if (cancelled) return;
      const text = (data as { text?: string } | null)?.text;
      if (!text) return;
      setVerseOfDay({
        text: stripNotes(text),
        ref: `${todayEntry.book_name} ${todayEntry.chapter}장 ${todayEntry.verse}절`,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isEmpty, mainVersion, todayEntry]);

  if (isEmpty) {
    return (
      <div className="mt-6 mb-8 max-w-md mx-auto px-2">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-amber-300 dark:border-amber-700 mb-3">
            <svg
              className="w-6 h-6 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <h2 className="italic font-[family-name:var(--font-playfair)] text-xl text-gray-800 dark:text-gray-100 mb-1">
            Welcome
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            말씀을 펼치면 자동으로
            <br />
            마지막 읽던 곳이 기억됩니다.
          </p>
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-5 bg-[#FDFBF6] dark:bg-gray-900">
          <div className="text-[10px] font-semibold tracking-wider text-amber-700 dark:text-amber-400 mb-2">
            빠른 시작
          </div>
          <ol className="text-xs text-gray-700 dark:text-gray-300 space-y-1.5 leading-relaxed">
            <li>
              <span className="font-semibold">1.</span>{" "}
              <span className="text-gray-500 dark:text-gray-400">성경목차</span>{" "}
              → 책 → 장 선택
            </li>
            <li>
              <span className="font-semibold">2.</span>{" "}
              <span className="text-gray-500 dark:text-gray-400">본문검색</span>{" "}
              → &quot;창1:1&quot; 또는 &quot;사랑&quot;
            </li>
            <li>
              <span className="font-semibold">3.</span>{" "}
              <span className="text-gray-500 dark:text-gray-400">주제추천</span>{" "}
              → &quot;감사&quot;, &quot;위로&quot; AI 추천
            </li>
          </ol>
        </div>

        {verseOfDay && (
          <div className="text-center mb-5">
            <div className="text-[10px] font-semibold tracking-wider text-gray-400 dark:text-gray-500 mb-2">
              오늘의 말씀
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-1 italic">
              &quot;{truncate(verseOfDay.text, 80)}&quot;
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              — {verseOfDay.ref}
            </p>
          </div>
        )}

        {verseOfDay && (
          <button
            onClick={() =>
              onJump({
                book_code: todayEntry.book_code,
                book_name: todayEntry.book_name,
                book_abbr: todayEntry.book_name.slice(0, 1),
                chapter: todayEntry.chapter,
                version: mainVersion,
                savedAt: Date.now(),
              } as BiblePosition)
            }
            className="w-full py-2.5 text-xs font-semibold text-white bg-[#B8860B] rounded-lg hover:bg-[#9A7009] active:scale-[0.98] transition-all"
          >
            본문 펼치기
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 mb-8 lg:grid lg:grid-cols-2 lg:gap-4">
      {recent && (
        <section className="mb-4 lg:mb-0">
          <div className="text-[10px] font-semibold tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">
            다시 펴기
          </div>
          <button
            onClick={() => onJump(recent)}
            className="w-full text-left border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-[#FDFBF6] dark:bg-gray-900 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm transition-all group"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                <span aria-hidden>⚡</span> 최근
              </span>
              <span className="text-[10px] text-gray-400">
                {formatRelativeTime(recent.savedAt)}
              </span>
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {recent.book_name} {recent.chapter}장
            </div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-3">
              {getVersionLabel(recent.version)}
              {recent.subVersion &&
                recent.subVersion !== "none" &&
                ` · 대역 ${getVersionLabel(recent.subVersion as BibleVersion)}`}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-4 min-h-[3em] italic">
              {previews[previewKey(recent.version, recent.book_code, recent.chapter)] ? (
                <>
                  &quot;
                  {truncate(
                    previews[previewKey(recent.version, recent.book_code, recent.chapter)],
                    60,
                  )}
                  &quot;
                </>
              ) : (
                <span className="text-gray-300 dark:text-gray-600">
                  — 미리보기 불러오는 중 —
                </span>
              )}
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B8860B] dark:text-amber-400 group-hover:gap-2 transition-all">
              <span>▶</span> 계속 읽기
            </div>
          </button>
        </section>
      )}

      {bookmarks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[10px] font-semibold tracking-wider text-gray-400 dark:text-gray-500">
              책갈피
            </div>
            {bookmarks.length > 3 && (
              <button
                onClick={onOpenAllBookmarks}
                className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-amber-700 dark:hover:text-amber-400"
              >
                모두 보기 ({bookmarks.length})
              </button>
            )}
          </div>
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            {topBookmarks.map((b) => {
              const preview = previews[previewKey(b.version, b.book_code, b.chapter)];
              return (
                <button
                  key={b.id ?? `${b.book_code}-${b.chapter}-${b.version}`}
                  onClick={() => onJump(b)}
                  className="w-full text-left px-3 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors flex items-start gap-2"
                >
                  <span className="text-amber-600 dark:text-amber-400 text-sm mt-0.5 shrink-0">
                    🔖
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {b.book_name} {b.chapter}장
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {formatRelativeTime(b.savedAt)}
                      </span>
                    </div>
                    {preview && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5 italic">
                        &quot;{truncate(preview, 36)}&quot;
                      </p>
                    )}
                  </div>
                  <span className="text-gray-300 dark:text-gray-600 text-xs shrink-0 mt-0.5">
                    →
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
