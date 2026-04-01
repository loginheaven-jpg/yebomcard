"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getBookByCode } from "@/lib/books";
import type { BibleVerse, BilingualVerse } from "@/lib/types";

interface VerseDisplayProps {
  verse: BibleVerse;
  onBack: () => void;
}

export default function VerseDisplay({ verse, onBack }: VerseDisplayProps) {
  const [bilingual, setBilingual] = useState<BilingualVerse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBilingual() {
      setLoading(true);

      // Fetch English (KJV) counterpart
      const { data: englishData } = await supabase
        .from("bible_verses")
        .select("*")
        .eq("version", "kjv")
        .eq("book_code", verse.book_code)
        .eq("chapter", verse.chapter)
        .eq("verse", verse.verse)
        .single();

      setBilingual({
        korean: verse,
        english: (englishData as BibleVerse) || null,
      });
      setLoading(false);
    }
    loadBilingual();
  }, [verse]);

  if (loading) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8 text-center text-gray-400">
        불러오는 중...
      </div>
    );
  }

  if (!bilingual) return null;

  const book = getBookByCode(verse.book_code);
  const koreanRef = `${verse.book_name} ${verse.chapter}장 ${verse.verse}절`;
  const englishRef = bilingual.english
    ? `${book?.nameEn || bilingual.english.book_name} ${verse.chapter}:${verse.verse}`
    : null;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
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

      {/* Verse card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        {/* Korean verse */}
        <blockquote className="text-xl leading-relaxed text-gray-900 font-[family-name:var(--font-noto-serif-kr)] mb-3">
          {bilingual.korean.text}
        </blockquote>
        <p className="text-sm text-indigo-600 font-medium mb-6">{koreanRef}</p>

        {/* English verse */}
        {bilingual.english && (
          <>
            <div className="border-t border-gray-100 pt-5">
              <blockquote className="text-base leading-relaxed text-gray-600 font-[family-name:var(--font-playfair)] italic">
                {bilingual.english.text}
              </blockquote>
              <p className="text-sm text-gray-400 mt-2 font-[family-name:var(--font-playfair)]">
                {englishRef}
              </p>
            </div>
          </>
        )}

        {/* Action hint */}
        <div className="mt-8 pt-5 border-t border-gray-100 text-center">
          <p className="text-sm text-gray-400">
            이 말씀으로 카드를 만들 준비가 되었습니다
          </p>
          <p className="text-xs text-gray-300 mt-1">
            (카드 생성 기능은 다음 단계에서 구현됩니다)
          </p>
        </div>
      </div>
    </div>
  );
}
