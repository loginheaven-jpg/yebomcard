"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { OLD_TESTAMENT, NEW_TESTAMENT } from "@/lib/books";
import { parseReference } from "@/lib/parseReference";
import type { BibleVerse, BibleVersion, SearchMode, AIRecommendation } from "@/lib/types";

interface SearchPanelProps {
  selectedVerses: BibleVerse[];
  onToggleVerse: (verse: BibleVerse) => void;
  onConfirm: () => void;
  isAddingMore: boolean;
}

function isSelected(verse: BibleVerse, selected: BibleVerse[]): boolean {
  return selected.some(
    (s) =>
      s.book_code === verse.book_code &&
      s.chapter === verse.chapter &&
      s.verse === verse.verse &&
      s.version === verse.version
  );
}

export default function SearchPanel({
  selectedVerses,
  onToggleVerse,
  onConfirm,
  isAddingMore,
}: SearchPanelProps) {
  const [mode, setMode] = useState<SearchMode>("reference");
  const [version, setVersion] = useState<BibleVersion>("nkrv");

  // Reference search state
  const [refInput, setRefInput] = useState("");
  const [refResults, setRefResults] = useState<BibleVerse[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState("");

  // Chapter browse state
  const [bookCode, setBookCode] = useState("gen");
  const [chapters, setChapters] = useState<number[]>([]);
  const [chapter, setChapter] = useState<number>(1);
  const [browseVerses, setBrowseVerses] = useState<BibleVerse[]>([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);

  // Word search state
  const [wordInput, setWordInput] = useState("");
  const [wordResults, setWordResults] = useState<BibleVerse[]>([]);
  const [wordLoading, setWordLoading] = useState(false);
  const [wordError, setWordError] = useState("");

  // Topic recommendation state (AI)
  const [topicInput, setTopicInput] = useState("");
  const [topicRecommendations, setTopicRecommendations] = useState<AIRecommendation[]>([]);
  const [topicResults, setTopicResults] = useState<BibleVerse[]>([]);
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState("");

  // ─── 말씀 찾기 (Reference search) ───
  const searchReference = useCallback(async () => {
    const trimmed = refInput.trim();
    if (!trimmed) {
      setRefError("예: 창1:1-3, 시편 23:1, 롬8:28");
      return;
    }

    const parsed = parseReference(trimmed);
    if (!parsed) {
      setRefError("인식할 수 없는 형식입니다. 예: 창1:1-3, 시편 23:1");
      return;
    }

    setRefError("");
    setRefLoading(true);

    try {
      const { data, error } = await supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", parsed.bookCode)
        .eq("chapter", parsed.chapter)
        .in("verse", parsed.verses)
        .order("verse");

      if (error) {
        setRefError("검색 중 오류가 발생했습니다");
        setRefResults([]);
      } else if (!data || data.length === 0) {
        setRefError("해당 구절을 찾을 수 없습니다");
        setRefResults([]);
      } else {
        setRefResults(data as BibleVerse[]);
      }
    } catch {
      setRefError("검색 중 오류가 발생했습니다");
    } finally {
      setRefLoading(false);
    }
  }, [refInput, version]);

  // ─── 장절 선택 (Chapter browse) ───
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

  useEffect(() => {
    async function loadVerses() {
      if (!chapter) return;
      setLoadingBrowse(true);
      const { data, error } = await supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", bookCode)
        .eq("chapter", chapter)
        .order("verse");

      if (!error && data) {
        setBrowseVerses(data as BibleVerse[]);
      }
      setLoadingBrowse(false);
    }
    loadVerses();
  }, [bookCode, chapter, version]);

  // ─── 단어 검색 (Word search: space=AND, x=OR) ───
  const searchWord = useCallback(async () => {
    const trimmed = wordInput.trim();
    if (trimmed.length < 2) {
      setWordError("2글자 이상 입력해주세요");
      return;
    }

    setWordError("");
    setWordLoading(true);

    try {
      // "사랑x믿음" → OR, "사랑 믿음" → AND
      const isOr = trimmed.includes("x");
      const words = isOr
        ? trimmed.split("x").map((w) => w.trim()).filter(Boolean)
        : trimmed.split(/\s+/).filter(Boolean);

      if (words.length === 0) {
        setWordError("검색어를 입력해주세요");
        setWordLoading(false);
        return;
      }

      if (isOr) {
        // OR: 각 단어별로 검색 후 합치기
        const promises = words.map((w) =>
          supabase
            .from("bible_verses")
            .select("*")
            .eq("version", version)
            .ilike("text", `%${w}%`)
            .order("book_order")
            .order("chapter")
            .order("verse")
            .limit(30)
        );
        const results = await Promise.all(promises);
        const merged = new Map<number, BibleVerse>();
        for (const res of results) {
          if (res.data) {
            for (const v of res.data as BibleVerse[]) {
              merged.set(v.id, v);
            }
          }
        }
        const sorted = [...merged.values()].sort((a, b) => {
          if (a.book_order !== b.book_order) return a.book_order - b.book_order;
          if (a.chapter !== b.chapter) return a.chapter - b.chapter;
          return a.verse - b.verse;
        });
        setWordResults(sorted.slice(0, 50));
        if (sorted.length === 0) setWordError("검색 결과가 없습니다");
      } else {
        // AND: 첫 번째 단어로 검색 후 나머지 단어 필터링
        let query = supabase
          .from("bible_verses")
          .select("*")
          .eq("version", version);

        for (const w of words) {
          query = query.ilike("text", `%${w}%`);
        }

        const { data, error } = await query
          .order("book_order")
          .order("chapter")
          .order("verse")
          .limit(50);

        if (error) {
          setWordError("검색 중 오류가 발생했습니다");
          setWordResults([]);
        } else {
          setWordResults((data as BibleVerse[]) || []);
          if (data?.length === 0) setWordError("검색 결과가 없습니다");
        }
      }
    } catch {
      setWordError("검색 중 오류가 발생했습니다");
    } finally {
      setWordLoading(false);
    }
  }, [wordInput, version]);

  // ─── 주제 추천 (AI topic recommendation) ───
  const searchTopic = useCallback(async () => {
    const trimmed = topicInput.trim();
    if (trimmed.length < 1) {
      setTopicError("주제를 입력해주세요 (예: 감사, 위로, 결혼)");
      return;
    }

    setTopicError("");
    setTopicLoading(true);
    setTopicRecommendations([]);
    setTopicResults([]);

    try {
      // 1. AI에게 추천 요청
      const aiRes = await fetch("/api/ai/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, version }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.json().catch(() => ({ error: "Unknown" }));
        setTopicError(err.error || "추천 실패");
        setTopicLoading(false);
        return;
      }

      const { recommendations } = (await aiRes.json()) as {
        recommendations: AIRecommendation[];
      };
      setTopicRecommendations(recommendations);

      // 2. 추천된 구절을 DB에서 실제 조회
      const versePromises = recommendations.map((rec) =>
        supabase
          .from("bible_verses")
          .select("*")
          .eq("version", version)
          .eq("book_name", rec.book)
          .eq("chapter", rec.chapter)
          .eq("verse", rec.verse)
          .single()
      );
      const verseResults = await Promise.all(versePromises);

      const found: BibleVerse[] = [];
      for (const res of verseResults) {
        if (res.data) {
          found.push(res.data as BibleVerse);
        }
      }

      setTopicResults(found);
      if (found.length === 0) {
        setTopicError("추천된 구절을 DB에서 찾을 수 없습니다");
      }
    } catch {
      setTopicError("추천 중 오류가 발생했습니다");
    } finally {
      setTopicLoading(false);
    }
  }, [topicInput, version]);

  // ─── Shared: verse item renderer ───
  function VerseItem({
    verse,
    showBookInfo,
  }: {
    verse: BibleVerse;
    showBookInfo?: boolean;
  }) {
    const selected = isSelected(verse, selectedVerses);
    return (
      <button
        onClick={() => onToggleVerse(verse)}
        className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 transition-colors ${
          selected
            ? "bg-indigo-100 border-l-4 border-l-indigo-500"
            : "hover:bg-gray-50"
        }`}
      >
        {showBookInfo && (
          <div className="text-indigo-600 font-semibold text-xs mb-1">
            {verse.book_name} {verse.chapter}:{verse.verse}
          </div>
        )}
        {!showBookInfo && (
          <span
            className={`font-semibold text-sm mr-2 ${selected ? "text-indigo-700" : "text-indigo-500"}`}
          >
            {verse.verse}절
          </span>
        )}
        <span className={`text-sm ${selected ? "text-gray-900" : "text-gray-700"}`}>
          {verse.text}
        </span>
        {selected && (
          <span className="float-right text-indigo-600 text-sm">&#10003;</span>
        )}
      </button>
    );
  }

  const tabClass = (tab: SearchMode) =>
    `flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
      mode === tab
        ? "border-b-2 border-indigo-600 text-indigo-600"
        : "text-gray-500 hover:text-gray-700"
    }`;

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header */}
      {!isAddingMore && (
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
      )}

      {/* Adding more indicator */}
      {isAddingMore && (
        <div className="mb-4 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-700 text-center">
          현재 {selectedVerses.length}절 선택됨 — 추가할 구절을 선택하세요
        </div>
      )}

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

      {/* 4 Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <button onClick={() => setMode("reference")} className={tabClass("reference")}>
          말씀 찾기
        </button>
        <button onClick={() => setMode("chapter")} className={tabClass("chapter")}>
          장절 선택
        </button>
        <button onClick={() => setMode("word")} className={tabClass("word")}>
          단어 검색
        </button>
        <button onClick={() => setMode("topic")} className={tabClass("topic")}>
          주제 추천
        </button>
      </div>

      {/* ─── Tab 1: 말씀 찾기 ─── */}
      {mode === "reference" && (
        <div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchReference()}
              placeholder="창1:1-3, 시편 23:1, 롬8:28"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={searchReference}
              disabled={refLoading}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {refLoading ? "..." : "찾기"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            예: 창1:1 · 시편23:1-6 · 창세기 1장 1절-3절 · 롬8:28,31
          </p>

          {refError && (
            <p className="text-sm text-red-500 mb-3 text-center">{refError}</p>
          )}

          {refResults.length > 0 && (
            <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
              {refResults.map((v) => (
                <VerseItem key={v.id} verse={v} showBookInfo />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab 2: 장절 선택 ─── */}
      {mode === "chapter" && (
        <div>
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

          <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
            {loadingBrowse ? (
              <div className="p-4 text-center text-gray-400">
                불러오는 중...
              </div>
            ) : browseVerses.length === 0 ? (
              <div className="p-4 text-center text-gray-400">
                구절이 없습니다
              </div>
            ) : (
              browseVerses.map((v) => (
                <VerseItem key={v.id} verse={v} />
              ))
            )}
          </div>
        </div>
      )}

      {/* ─── Tab 3: 단어 검색 ─── */}
      {mode === "word" && (
        <div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={wordInput}
              onChange={(e) => setWordInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchWord()}
              placeholder="사랑 믿음 (AND) · 사랑x믿음 (OR)"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={searchWord}
              disabled={wordLoading}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {wordLoading ? "..." : "검색"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            공백 = AND 조건 · x = OR 조건 (예: 사랑x소망)
          </p>

          {wordError && (
            <p className="text-sm text-gray-500 mb-3 text-center">
              {wordError}
            </p>
          )}

          {wordResults.length > 0 && (
            <>
              <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
                {wordResults.map((v) => (
                  <VerseItem key={v.id} verse={v} showBookInfo />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                {wordResults.length}건
                {wordResults.length >= 50 && " (최대 50건)"}
              </p>
            </>
          )}
        </div>
      )}

      {/* ─── Tab 4: 주제 추천 (AI) ─── */}
      {mode === "topic" && (
        <div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchTopic()}
              placeholder="감사, 위로, 결혼, 장례, 새해 ..."
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={searchTopic}
              disabled={topicLoading}
              className="px-5 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {topicLoading ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  ...
                </span>
              ) : (
                "추천"
              )}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            주제에 맞는 성경 구절을 추천합니다
          </p>

          {topicError && (
            <p className="text-sm text-red-500 mb-3 text-center">
              {topicError}
            </p>
          )}

          {topicLoading && (
            <div className="p-8 text-center">
              <div className="inline-flex items-center gap-2 text-violet-600 text-sm">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                말씀을 찾고 있습니다...
              </div>
            </div>
          )}

          {topicResults.length > 0 && (
            <>
              <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
                {topicResults.map((v) => (
                  <VerseItem key={v.id} verse={v} showBookInfo />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                추천 {topicResults.length}건
              </p>
            </>
          )}

          {!topicLoading && topicRecommendations.length > 0 && topicResults.length === 0 && !topicError && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
              <p className="text-sm text-amber-700 mb-2">추천되었지만 DB에서 찾지 못한 구절:</p>
              {topicRecommendations.map((rec, i) => (
                <p key={i} className="text-xs text-amber-600">
                  {rec.book} {rec.chapter}:{rec.verse} — {rec.preview}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 선택 완료 버튼 ─── */}
      {selectedVerses.length > 0 && (
        <div className="sticky bottom-4 mt-4">
          <button
            onClick={onConfirm}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-indigo-700 transition-colors"
          >
            선택 완료 ({selectedVerses.length}절)
          </button>
        </div>
      )}
    </div>
  );
}
