"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { OLD_TESTAMENT, NEW_TESTAMENT, getBookByCode } from "@/lib/books";
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
  const [mode, setMode] = useState<SearchMode>("search");
  const [version, setVersion] = useState<BibleVersion>("rnksv");
  const [parallel, setParallel] = useState(false);

  // Scroll position preservation
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);

  // 성경 본문 읽기 폰트 크기 (localStorage 유지)
  const [readingFontSize, setReadingFontSize] = useState(() => {
    if (typeof window !== "undefined") {
      return parseInt(localStorage.getItem("readingFontSize") || "16");
    }
    return 16;
  });
  useEffect(() => {
    localStorage.setItem("readingFontSize", String(readingFontSize));
  }, [readingFontSize]);

  // ─── Unified search state (reference + word merged) ───
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<BibleVerse[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [lastSearchType, setLastSearchType] = useState<"ref" | "word-and" | "word-or" | null>(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchResultsAlt, setSearchResultsAlt] = useState<BibleVerse[]>([]);
  const [topicResultsAlt, setTopicResultsAlt] = useState<BibleVerse[]>([]);

  // Chapter browse state
  const [browseStep, setBrowseStep] = useState<"book" | "chapter" | "verse">("book");
  const [bookCode, setBookCode] = useState("gen");
  const [chapters, setChapters] = useState<number[]>([]);
  const [chapter, setChapter] = useState<number>(1);
  const [browseVerses, setBrowseVerses] = useState<BibleVerse[]>([]);
  const [browseVersesAlt, setBrowseVersesAlt] = useState<BibleVerse[]>([]);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [rememberedVerse, setRememberedVerse] = useState<number | null>(null);
  const [bookTestament, setBookTestament] = useState<"old" | "new">("old");

  // Topic recommendation state
  const [topicInput, setTopicInput] = useState("");
  const [topicRecommendations, setTopicRecommendations] = useState<AIRecommendation[]>([]);
  const [topicResults, setTopicResults] = useState<BibleVerse[]>([]);
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicError, setTopicError] = useState("");

  // ─── 말씀 검색 (auto-detect: reference or word) ───
  const executeSearch = useCallback(async () => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSearchError("창1:1-3 또는 사랑, 평안");
      return;
    }

    // Try reference parse first
    const parsed = parseReference(trimmed);

    if (parsed) {
      // === Reference search ===
      setLastSearchType("ref");
      setSearchError("");
      setSearchLoading(true);

      try {
        let query = supabase
          .from("bible_verses")
          .select("*")
          .eq("version", version)
          .eq("book_code", parsed.bookCode)
          .eq("chapter", parsed.chapter);

        if (parsed.verses.length > 0) {
          query = query.in("verse", parsed.verses);
        }

        const { data, error } = await query.order("verse");

        if (error) {
          setSearchError("검색 중 오류가 발생했습니다");
          setSearchResults([]);
        } else if (!data || data.length === 0) {
          setSearchError("해당 구절을 찾을 수 없습니다");
          setSearchResults([]);
        } else {
          const results = data as BibleVerse[];
          setSearchResults(results);
          if (results.length === 1 && !isSelected(results[0], selectedVerses)) {
            onToggleVerse(results[0]);
          }
          requestAnimationFrame(() => {
            if (scrollRef.current && savedScroll.current > 0) {
              scrollRef.current.scrollTop = savedScroll.current;
              savedScroll.current = 0;
            }
          });
        }
      } catch {
        setSearchError("검색 중 오류가 발생했습니다");
      } finally {
        setSearchLoading(false);
      }
    } else {
      // === Word search ===
      if (trimmed.length < 2) {
        setSearchError("2글자 이상 입력해주세요");
        return;
      }
      setSearchError("");
      setSearchLoading(true);
      setSearchOffset(0);
      setHasMoreResults(false);

      try {
        const isOr = trimmed.includes("x");
        const words = isOr
          ? trimmed.split("x").map((w) => w.trim()).filter(Boolean)
          : trimmed.split(/\s+/).filter(Boolean);

        if (words.length === 0) {
          setSearchError("검색어를 입력해주세요");
          setSearchLoading(false);
          return;
        }

        if (isOr) {
          setLastSearchType("word-or");
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
          setSearchResults(sorted.slice(0, 50));
          if (sorted.length === 0) setSearchError("검색 결과가 없습니다");
        } else {
          setLastSearchType("word-and");
          const PAGE_SIZE = 50;
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
            .range(0, PAGE_SIZE - 1);

          if (error) {
            setSearchError("검색 중 오류가 발생했습니다");
            setSearchResults([]);
          } else {
            setSearchResults((data as BibleVerse[]) || []);
            setHasMoreResults((data?.length || 0) === PAGE_SIZE);
            if (data?.length === 0) setSearchError("검색 결과가 없습니다");
            requestAnimationFrame(() => {
              if (scrollRef.current && savedScroll.current > 0) {
                scrollRef.current.scrollTop = savedScroll.current;
                savedScroll.current = 0;
              }
            });
          }
        }
      } catch {
        setSearchError("검색 중 오류가 발생했습니다");
      } finally {
        setSearchLoading(false);
      }
    }
  }, [searchInput, version]);

  // ─── 다음 50건 불러오기 (AND 검색 전용) ───
  const loadMore = useCallback(async () => {
    const trimmed = searchInput.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const PAGE_SIZE = 50;
    const newOffset = searchOffset + PAGE_SIZE;
    setLoadingMore(true);

    try {
      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version);

      for (const w of words) {
        query = query.ilike("text", `%${w}%`);
      }

      const { data } = await query
        .order("book_order")
        .order("chapter")
        .order("verse")
        .range(newOffset, newOffset + PAGE_SIZE - 1);

      if (data) {
        setSearchResults((prev) => [...prev, ...(data as BibleVerse[])]);
        setSearchOffset(newOffset);
        setHasMoreResults(data.length === PAGE_SIZE);
      }
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [searchInput, searchOffset, version]);

  // ─── 장절 선택 (Chapter browse) ───
  useEffect(() => {
    async function loadChapters() {
      // RPC로 DISTINCT chapter 조회 (Supabase 1000행 제한 우회)
      const { data, error } = await supabase.rpc("get_chapters", {
        p_version: version,
        p_book_code: bookCode,
      });

      if (error || !data) return;

      const unique = (data as { chapter: number }[]).map((d) => d.chapter);
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

  // 병기 모드: 부 버전 로드
  useEffect(() => {
    if (!parallel || !chapter) { setBrowseVersesAlt([]); return; }
    const altVersion = version === "nkrv" ? "rnksv" : "nkrv";
    supabase
      .from("bible_verses")
      .select("*")
      .eq("version", altVersion)
      .eq("book_code", bookCode)
      .eq("chapter", chapter)
      .order("verse")
      .then(({ data }) => {
        if (data) setBrowseVersesAlt(data as BibleVerse[]);
      });
  }, [parallel, bookCode, chapter, version]);

  // 버전 전환 또는 "본문으로 가기" 후 해당 절로 스크롤
  useEffect(() => {
    if (!rememberedVerse || browseVerses.length === 0) return;

    const scrollToVerse = () => {
      if (!scrollRef.current) return false;
      const buttons = scrollRef.current.querySelectorAll("button");
      const idx = browseVerses.findIndex((v) => v.verse === rememberedVerse);
      if (idx >= 0 && buttons[idx]) {
        buttons[idx].scrollIntoView({ block: "center" });
        return true;
      }
      return false;
    };

    // 여러 번 시도 (렌더링 타이밍 문제 대응)
    let attempts = 0;
    const tryScroll = () => {
      if (scrollToVerse() || attempts > 5) {
        setRememberedVerse(null);
        return;
      }
      attempts++;
      setTimeout(tryScroll, 100);
    };
    setTimeout(tryScroll, 50);
  }, [browseVerses, rememberedVerse]);

  // ─── 버전 전환 시 말씀 검색 결과 재조회 ───
  const prevVersion = useRef(version);
  useEffect(() => {
    if (prevVersion.current !== version) {
      prevVersion.current = version;
      // 말씀 검색 결과가 있으면 재실행
      if (searchResults.length > 0 && searchInput.trim()) {
        savedScroll.current = scrollRef.current?.scrollTop ?? 0;
        executeSearch();
      }
      // 주제 추천 결과가 있으면 DB만 재조회 (AI 재호출 없음)
      if (topicRecommendations.length > 0) {
        savedScroll.current = scrollRef.current?.scrollTop ?? 0;
        (async () => {
          const promises = topicRecommendations.map((rec) =>
            supabase
              .from("bible_verses")
              .select("*")
              .eq("version", version)
              .eq("book_name", rec.book)
              .eq("chapter", rec.chapter)
              .eq("verse", rec.verse)
              .single()
          );
          const results = await Promise.all(promises);
          const found: BibleVerse[] = [];
          for (const res of results) {
            if (res.data) found.push(res.data as BibleVerse);
          }
          setTopicResults(found);
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
          });
        })();
      }
    }
  }, [version]);

  // ─── 병기: 검색 결과 + 주제 추천 부 버전 조회 ───
  useEffect(() => {
    if (!parallel) {
      setSearchResultsAlt([]);
      setTopicResultsAlt([]);
      return;
    }
    const altVersion = version === "nkrv" ? "rnksv" : "nkrv";

    // 검색 결과 부 버전
    if (searchResults.length > 0) {
      (async () => {
        const promises = searchResults.map((v) =>
          supabase
            .from("bible_verses")
            .select("*")
            .eq("version", altVersion)
            .eq("book_code", v.book_code)
            .eq("chapter", v.chapter)
            .eq("verse", v.verse)
            .single()
        );
        const results = await Promise.all(promises);
        setSearchResultsAlt(
          results.filter((r) => r.data).map((r) => r.data as BibleVerse)
        );
      })();
    }

    // 주제 추천 부 버전
    if (topicResults.length > 0) {
      (async () => {
        const promises = topicResults.map((v) =>
          supabase
            .from("bible_verses")
            .select("*")
            .eq("version", altVersion)
            .eq("book_code", v.book_code)
            .eq("chapter", v.chapter)
            .eq("verse", v.verse)
            .single()
        );
        const results = await Promise.all(promises);
        setTopicResultsAlt(
          results.filter((r) => r.data).map((r) => r.data as BibleVerse)
        );
      })();
    }
  }, [parallel, searchResults, topicResults, version]);

  // ─── 주제 추천 ───
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

  // ─── Verse toggle with scroll preservation ───
  function handleToggle(verse: BibleVerse) {
    const scrollPos = scrollRef.current?.scrollTop;
    onToggleVerse(verse);
    requestAnimationFrame(() => {
      if (scrollRef.current && scrollPos !== undefined) {
        scrollRef.current.scrollTop = scrollPos;
      }
    });
  }

  // ─── Shared: verse item renderer ───
  function VerseItem({
    verse,
    showBookInfo,
    altText,
  }: {
    verse: BibleVerse;
    showBookInfo?: boolean;
    altText?: string;
  }) {
    const selected = isSelected(verse, selectedVerses);
    return (
      <button
        onClick={() => handleToggle(verse)}
        className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 transition-colors ${
          selected
            ? "bg-gray-100 border-l-4 border-l-gray-400"
            : "hover:bg-gray-50"
        }`}
      >
        {showBookInfo && (
          <div className="text-gray-700 font-semibold text-xs mb-1">
            {verse.book_name} {verse.chapter}:{verse.verse}
          </div>
        )}
        {!showBookInfo && (
          <span
            className={`font-semibold text-sm mr-2 ${selected ? "text-gray-800" : "text-gray-500"}`}
          >
            {verse.verse}
          </span>
        )}
        <span className={`${selected ? "text-gray-900" : "text-gray-700"}`} style={{ fontSize: `${readingFontSize}px` }}>
          {verse.text}
        </span>
        {altText && (
          <div className="mt-1 text-gray-400 leading-relaxed" style={{ fontSize: `${readingFontSize - 2}px` }}>
            {altText}
          </div>
        )}
        {selected && (
          <span className="float-right text-gray-700 text-sm">&#10003;</span>
        )}
      </button>
    );
  }

  // Chapter navigation helpers
  const chapterIdx = chapters.indexOf(chapter);
  const canPrevChapter = chapterIdx > 0;
  const canNextChapter = chapterIdx < chapters.length - 1;

  const tabClass = (tab: SearchMode) =>
    `flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
      mode === tab
        ? "border-b-2 border-gray-900 text-gray-700"
        : "text-gray-500 hover:text-gray-700"
    }`;

  return (
    <div className="w-full max-w-[1200px] mx-auto">
      {/* Header */}
      {!isAddingMore && (
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 font-[family-name:var(--font-noto-serif-kr)]">
            예봄성경
          </h1>
          <p className="text-xs text-gray-400 mt-1 font-[family-name:var(--font-playfair)] italic tracking-wider">
            Yebom Bible Card
          </p>
        </div>
      )}

      {/* Adding more indicator */}
      {isAddingMore && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-800 text-center">
          현재 {selectedVerses.length}절 선택됨 — 추가할 구절을 선택하세요
        </div>
      )}

      {/* Version Toggle */}
      <div className="flex justify-center gap-1.5 mb-4">
        {([["nkrv", "개역개정"], ["rnksv", "새번역"]] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => {
              if (scrollRef.current) {
                if (mode === "chapter") {
                  const btns = scrollRef.current.querySelectorAll("button");
                  const rect = scrollRef.current.getBoundingClientRect();
                  for (const btn of btns) {
                    if (btn.getBoundingClientRect().top >= rect.top) {
                      const m = btn.textContent?.match(/(\d+)절/);
                      if (m) setRememberedVerse(parseInt(m[1]));
                      break;
                    }
                  }
                }
                savedScroll.current = scrollRef.current.scrollTop;
              }
              if (parallel) {
                setVersion(v); // 병기 유지, 주/부 교체
              } else {
                setParallel(false);
                setVersion(v);
              }
            }}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              parallel
                ? version === v
                  ? "bg-gray-900 text-white"
                  : "bg-gray-300 text-gray-600 hover:bg-gray-400"
                : version === v
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setParallel(!parallel)}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
            parallel
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          병기
        </button>
      </div>

      {/* 3 Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <button onClick={() => setMode("search")} className={tabClass("search")}>
          말씀 검색
        </button>
        <button onClick={() => { setMode("chapter"); setBrowseStep("book"); }} className={tabClass("chapter")}>
          장절 선택
        </button>
        <button onClick={() => setMode("topic")} className={tabClass("topic")}>
          주제 추천
        </button>
      </div>

      {/* ─── Tab 1: 말씀 검색 (reference + word unified) ─── */}
      {mode === "search" && (
        <div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && executeSearch()}
              placeholder="창1:1 또는 사랑, 평안"
              className="flex-1 min-w-0 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
              onClick={executeSearch}
              disabled={searchLoading}
              className="shrink-0 px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {searchLoading ? "..." : "검색"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            장절(창1:1-3) 또는 단어(사랑 믿음) · 공백=AND · x=OR
          </p>

          {searchError && (
            <p className="text-sm text-red-500 mb-3 text-center">{searchError}</p>
          )}

          {searchResults.length > 0 && (
            <>
              <div ref={scrollRef} className="border border-gray-200 rounded-lg max-h-[60vh] overflow-y-auto">
                {searchResults.map((v) => {
                  const alt = parallel ? searchResultsAlt.find(
                    (a) => a.book_code === v.book_code && a.chapter === v.chapter && a.verse === v.verse
                  ) : undefined;
                  return <VerseItem key={v.id} verse={v} showBookInfo altText={alt?.text} />;
                })}
              </div>
              {lastSearchType === "word-and" && hasMoreResults && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full py-2.5 mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? "불러오는 중..." : "다음 50건 불러오기"}
                </button>
              )}
              {(lastSearchType === "word-and" || lastSearchType === "word-or") && (
                <p className="text-xs text-gray-400 mt-2 text-center">
                  {searchResults.length}건
                  {lastSearchType === "word-or" && searchResults.length >= 50 && " (OR 검색은 최대 50건까지 표시됩니다)"}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Tab 2: 장절 선택 ─── */}
      {mode === "chapter" && (
        <div>
          {/* Step: 책 선택 (그리드) */}
          {browseStep === "book" && (
            <div>
              {/* 구약/신약 토글 */}
              <div className="flex gap-1 mb-3 bg-gray-50 p-1 rounded-xl">
                <button
                  onClick={() => setBookTestament("old")}
                  className={`flex-1 py-2 text-xs font-medium text-center rounded-lg transition-colors ${
                    bookTestament === "old" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  구약
                </button>
                <button
                  onClick={() => setBookTestament("new")}
                  className={`flex-1 py-2 text-xs font-medium text-center rounded-lg transition-colors ${
                    bookTestament === "new" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  신약
                </button>
              </div>

              {/* 책 그리드 */}
              <div className="grid grid-cols-5 gap-1.5">
                {(bookTestament === "old" ? OLD_TESTAMENT : NEW_TESTAMENT).map((b) => (
                  <button
                    key={b.code}
                    onClick={() => {
                      setBookCode(b.code);
                      setBrowseStep("chapter");
                    }}
                    className={`py-3 rounded-lg text-center transition-colors ${
                      bookCode === b.code
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                    }`}
                  >
                    <span className="text-sm font-medium">{b.abbr}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: 장 선택 (그리드) */}
          {browseStep === "chapter" && (
            <div>
              {/* 헤더: ← 목차로 + 중앙 책이름 */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setBrowseStep("book")}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  목차로
                </button>
                <span className="text-sm font-semibold text-gray-800">
                  {getBookByCode(bookCode)?.nameKr || "책 선택"}
                </span>
                <span className="w-14" />
              </div>

              {/* 장 그리드 */}
              <div className="grid grid-cols-7 gap-1.5">
                {chapters.map((ch) => (
                  <button
                    key={ch}
                    onClick={() => {
                      setChapter(ch);
                      setBrowseStep("verse");
                    }}
                    className={`py-3 rounded-lg text-center transition-colors ${
                      chapter === ch
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
                    }`}
                  >
                    <span className="text-sm">{ch}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step: 절 본문 (리스트) */}
          {browseStep === "verse" && (
            <div>
              {/* 헤더: ← 목차로 | ◀ 책이름 장/총장 ▶ | 가━●━가 */}
              <div className="flex items-center justify-between mb-3">
                {/* 좌: 목차로 */}
                <button
                  onClick={() => setBrowseStep("chapter")}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  목차로
                </button>

                {/* 중앙: ◀ 책이름 장 ▶ */}
                <div className="flex items-center gap-0">
                  <button
                    onClick={() => canPrevChapter && setChapter(chapters[chapterIdx - 1])}
                    disabled={!canPrevChapter}
                    className="px-1 py-1 disabled:opacity-20 disabled:cursor-not-allowed transition-opacity"
                  >
                    <svg className="w-5 h-7 text-gray-400" viewBox="0 0 18 28" fill="currentColor">
                      <path d="M15 4 L4 14 L15 24 Z" />
                    </svg>
                  </button>
                  <span className="text-sm text-gray-600 mx-1">
                    {getBookByCode(bookCode)?.nameKr}{" "}
                    <span className="text-lg font-bold text-gray-900">{chapter}</span>
                    <span className="text-gray-400">/{chapters.length}장</span>
                  </span>
                  <button
                    onClick={() => canNextChapter && setChapter(chapters[chapterIdx + 1])}
                    disabled={!canNextChapter}
                    className="px-1 py-1 disabled:opacity-20 disabled:cursor-not-allowed transition-opacity"
                  >
                    <svg className="w-5 h-7 text-gray-400" viewBox="0 0 18 28" fill="currentColor">
                      <path d="M3 4 L14 14 L3 24 Z" />
                    </svg>
                  </button>
                </div>

                {/* 우: 글자크기 슬라이더 */}
                <div className="flex items-center shrink-0">
                  <span className="text-[10px] text-gray-400">가</span>
                  <input
                    type="range"
                    min={14}
                    max={24}
                    value={readingFontSize}
                    onChange={(e) => setReadingFontSize(Number(e.target.value))}
                    className="w-12 h-1.5 bg-gray-300 rounded-full appearance-none cursor-pointer mx-0.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-600 [&::-webkit-slider-thumb]:rounded-full"
                    title={`글자 크기 ${readingFontSize}px`}
                  />
                  <span className="text-base text-gray-400">가</span>
                </div>
              </div>

              {parallel && browseVersesAlt.length > 0 ? (
                /* 병기 모드 */
                <div ref={scrollRef} className="border border-gray-200 rounded-lg max-h-[60vh] overflow-y-auto">
                  {loadingBrowse ? (
                    <div className="p-4 text-center text-gray-400">불러오는 중...</div>
                  ) : (
                    <>
                      {/* PC: 좌우 2단 헤더 */}
                      <div className="hidden lg:grid lg:grid-cols-2 lg:gap-0 border-b border-gray-200 bg-gray-50 text-xs text-gray-500 font-medium">
                        <div className="px-4 py-2">{version === "nkrv" ? "개역개정" : "새번역"}</div>
                        <div className="px-4 py-2 border-l border-gray-200">{version === "nkrv" ? "새번역" : "개역개정"}</div>
                      </div>

                      {browseVerses.map((v) => {
                        const alt = browseVersesAlt.find((a) => a.verse === v.verse);
                        const selected = isSelected(v, selectedVerses);
                        return (
                          <button
                            key={v.id}
                            onClick={() => handleToggle(v)}
                            className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 transition-colors ${
                              selected ? "bg-gray-100 border-l-4 border-l-gray-400" : "hover:bg-gray-50"
                            }`}
                          >
                            {/* 모바일: 교차 (세로) */}
                            <div className="lg:hidden">
                              <div className="flex items-start gap-1.5">
                                <span className={`font-semibold text-sm shrink-0 ${selected ? "text-gray-800" : "text-gray-500"}`}>
                                  {v.verse}
                                </span>
                                <span className={`${selected ? "text-gray-900" : "text-gray-700"}`} style={{ fontSize: `${readingFontSize}px` }}>
                                  {v.text}
                                </span>
                              </div>
                              {alt && (
                                <div className="mt-1 ml-7 text-gray-400 leading-relaxed" style={{ fontSize: `${readingFontSize - 2}px` }}>
                                  {alt.text}
                                </div>
                              )}
                            </div>

                            {/* PC: 좌우 2단 */}
                            <div className="hidden lg:grid lg:grid-cols-2 lg:gap-4">
                              <div>
                                <span className={`font-semibold text-sm mr-1.5 ${selected ? "text-gray-800" : "text-gray-500"}`}>
                                  {v.verse}
                                </span>
                                <span className={`${selected ? "text-gray-900" : "text-gray-700"}`} style={{ fontSize: `${readingFontSize}px` }}>
                                  {v.text}
                                </span>
                              </div>
                              <div className="text-gray-500 border-l border-gray-100 pl-4" style={{ fontSize: `${readingFontSize - 2}px` }}>
                                <span className="text-gray-400 mr-1.5">{v.verse}</span>
                                {alt?.text || ""}
                              </div>
                            </div>

                            {selected && (
                              <span className="float-right text-gray-700 text-sm">&#10003;</span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : (
                /* 단일 버전 모드 */
                <div ref={scrollRef} className="border border-gray-200 rounded-lg max-h-[60vh] overflow-y-auto">
                  {loadingBrowse ? (
                    <div className="p-4 text-center text-gray-400">불러오는 중...</div>
                  ) : browseVerses.length === 0 ? (
                    <div className="p-4 text-center text-gray-400">구절이 없습니다</div>
                  ) : (
                    browseVerses.map((v) => (
                      <VerseItem key={v.id} verse={v} />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab 3: 주제 추천 ─── */}
      {mode === "topic" && (
        <div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchTopic()}
              placeholder="감사, 위로, 결혼, 장례, 새해 ..."
              className="flex-1 min-w-0 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
              onClick={searchTopic}
              disabled={topicLoading}
              className="shrink-0 px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
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
              <div className="inline-flex items-center gap-2 text-gray-600 text-sm">
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
              <div ref={scrollRef} className="border border-gray-200 rounded-lg max-h-[60vh] overflow-y-auto">
                {topicResults.map((v) => {
                  const alt = parallel ? topicResultsAlt.find(
                    (a) => a.book_code === v.book_code && a.chapter === v.chapter && a.verse === v.verse
                  ) : undefined;
                  return <VerseItem key={v.id} verse={v} showBookInfo altText={alt?.text} />;
                })}
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

      {/* ─── 하단 버튼 ─── */}
      {selectedVerses.length > 0 && (
        <div className="sticky bottom-4 mt-4 space-y-2">
          {mode !== "chapter" && (
            <button
              onClick={() => {
                const lastVerse = selectedVerses[selectedVerses.length - 1];
                setBookCode(lastVerse.book_code);
                setChapter(lastVerse.chapter);
                setRememberedVerse(lastVerse.verse);
                setBrowseStep("verse");
                setMode("chapter");
              }}
              className="w-full py-2.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              본문으로 가기
            </button>
          )}
          <button
            onClick={onConfirm}
            className="w-full py-3 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[#9A7009] transition-colors"
          >
            선택 완료 ({selectedVerses.length}절)
          </button>
        </div>
      )}
    </div>
  );
}
