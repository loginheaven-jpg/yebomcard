"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getBookByCode } from "@/lib/books";
import type { BibleVerse, BilingualVerse } from "@/lib/types";

interface VerseDisplayProps {
  verses: BibleVerse[];
  onBack: () => void;
  onAddMore: () => void;
  onRemoveVerse: (verse: BibleVerse) => void;
  onCreateCard: () => void;
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
}: VerseDisplayProps) {
  const [englishVerses, setEnglishVerses] = useState<BibleVerse[]>([]);
  const [loading, setLoading] = useState(true);

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
      <div className="w-full max-w-2xl mx-auto p-8 text-center text-gray-400">
        불러오는 중...
      </div>
    );
  }

  if (verses.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8 text-center text-gray-400">
        선택된 구절이 없습니다
      </div>
    );
  }

  const groups = groupVerses(verses, englishVerses);

  return (
    <div className="w-full max-w-2xl mx-auto">
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
                  {v.text}
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

      {/* CTA */}
      <div className="mt-2">
        <button
          onClick={onCreateCard}
          className="w-full py-3.5 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[#9A7009] transition-colors"
        >
          이 말씀으로 카드 만들기 ({verses.length}절)
        </button>
      </div>
    </div>
  );
}
