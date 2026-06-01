"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getBookByCode } from "@/lib/books";
import type { BibleVerse } from "@/lib/types";
import { useSearchParams, useRouter } from "next/navigation";

export default function ShareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [koreanVerses, setKoreanVerses] = useState<BibleVerse[]>([]);
  const [englishVerses, setEnglishVerses] = useState<BibleVerse[]>([]);
  const [loading, setLoading] = useState(true);

  const version = searchParams.get("v") || "nkrv";
  const enVersion = searchParams.get("ev") || "kjv";
  const refs = searchParams.get("r") || "";

  useEffect(() => {
    async function load() {
      if (!refs) {
        setLoading(false);
        return;
      }

      const parts = refs.split(",").map((r) => {
        const [bookCode, ch, vs] = r.split(".");
        return { bookCode, chapter: parseInt(ch), verse: parseInt(vs) };
      });

      const krPromises = parts.map((p) =>
        supabase
          .from("bible_verses")
          .select("*")
          .eq("version", version)
          .eq("book_code", p.bookCode)
          .eq("chapter", p.chapter)
          .eq("verse", p.verse)
          .single()
      );
      // ev=none 일 때는 영문 fetch 스킵 (version=eq.none → 406 에러 방지)
      const enPromises = enVersion === "none"
        ? []
        : parts.map((p) =>
            supabase
              .from("bible_verses")
              .select("*")
              .eq("version", enVersion)
              .eq("book_code", p.bookCode)
              .eq("chapter", p.chapter)
              .eq("verse", p.verse)
              .single()
          );

      const [krResults, enResults] = await Promise.all([
        Promise.all(krPromises),
        Promise.all(enPromises),
      ]);

      setKoreanVerses(
        krResults.filter((r) => r.data).map((r) => r.data as BibleVerse)
      );
      setEnglishVerses(
        enResults.filter((r) => r.data).map((r) => r.data as BibleVerse)
      );
      setLoading(false);
    }
    load();
  }, [refs, version, enVersion]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">
        불러오는 중...
      </div>
    );
  }

  if (koreanVerses.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">
        구절을 찾을 수 없습니다
      </div>
    );
  }

  const firstVerse = koreanVerses[0];
  const book = getBookByCode(firstVerse.book_code);
  const verseRange =
    koreanVerses.length === 1
      ? `${koreanVerses[0].verse}`
      : `${koreanVerses[0].verse}-${koreanVerses[koreanVerses.length - 1].verse}`;
  const koreanRef = `${firstVerse.book_name} ${firstVerse.chapter}장 ${verseRange}절`;
  const englishRef = book
    ? `${book.nameEn} ${firstVerse.chapter}:${verseRange}`
    : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-4 py-4">
        {/* FIX C: router.replace로 /share entry를 history stack에서 제거 →
            홈에서 multi-step 네비 후 책 선택 시 /share로 튕겨 돌아가는 버그 방지.
            (기존 <a href="/?fresh=1"> 풀 페이지 이동은 bfcache로 /share가 즉시 복원되어 race 발생) */}
        <button
          onClick={() => router.replace("/")}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          홈으로
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 pb-12">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <blockquote className="text-xl leading-[1.9] text-gray-900 font-[family-name:var(--font-gowun-dodum)] font-bold mb-3">
            {koreanVerses.map((v, i) => (
              <span key={v.id}>
                {i > 0 && " "}
                {koreanVerses.length > 1 && (
                  <sup className="text-xs text-gray-400 mr-0.5">{v.verse}</sup>
                )}
                {v.text}
              </span>
            ))}
          </blockquote>
          <p className="text-sm text-gray-500 font-medium mb-6">{koreanRef}</p>

          {englishVerses.length > 0 && (
            <div className="border-t border-gray-100 pt-5">
              <blockquote className="text-base leading-relaxed text-gray-600 font-[family-name:var(--font-playfair)] italic">
                {englishVerses.map((ev, i) => (
                  <span key={ev.id}>
                    {i > 0 && " "}
                    {englishVerses.length > 1 && (
                      <sup className="text-xs text-gray-400 mr-0.5 not-italic">{ev.verse}</sup>
                    )}
                    {ev.text}
                  </span>
                ))}
              </blockquote>
              <p className="text-sm text-gray-400 mt-2 font-[family-name:var(--font-playfair)]">
                {englishRef}
              </p>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-50 text-right">
            <span className="text-xs text-gray-300 font-[family-name:var(--font-playfair)] italic">
              Yebom Bible Card
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
