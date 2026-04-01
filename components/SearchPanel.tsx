"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { BOOKS, OLD_TESTAMENT, NEW_TESTAMENT } from "@/lib/books";
import type { BibleVerse, BibleVersion, SearchMode } from "@/lib/types";

interface SearchPanelProps {
  onVerseSelect: (verse: BibleVerse) => void;
}

export default function SearchPanel({ onVerseSelect }: SearchPanelProps) {
  const [mode, setMode] = useState<SearchMode>("chapter");
  const [version, setVersion] = useState<BibleVersion>("nkrv");

  // Chapter search state
  const [bookCode, setBookCode] = useState("gen");
  const [chapters, setChapters] = useState<number[]>([]);
  const [chapter, setChapter] = useState<number>(1);
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [loadingVerses, setLoadingVerses] = useState(false);

  // Keyword search state
  const [keyword, setKeyword] = useState("");
  const [keywordResults, setKeywordResults] = useState<BibleVerse[]>([]);
  const [loadingKeyword, setLoadingKeyword] = useState(false);
  const [keywordError, setKeywordError] = useState("");

  // Load chapters when book changes
  useEffect(() => {
    async function loadChapters() {
      const { data, error } = await supabase
        .from("bible_verses")
        .select("chapter")
        .eq("version", version)
        .eq("book_code", bookCode)
        .order("chapter");

      if (error || !data) return;

      const unique = [...new Set(data.map((d) => d.chapter))].sort(
        (a, b) => a - b
      );
      setChapters(unique);
      if (unique.length > 0 && !unique.includes(chapter)) {
        setChapter(unique[0]);
      }
    }
    loadChapters();
  }, [bookCode, version]);

  // Load verses when chapter changes
  useEffect(() => {
    async function loadVerses() {
      if (!chapter) return;
      setLoadingVerses(true);
      const { data, error } = await supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", bookCode)
        .eq("chapter", chapter)
        .order("verse");

      if (!error && data) {
        setVerses(data as BibleVerse[]);
      }
      setLoadingVerses(false);
    }
    loadVerses();
  }, [bookCode, chapter, version]);

  // Keyword search with debounce
  const searchKeyword = useCallback(async () => {
    if (keyword.trim().length < 2) {
      setKeywordError("2글자 이상 입력해주세요");
      return;
    }
    setKeywordError("");
    setLoadingKeyword(true);

    try {
      const { data, error } = await supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .ilike("text", `%${keyword.trim()}%`)
        .order("book_order")
        .order("chapter")
        .order("verse")
        .limit(50);

      if (error) {
        setKeywordError("검색 중 오류가 발생했습니다");
        setKeywordResults([]);
      } else {
        setKeywordResults((data as BibleVerse[]) || []);
        if (data?.length === 0) {
          setKeywordError("검색 결과가 없습니다");
        }
      }
    } catch {
      setKeywordError("검색 중 오류가 발생했습니다");
    } finally {
      setLoadingKeyword(false);
    }
  }, [keyword, version]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      searchKeyword();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 font-[family-name:var(--font-noto-serif-kr)]">
          예봄카드
        </h1>
        <p className="text-sm text-gray-500 mt-1 font-[family-name:var(--font-playfair)] italic">
          Yebom Card
        </p>
        <p className="text-gray-600 mt-2">
          성경 말씀을 아름다운 카드로 만들어 보세요
        </p>
      </div>

      {/* Version Toggle */}
      <div className="flex justify-center gap-2 mb-4">
        <button
          onClick={() => setVersion("nkrv")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            version === "nkrv"
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          개역개정
        </button>
        <button
          onClick={() => setVersion("rnksv")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            version === "rnksv"
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          새번역
        </button>
      </div>

      {/* Search Mode Toggle */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setMode("chapter")}
          className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
            mode === "chapter"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          장절 검색
        </button>
        <button
          onClick={() => setMode("keyword")}
          className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
            mode === "keyword"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          키워드 검색
        </button>
      </div>

      {/* Chapter Search */}
      {mode === "chapter" && (
        <div>
          {/* Book / Chapter selectors */}
          <div className="flex gap-2 mb-4">
            <select
              value={bookCode}
              onChange={(e) => setBookCode(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <optgroup label="구약">
                {OLD_TESTAMENT.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.nameKr}
                  </option>
                ))}
              </optgroup>
              <optgroup label="신약">
                {NEW_TESTAMENT.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.nameKr}
                  </option>
                ))}
              </optgroup>
            </select>

            <select
              value={chapter}
              onChange={(e) => setChapter(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {chapters.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}장
                </option>
              ))}
            </select>
          </div>

          {/* Verse list */}
          <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
            {loadingVerses ? (
              <div className="p-4 text-center text-gray-400">
                불러오는 중...
              </div>
            ) : verses.length === 0 ? (
              <div className="p-4 text-center text-gray-400">
                구절이 없습니다
              </div>
            ) : (
              verses.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onVerseSelect(v)}
                  className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-indigo-50 transition-colors"
                >
                  <span className="text-indigo-600 font-semibold text-sm mr-2">
                    {v.verse}절
                  </span>
                  <span className="text-gray-800 text-sm">{v.text}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Keyword Search */}
      {mode === "keyword" && (
        <div>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="검색어를 입력하세요 (예: 사랑, 평안)"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={searchKeyword}
              disabled={loadingKeyword}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loadingKeyword ? "검색 중..." : "검색"}
            </button>
          </div>

          {keywordError && (
            <p className="text-sm text-gray-500 mb-3 text-center">
              {keywordError}
            </p>
          )}

          {/* Keyword results */}
          <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
            {keywordResults.length === 0 && !keywordError ? (
              <div className="p-4 text-center text-gray-400">
                키워드를 입력하고 검색하세요
              </div>
            ) : (
              keywordResults.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onVerseSelect(v)}
                  className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-indigo-50 transition-colors"
                >
                  <div className="text-indigo-600 font-semibold text-xs mb-1">
                    {v.book_name} {v.chapter}:{v.verse}
                  </div>
                  <div className="text-gray-800 text-sm">{v.text}</div>
                </button>
              ))
            )}
          </div>

          {keywordResults.length > 0 && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              {keywordResults.length}건
              {keywordResults.length === 50 && " (최대 50건)"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
