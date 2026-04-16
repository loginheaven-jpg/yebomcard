"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getBookByCode } from "@/lib/books";
import { stripNotes, type BibleVerse, type BilingualVerse } from "@/lib/types";
import { addScrapToServer } from "@/lib/scrap";
import FullscreenReader, { type FullscreenVerseItem } from "./FullscreenReader";

interface VerseDisplayProps {
  verses: BibleVerse[];
  onBack: () => void;
  onAddMore: () => void;
  onRemoveVerse: (verse: BibleVerse) => void;
  onCreateCard: () => void;
  onScrapSaved?: () => void;
  requireAuth?: () => boolean;
}

/**
 * 연속된 절을 그룹으로 묶기
 * 같은 책+장이면서 절이 연속이면 하나의 그룹
 */
interface VerseGroup {
  bookCode: string;
  bookName: string;
  chapter: number;
  verses: BibleVerse[];
  englishVerses: BibleVerse[];
}

function groupVerses(
  korean: BibleVerse[],
  english: BibleVerse[]
): VerseGroup[] {
  if (korean.length === 0) return [];

  const sorted = [...korean].sort((a, b) => {
    if (a.book_order !== b.book_order) return a.book_order - b.book_order;
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });

  const groups: VerseGroup[] = [];
  let current: VerseGroup = {
    bookCode: sorted[0].book_code,
    bookName: sorted[0].book_name,
    chapter: sorted[0].chapter,
    verses: [sorted[0]],
    englishVerses: [],
  };

  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    const prev = sorted[i - 1];
    if (
      v.book_code === prev.book_code &&
      v.chapter === prev.chapter &&
      v.verse === prev.verse + 1
    ) {
      current.verses.push(v);
    } else {
      groups.push(current);
      current = {
        bookCode: v.book_code,
        bookName: v.book_name,
        chapter: v.chapter,
        verses: [v],
        englishVerses: [],
      };
    }
  }
  groups.push(current);

  // Match English verses to groups
  for (const group of groups) {
    group.englishVerses = english.filter(
      (e) =>
        e.book_code === group.bookCode &&
        e.chapter === group.chapter &&
        group.verses.some((v) => v.verse === e.verse)
    ).sort((a, b) => a.verse - b.verse);
  }

  return groups;
}

function formatVerseRange(verses: BibleVerse[]): string {
  if (verses.length === 0) return "";
  if (verses.length === 1) return `${verses[0].verse}`;

  const nums = verses.map((v) => v.verse).sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = nums[0];
  let end = nums[0];

  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = nums[i];
      end = nums[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(",");
}

export default function VerseDisplay({
  verses,
  onBack,
  onAddMore,
  onRemoveVerse,
  onCreateCard,
  onScrapSaved,
  requireAuth,
}: VerseDisplayProps) {
  const [englishVerses, setEnglishVerses] = useState<BibleVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [copiedType, setCopiedType] = useState<"link" | "text" | null>(null);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [fsVersion, setFsVersion] = useState<"nkrv" | "rnksv">(verses[0]?.version as "nkrv" | "rnksv" || "nkrv");
  const [fsParallel, setFsParallel] = useState(false);

  useEffect(() => {
    async function loadEnglish() {
      if (verses.length === 0) {
        setLoading(false);
        return;
      }

      setLoading(true);

      // 그룹별로 영문 조회
      const uniqueRefs = new Map<
        string,
        { bookCode: string; chapter: number; verseNums: number[] }
      >();
      for (const v of verses) {
        const key = `${v.book_code}-${v.chapter}`;
        if (!uniqueRefs.has(key)) {
          uniqueRefs.set(key, {
            bookCode: v.book_code,
            chapter: v.chapter,
            verseNums: [],
          });
        }
        uniqueRefs.get(key)!.verseNums.push(v.verse);
      }

      const promises = [...uniqueRefs.values()].map((ref) =>
        supabase
          .from("bible_verses")
          .select("*")
          .eq("version", "kjv")
          .eq("book_code", ref.bookCode)
          .eq("chapter", ref.chapter)
          .in("verse", ref.verseNums)
          .order("verse")
      );

      const results = await Promise.all(promises);
      const allEnglish: BibleVerse[] = [];
      for (const res of results) {
        if (res.data) {
          allEnglish.push(...(res.data as BibleVerse[]));
        }
      }
      setEnglishVerses(allEnglish);
      setLoading(false);
    }
    loadEnglish();
  }, [verses]);

  if (loading) {
    return (
      <div className="w-full max-w-[1200px] mx-auto p-8 text-center text-gray-400">
        불러오는 중...
      </div>
    );
  }

  if (verses.length === 0) {
    return (
      <div className="w-full max-w-[1200px] mx-auto p-8 text-center text-gray-400">
        선택된 구절이 없습니다
      </div>
    );
  }

  const groups = groupVerses(verses, englishVerses);

  return (
    <div className="w-full max-w-[1200px] mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          다시 검색
        </button>

        <button
          onClick={onAddMore}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          절 추가
        </button>
      </div>

      {/* Verse groups */}
      {groups.map((group, gi) => {
        const book = getBookByCode(group.bookCode);
        const verseRange = formatVerseRange(group.verses);
        const koreanRef = `${group.bookName} ${group.chapter}장 ${verseRange}절`;
        const englishRef = book
          ? `${book.nameEn} ${group.chapter}:${verseRange}`
          : null;

        return (
          <div
            key={`${group.bookCode}-${group.chapter}-${gi}`}
            className="relative bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-4"
          >
            {/* Korean text */}
            <blockquote className="text-xl leading-relaxed text-gray-900 font-[family-name:var(--font-gowun-dodum)] font-bold mb-3">
              {group.verses.map((v, vi) => (
                <span key={v.id}>
                  {vi > 0 && " "}
                  <sup className="text-xs text-gray-400 mr-0.5">
                    {v.verse}
                  </sup>
                  {stripNotes(v.text)}
                </span>
              ))}
            </blockquote>
            <p className="text-sm text-gray-500 font-medium mb-6">
              {koreanRef}
            </p>

            {/* English text */}
            {group.englishVerses.length > 0 && (
              <div className="border-t border-gray-100 pt-5">
                <blockquote className="text-base leading-relaxed text-gray-600 font-[family-name:var(--font-playfair)] italic">
                  {group.englishVerses.map((ev, evi) => (
                    <span key={ev.id}>
                      {evi > 0 && " "}
                      <sup className="text-xs text-gray-400 mr-0.5 not-italic">
                        {ev.verse}
                      </sup>
                      {ev.text}
                    </span>
                  ))}
                </blockquote>
                {englishRef && (
                  <p className="text-sm text-gray-400 mt-2 font-[family-name:var(--font-playfair)]">
                    {englishRef}
                  </p>
                )}
              </div>
            )}

            {/* Remove card button */}
            <button
              onClick={() => group.verses.forEach((v) => onRemoveVerse(v))}
              className="absolute bottom-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
              title="이 카드 제외"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}

      {/* Share + CTA */}
      <div className="mt-2 space-y-2">
        {/* 이 말씀 링크 복사 */}
        {!showShareOptions ? (
          <button
            onClick={() => {
              if (requireAuth && !requireAuth()) return;
              addScrapToServer(verses, verses[0].version as "nkrv" | "rnksv");
              onScrapSaved?.();
              setShowShareOptions(true);
            }}
            className="w-full py-2.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            이 말씀 링크 복사
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => {
                const refsParam = verses
                  .map((v) => `${v.book_code}.${v.chapter}.${v.verse}`)
                  .join(",");
                const url = `${window.location.origin}/share?v=${verses[0].version}&r=${refsParam}`;
                navigator.clipboard.writeText(url);
                setCopiedType("link");
                setTimeout(() => { setCopiedType(null); setShowShareOptions(false); }, 2000);
              }}
              className={`flex-1 py-2.5 text-sm rounded-xl border transition-colors flex items-center justify-center gap-1.5 ${
                copiedType === "link"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "text-gray-600 bg-white border-gray-200 hover:bg-gray-50"
              }`}
            >
              {copiedType === "link" ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  복사됨
                </>
              ) : (
                "이 페이지 그대로"
              )}
            </button>
            <button
              onClick={async () => {
                // 한글 + 영문 텍스트 조합
                const groups = groupVerses(verses, englishVerses);
                const textParts = groups.map((g) => {
                  const book = getBookByCode(g.bookCode);
                  const vRange = g.verses.length === 1
                    ? `${g.verses[0].verse}`
                    : `${g.verses[0].verse}-${g.verses[g.verses.length - 1].verse}`;
                  const krText = g.verses.map((v) => stripNotes(v.text)).join(" ");
                  const krRef = `(${g.bookName} ${g.chapter}:${vRange})`;
                  const enText = g.englishVerses.map((v) => v.text).join(" ");
                  const enRef = book ? `(${book.nameEn} ${g.chapter}:${vRange})` : "";
                  let result = `'${krText}'\n${krRef}`;
                  if (enText) result += `\n\n'${enText}'\n${enRef}`;
                  return result;
                });
                const fullText = "\n[예봄성경 말씀나눔]\n\n" + textParts.join("\n\n---\n\n");
                await navigator.clipboard.writeText(fullText);
                setCopiedType("text");
                setTimeout(() => { setCopiedType(null); setShowShareOptions(false); }, 2000);
              }}
              className={`flex-1 py-2.5 text-sm rounded-xl border transition-colors flex items-center justify-center gap-1.5 ${
                copiedType === "text"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "text-gray-600 bg-white border-gray-200 hover:bg-gray-50"
              }`}
            >
              {copiedType === "text" ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  복사됨
                </>
              ) : (
                "텍스트로"
              )}
            </button>
          </div>
        )}

        {/* 카드 만들기 */}
        <button
          onClick={onCreateCard}
          className="w-full py-3.5 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[#9A7009] transition-colors"
        >
          이 말씀으로 카드 만들기 ({verses.length}절)
        </button>

        {/* 스크랩만 하기 */}
        <button
          onClick={async () => {
            if (requireAuth && !requireAuth()) return;
            await addScrapToServer(verses, verses[0].version as "nkrv" | "rnksv");
            onScrapSaved?.();
          }}
          className="w-full py-2.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-center"
        >
          스크랩만 하기
          <span className="block text-xs text-gray-500 mt-0.5">
            링크복사나 카드만들기하시면 자동스크랩
          </span>
        </button>

        {/* 풀스크린으로 보기 */}
        <button
          onClick={() => setShowFullscreen(true)}
          className="w-full py-3 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-11.25 11.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
          </svg>
          풀스크린으로 보기
        </button>
      </div>

      {/* 풀스크린 리더 */}
      {showFullscreen && (() => {
        const sorted = [...verses].sort((a, b) => {
          if (a.book_order !== b.book_order) return a.book_order - b.book_order;
          if (a.chapter !== b.chapter) return a.chapter - b.chapter;
          return a.verse - b.verse;
        });
        const mainVersion = fsVersion;
        const altVersion = mainVersion === "nkrv" ? "rnksv" : "nkrv";
        const fsVerses: FullscreenVerseItem[] = sorted.map((v) => {
          const mainText = stripNotes(v.version === mainVersion
            ? v.text
            : englishVerses.find((e) => e.book_code === v.book_code && e.chapter === v.chapter && e.verse === v.verse)?.text || v.text);
          const altVerse = englishVerses.find(
            (e) => e.book_code === v.book_code && e.chapter === v.chapter && e.verse === v.verse
          );
          return {
            ref: `${v.book_name} ${v.chapter}장 ${v.verse}절`,
            main: stripNotes(v.text),
            sub: altVerse ? stripNotes(altVerse.text) : undefined,
          };
        });
        const jumpRefs = sorted.map((v) => ({
          book_abbr: v.book_abbr,
          book_code: v.book_code,
          chapter: v.chapter,
          verse: v.verse,
        }));
        return (
          <FullscreenReader
            verses={fsVerses}
            version={fsVersion}
            onVersionChange={setFsVersion}
            parallel={fsParallel}
            onParallelToggle={() => setFsParallel(!fsParallel)}
            onClose={() => setShowFullscreen(false)}
            jumpMode
            jumpRefs={jumpRefs}
          />
        );
      })()}
    </div>
  );
}
