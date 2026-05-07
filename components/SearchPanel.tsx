"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { OLD_TESTAMENT, NEW_TESTAMENT, getBookByCode } from "@/lib/books";
import { parseReference } from "@/lib/parseReference";
import { stripNotes, type BibleVerse, type BibleVersion, type SearchMode, type AIRecommendation } from "@/lib/types";
import { getVersionLabel } from "@/lib/versions";
import {
  readRecent,
  saveRecent,
  readBookmarks,
  addBookmark,
  removeBookmark,
  formatRelativeTime,
  type BiblePosition,
  type Bookmark,
} from "@/lib/bookmark";
import FullscreenReader, { type FullscreenVerseItem } from "./FullscreenReader";
import { useHardwareBack } from "@/hooks/useHardwareBack";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";
import { useFont, FONTS } from "@/contexts/FontContext";

interface SearchPanelProps {
  selectedVerses: BibleVerse[];
  mainVersion: BibleVersion;
  subVersion: BibleVersion | "none";
  onMainVersionChange: (v: BibleVersion) => void;
  onSubVersionChange: (v: BibleVersion | "none") => void;
  onToggleVerse: (verse: BibleVerse) => void;
  onConfirm: () => void;
  isAddingMore: boolean;
  bulkEditMode?: boolean;
  onVerseUpdated?: (updated: BibleVerse) => void;
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
  mainVersion,
  subVersion,
  onMainVersionChange: setMainVersion,
  onSubVersionChange: setSubVersion,
  onToggleVerse,
  onConfirm,
  isAddingMore,
  bulkEditMode = false,
  onVerseUpdated,
}: SearchPanelProps) {
  const { session, isLoggedIn, loading: sessionLoading } = useSession();
  const adminMode = isAdmin(session);
  // 통독은 로그인 확정 시에만 표시 (loading 중에도 제외해 hydration mismatch 방지)
  const versionOptions: readonly BibleVersion[] = (
    !sessionLoading && isLoggedIn
      ? (["nkrv", "rnksv", "easy", "kjv", "nirv", "gnt"] as const)
      : (["nkrv", "rnksv", "kjv", "nirv", "gnt"] as const)
  );
  // 부 옵션 = 전체 옵션 - 주 버전 (동일 선택 방지)
  const subVersionOptions = versionOptions.filter((v) => v !== mainVersion);

  // 주 변경 시 부 자동 동기화: 부가 새 주와 같으면 이전 주 값으로 swap
  // 로그아웃 가드 (easy → nkrv/none)
  const prevMainRef = useRef(mainVersion);
  useEffect(() => {
    if (!sessionLoading && !isLoggedIn && mainVersion === "easy") {
      setMainVersion("nkrv");
      return;
    }
    if (!sessionLoading && !isLoggedIn && subVersion === "easy") {
      setSubVersion("none");
      return;
    }
    // 주 변경 시 부가 새 주와 동일 → 이전 주 값으로 swap
    if (prevMainRef.current !== mainVersion) {
      if (subVersion === mainVersion) {
        setSubVersion(prevMainRef.current);
      }
      prevMainRef.current = mainVersion;
    }
  }, [sessionLoading, isLoggedIn, mainVersion, subVersion, setMainVersion, setSubVersion]);

  // ⇄ 클릭: 주/부 교환 (부가 "none"이 아닐 때만)
  function handleSwapVersions() {
    if (subVersion === "none") return;
    const oldMain = mainVersion;
    setMainVersion(subVersion as BibleVersion);
    setSubVersion(oldMain);
  }
  const [mode, setMode] = useState<SearchMode>("search");
  const parallel = subVersion !== "none";
  

  // Scroll position preservation
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);

  const { fontSize, fontKey, setShowFontSettings } = useFont();
  const currentFont = FONTS.find((f) => f.key === fontKey) || FONTS[0];

  // ─── 검색 펼침 토글 (D안: [검색▾] 버튼) ───
  const [showSearchRow, setShowSearchRow] = useState(false);
  const [searchHelperShown, setSearchHelperShown] = useState(true);

  // 풀스크린 모드
  const [showFullscreen, setShowFullscreen] = useState(false);

  // ─── 검색 히스토리 (localStorage) ───
  const HISTORY_KEY = "yebom_search_history";
  const MAX_HISTORY = 15;
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addToHistory(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

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

  // ─── 책갈피 시스템 (Recent 자동 + Bookmarks 수동) ───
  const [recent, setRecent] = useState<BiblePosition | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarkMenu, setShowBookmarkMenu] = useState(false);
  useEffect(() => {
    setRecent(readRecent());
    setBookmarks(readBookmarks());
  }, []);
  // verse 단계 진입 후 3초 머물면 Recent 자동 갱신
  useEffect(() => {
    if (mode !== "chapter" || browseStep !== "verse") return;
    if (!bookCode || !chapter) return;
    const t = setTimeout(() => {
      const book = getBookByCode(bookCode);
      if (!book) return;
      const next: Omit<BiblePosition, "savedAt"> = {
        book_code: bookCode,
        book_name: book.nameKr,
        book_abbr: book.abbr,
        chapter,
        version: mainVersion,
      };
      saveRecent(next);
      setRecent({ ...next, savedAt: Date.now() });
    }, 3000);
    return () => clearTimeout(t);
  }, [mode, browseStep, bookCode, chapter, mainVersion]);

  // 위치로 점프
  function jumpTo(pos: BiblePosition | Bookmark) {
    setBookCode(pos.book_code);
    setChapter(pos.chapter);
    setMode("chapter");
    setBrowseStep("verse");
    setShowBookmarkMenu(false);
  }
  // 현재 위치를 책갈피로 추가
  function addCurrentToBookmarks() {
    if (mode !== "chapter" || browseStep !== "verse" || !bookCode || !chapter) return;
    const book = getBookByCode(bookCode);
    if (!book) return;
    const updated = addBookmark({
      book_code: bookCode,
      book_name: book.nameKr,
      book_abbr: book.abbr,
      chapter,
      version: mainVersion,
    });
    setBookmarks(updated);
  }
  function deleteBookmark(id: string) {
    const updated = removeBookmark(id);
    setBookmarks(updated);
  }
  const totalBookmarkCount = (recent ? 1 : 0) + bookmarks.length;
  const canAddCurrent = mode === "chapter" && browseStep === "verse" && !!bookCode && !!chapter;
  const isCurrentInBookmarks = canAddCurrent && bookmarks.some(
    (b) => b.book_code === bookCode && b.chapter === chapter && b.version === mainVersion
  );

  // ─── 클립보드 복사 피드백 ───
  const [copied, setCopied] = useState(false);

  // ─── 관리자: 인라인 편집 (A안) + 편집모드 토글 (B안) ───
  const [editingVerseId, setEditingVerseId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [comparisonVerses, setComparisonVerses] = useState<{ version: string; text: string }[]>([]);
  const [editToast, setEditToast] = useState<string | null>(null);

  async function enterEdit(verse: BibleVerse) {
    setEditingVerseId(verse.id);
    setEditText(verse.text);
    setEditError(null);
    setComparisonVerses([]);
    // 다른 모든 버전 동시 fetch (참조용)
    const ALL = ["nkrv", "rnksv", "easy", "kjv", "nirv", "gnt"];
    const others = ALL.filter((v) => v !== verse.version);
    const { data } = await supabase
      .from("bible_verses")
      .select("version, text")
      .in("version", others)
      .eq("book_code", verse.book_code)
      .eq("chapter", verse.chapter)
      .eq("verse", verse.verse);
    if (data) setComparisonVerses(data as { version: string; text: string }[]);
  }

  function cancelEdit() {
    setEditingVerseId(null);
    setEditText("");
    setEditError(null);
    setComparisonVerses([]);
  }

  async function saveEdit() {
    if (editingVerseId == null) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      setEditError("본문이 비어있을 수 없습니다");
      return;
    }
    // 변경 없으면 그냥 닫기
    const current = [...browseVerses, ...searchResults, ...topicResults, ...browseVersesAlt, ...searchResultsAlt, ...topicResultsAlt]
      .find((v) => v.id === editingVerseId);
    if (current && current.text === trimmed) {
      cancelEdit();
      return;
    }

    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch("/api/admin/verse", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingVerseId, text: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditError(json.error || "저장 실패");
        setEditLoading(false);
        return;
      }
      const updated = json.verse as BibleVerse;
      // 모든 표시 배열 업데이트
      setBrowseVerses((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setSearchResults((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setTopicResults((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setBrowseVersesAlt((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setSearchResultsAlt((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setTopicResultsAlt((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      // 부모(selectedVerses) 동기화
      onVerseUpdated?.(updated);
      setEditToast(`저장됨: ${updated.book_name} ${updated.chapter}:${updated.verse}`);
      setTimeout(() => setEditToast(null), 1800);
      cancelEdit();
    } catch (e) {
      setEditError("네트워크 오류");
      setEditLoading(false);
    }
  }

  // ─── 선택구절 → 형식화된 텍스트 ───
  const VERSION_LABEL: Record<string, string> = { nkrv: "개역", rnksv: "새번역", kjv: "KJV" };

  function formatVerseNums(nums: number[]): string {
    if (nums.length === 0) return "";
    const sorted = [...nums].sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = sorted[0];
    let end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) { end = sorted[i]; }
      else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = sorted[i]; end = sorted[i]; }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return ranges.join(",");
  }

  async function handleCopyToClipboard() {
    if (selectedVerses.length === 0) return;

    // book+chapter 기준 그룹화 (정렬: book_order → chapter → verse)
    const sorted = [...selectedVerses].sort((a, b) => {
      if (a.book_order !== b.book_order) return a.book_order - b.book_order;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });
    const groups: { book_code: string; book_name: string; chapter: number; verses: BibleVerse[] }[] = [];
    for (const v of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.book_code === v.book_code && last.chapter === v.chapter) {
        last.verses.push(v);
      } else {
        groups.push({ book_code: v.book_code, book_name: v.book_name, chapter: v.chapter, verses: [v] });
      }
    }

    // 병기 ON: 영문 버전 조회
    const altVersion = subVersion;
    let altMap = new Map<string, string>();
    if (parallel) {
      try {
        const results = await Promise.all(groups.map((g) =>
          supabase.from("bible_verses").select("*")
            .eq("version", altVersion)
            .eq("book_code", g.book_code)
            .eq("chapter", g.chapter)
            .in("verse", g.verses.map((v) => v.verse))
        ));
        for (const res of results) {
          if (res.data) {
            for (const a of res.data as BibleVerse[]) {
              altMap.set(`${a.book_code}-${a.chapter}-${a.verse}`, stripNotes(a.text));
            }
          }
        }
      } catch { /* 실패 시 병기 라인 생략 */ }
    }

    // 각 그룹 → 형식화
    const parts = groups.map((g) => {
      const mainText = g.verses.map((v) => stripNotes(v.text)).join(" ");
      const range = formatVerseNums(g.verses.map((v) => v.verse));
      const ref = `(${g.book_name} ${g.chapter}장 ${range}절)`;
      let out = `'${mainText}'\n${ref}`;
      if (parallel && altMap.size > 0) {
        const altText = g.verses
          .map((v) => altMap.get(`${v.book_code}-${v.chapter}-${v.verse}`) || "")
          .filter(Boolean)
          .join(" ");
        if (altText) out += `\n${altText} (${getVersionLabel(altVersion)})`;
      }
      return out;
    });

    const fullText = parts.join("\n\n");
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 실패 시 silent */
    }
  }

  // ─── 말씀 검색 (auto-detect: reference or word) ───
  const executeSearch = useCallback(async () => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSearchError("창1:1-3 또는 두려워 말라, 사랑은 언제나");
      return;
    }
    setShowHistory(false);
    addToHistory(trimmed);

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
          .eq("version", mainVersion)
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
              .eq("version", mainVersion)
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
            .eq("version", mainVersion);

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
  }, [searchInput, mainVersion]);

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
        .eq("version", mainVersion);

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
  }, [searchInput, searchOffset, mainVersion]);

  // ─── 장절 선택 (Chapter browse) ───
  useEffect(() => {
    async function loadChapters() {
      // RPC로 DISTINCT chapter 조회 (Supabase 1000행 제한 우회)
      const { data, error } = await supabase.rpc("get_chapters", {
        p_version: mainVersion,
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
  }, [bookCode, mainVersion]);

  useEffect(() => {
    async function loadVerses() {
      if (!chapter) return;
      setLoadingBrowse(true);
      const { data, error } = await supabase
        .from("bible_verses")
        .select("*")
        .eq("version", mainVersion)
        .eq("book_code", bookCode)
        .eq("chapter", chapter)
        .order("verse");

      if (!error && data) {
        setBrowseVerses(data as BibleVerse[]);
      }
      setLoadingBrowse(false);
    }
    loadVerses();
  }, [bookCode, chapter, mainVersion]);

  // 병기 모드: 부 버전 로드
  useEffect(() => {
    if (!parallel || !chapter) { setBrowseVersesAlt([]); return; }
    const altVersion = subVersion;
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
  }, [parallel, bookCode, chapter, mainVersion, subVersion]);

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
  const prevVersion = useRef(mainVersion);
  useEffect(() => {
    if (prevVersion.current !== mainVersion) {
      prevVersion.current = mainVersion;
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
              .eq("version", mainVersion)
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
  }, [mainVersion]);

  // ─── 병기: 검색 결과 + 주제 추천 부 버전 조회 ───
  useEffect(() => {
    if (!parallel) {
      setSearchResultsAlt([]);
      setTopicResultsAlt([]);
      return;
    }
    const altVersion = subVersion;

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
  }, [parallel, searchResults, topicResults, mainVersion, subVersion]);

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
        body: JSON.stringify({ topic: trimmed, version: mainVersion }),
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
          .eq("version", mainVersion)
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
  }, [topicInput, mainVersion]);

  // ─── Verse toggle with scroll preservation ───
  function handleToggle(verse: BibleVerse) {
    // 편집 모드 ON (관리자) → 탭 시 토글 대신 편집 진입
    if (bulkEditMode && adminMode) {
      enterEdit(verse);
      return;
    }
    const scrollPos = scrollRef.current?.scrollTop;
    onToggleVerse(verse);
    requestAnimationFrame(() => {
      if (scrollRef.current && scrollPos !== undefined) {
        scrollRef.current.scrollTop = scrollPos;
      }
    });
  }

  // ─── 편집 폼 (인라인) — VerseItem & 병기 모드 모두에서 사용 ───
  function EditForm({ verse }: { verse: BibleVerse }) {
    return (
      <div
        className="px-4 py-3 border-b border-amber-200 dark:border-amber-800 last:border-b-0 bg-amber-50 dark:bg-amber-950/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2 text-[10px] text-gray-500 dark:text-gray-400">
          <span className="font-mono font-semibold">{verse.book_name} {verse.chapter}:{verse.verse}</span>
          <span className="text-gray-400">·</span>
          <span>{getVersionLabel(verse.version)}</span>
          <span className="ml-auto">{verse.text.length}자 → <span className={editText.length !== verse.text.length ? "font-semibold text-amber-700 dark:text-amber-400" : ""}>{editText.length}자</span></span>
        </div>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
          }}
          autoFocus
          rows={Math.max(2, Math.min(8, Math.ceil(editText.length / 35) + 1))}
          className="w-full px-3 py-2 border border-amber-300 dark:border-amber-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y"
          style={{ fontSize: `${fontSize}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight, lineHeight: 1.5 }}
        />
        {comparisonVerses.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-amber-200 dark:border-amber-800 pt-2">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">참고 (다른 번역)</div>
            {comparisonVerses.map((c) => (
              <div key={c.version} className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                <span className="inline-block min-w-[40px] font-semibold text-gray-700 dark:text-gray-300 mr-1.5">{getVersionLabel(c.version as BibleVersion)}</span>
                {c.text}
              </div>
            ))}
          </div>
        )}
        {editError && (
          <p className="mt-2 text-xs text-red-500">{editError}</p>
        )}
        <div className="flex gap-2 mt-3 justify-end">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={editLoading}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md disabled:opacity-50"
          >
            취소 (Esc)
          </button>
          <button
            type="button"
            onClick={saveEdit}
            disabled={editLoading || editText.trim().length === 0 || editText === verse.text}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-gray-900 rounded-md hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editLoading ? "저장 중..." : "저장 (Enter)"}
          </button>
        </div>
      </div>
    );
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
    if (editingVerseId === verse.id) {
      return <EditForm verse={verse} />;
    }
    const selected = isSelected(verse, selectedVerses);
    return (
      <button
        onClick={() => handleToggle(verse)}
        className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 transition-colors ${
          selected
            ? "bg-gray-100 dark:bg-gray-800 border-l-4 border-l-gray-400"
            : "hover:bg-gray-50 dark:bg-gray-900"
        }`}
      >
        {showBookInfo && (
          <div className="text-gray-700 dark:text-gray-300 font-semibold text-xs mb-1">
            {verse.book_name} {verse.chapter}:{verse.verse}
          </div>
        )}
        {!showBookInfo && (
          <span
            className={`font-semibold text-sm mr-2 ${selected ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}
          >
            {verse.verse}
          </span>
        )}
        <span className={`${selected ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`} style={{ fontSize: `${fontSize}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
          {verse.text}
        </span>
        {altText && (
          <div className="mt-1 text-gray-400 leading-relaxed" style={{ fontSize: `${fontSize - 2}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
            {altText}
          </div>
        )}
        {selected && (
          <span className="float-right text-gray-700 dark:text-gray-300 text-sm">&#10003;</span>
        )}
      </button>
    );
  }

  // Chapter navigation helpers
  const chapterIdx = chapters.indexOf(chapter);
  const canPrevChapter = chapterIdx > 0;
  const canNextChapter = chapterIdx < chapters.length - 1;

  // 현재 탭의 표시 구절 (풀스크린 입력용)
  const visibleMain: BibleVerse[] = useMemo(() => {
    if (mode === "search") return searchResults;
    if (mode === "chapter" && browseStep === "verse") return browseVerses;
    if (mode === "topic") return topicResults;
    return [];
  }, [mode, browseStep, searchResults, browseVerses, topicResults]);

  const visibleAlt: BibleVerse[] = useMemo(() => {
    if (mode === "search") return searchResultsAlt;
    if (mode === "chapter" && browseStep === "verse") return browseVersesAlt;
    if (mode === "topic") return topicResultsAlt;
    return [];
  }, [mode, browseStep, searchResultsAlt, browseVersesAlt, topicResultsAlt]);

  const mainVersionLabel = getVersionLabel(mainVersion);
  const subVersionLabel = getVersionLabel(subVersion);

  const fullscreenVerses: FullscreenVerseItem[] = useMemo(() => {
    return visibleMain.map((v) => {
      const alt = visibleAlt.find(
        (a) => a.book_code === v.book_code && a.chapter === v.chapter && a.verse === v.verse
      );
      return {
        ref: `${v.book_name} ${v.chapter}장 ${v.verse}절`,
        main: stripNotes(v.text),
        sub: alt ? stripNotes(alt.text) : undefined,
      };
    });
  }, [visibleMain, visibleAlt]);

  const canFullscreen = visibleMain.length > 0;

  // 풀스크린 버튼 (말씀검색 / 주제추천 탭용)
  const fontSlider = (
    <div className="flex items-center justify-end mb-2 gap-2">

      <button
        type="button"
        onClick={() => setShowFullscreen(true)}
        disabled={!canFullscreen}
        title="풀스크린 (빔프로젝터 읽기 모드)"
        aria-label="전체화면"
        className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm dark:shadow-none hover:bg-gray-50 dark:bg-gray-900 hover:text-gray-800 dark:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        전체화면
      </button>
    </div>
  );

  return (
    <div className="w-full max-w-[1200px] mx-auto">
      {/* 관리자 편집 모드 ON 배너 */}
      {bulkEditMode && adminMode && (
        <div className="mb-2 px-3 py-2 bg-amber-100 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-md flex items-center gap-2 text-xs">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
          <span className="flex-1 text-amber-800 dark:text-amber-300 font-medium">
            <span className="font-bold">편집 모드 ON</span> — 절을 탭하면 바로 수정
          </span>
          <span className="text-[10px] text-amber-700 dark:text-amber-500">⚙ 도구함에서 OFF</span>
        </div>
      )}
      {showFullscreen && (
        <FullscreenReader
          verses={fullscreenVerses}
          mainVersion={mainVersion}
          subVersion={subVersion}
          onMainVersionChange={setMainVersion}
          onSubVersionChange={setSubVersion}
          
          
          onOverscrollNext={
            mode === "chapter" && browseStep === "verse" && canNextChapter
              ? () => setChapter(chapters[chapterIdx + 1])
              : undefined
          }
          onOverscrollPrev={
            mode === "chapter" && browseStep === "verse" && canPrevChapter
              ? () => setChapter(chapters[chapterIdx - 1])
              : undefined
          }
          onClose={() => setShowFullscreen(false)}
        />
      )}
      {/* Header — D안: 브랜드(Yebom/BIBLE) + 셀렉터 + Aa (셀렉터·Aa 동일 30px) */}
      {!isAddingMore && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="text-gray-900 dark:text-gray-100 shrink-0">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <div className="flex flex-col">
              <div
                className="text-gray-400 dark:text-gray-500"
                style={{ fontSize: "8px", fontWeight: 500, letterSpacing: "5.6px", paddingLeft: "5.6px", lineHeight: 1, textAlign: "center" }}
              >
                Yebom
              </div>
              <div
                className="italic text-gray-700 dark:text-gray-200 font-[family-name:var(--font-playfair)]"
                style={{ fontSize: "20px", fontWeight: 400, letterSpacing: "0.5px", lineHeight: 1, marginTop: "4px" }}
              >
                BIBLE
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={mainVersion}
              onChange={(e) => setMainVersion(e.target.value as BibleVersion)}
              className="text-[11px] font-semibold bg-gray-900 text-white border-none outline-none cursor-pointer"
              style={{
                height: "30px",
                paddingLeft: "10px",
                paddingRight: "20px",
                borderRadius: "4px",
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23ffffff' opacity='0.7' d='M4 6L0 2h8z'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 7px center",
                backgroundSize: "8px",
              }}
            >
              {versionOptions.map((v) => (
                <option key={v} value={v}>{getVersionLabel(v)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSwapVersions}
              disabled={subVersion === "none"}
              title="주/부 버전 교환"
              aria-label="주/부 버전 교환"
              className="text-gray-400 dark:text-gray-500 text-[10px] px-0.5 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ⇄
            </button>
            <select
              value={subVersion}
              onChange={(e) => setSubVersion(e.target.value as BibleVersion | "none")}
              className="text-[11px] font-semibold bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 outline-none cursor-pointer"
              style={{
                height: "30px",
                paddingLeft: "10px",
                paddingRight: "20px",
                borderRadius: "4px",
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%236b7280' d='M4 6L0 2h8z'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 7px center",
                backgroundSize: "8px",
              }}
            >
              <option value="none">대역</option>
              {subVersionOptions.map((v) => (
                <option key={v} value={v}>{getVersionLabel(v)}</option>
              ))}
            </select>
            <button
              onClick={() => setShowFontSettings(true)}
              title="글꼴 설정"
              className="flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              style={{ width: "30px", height: "30px", borderRadius: "4px" }}
            >
              <span className="font-[family-name:var(--font-noto-serif-kr)] font-bold text-[13px] leading-none">Aa</span>
            </button>
          </div>
        </div>
      )}

      {/* Adding more indicator */}
      {isAddingMore && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm text-gray-800 dark:text-gray-200 text-center">
          현재 {selectedVerses.length}절 선택됨 — 추가할 구절을 선택하세요
        </div>
      )}

      {/* D안: 3버튼 액션 (성경목차 / 책갈피 / 검색▾) */}
      {!isAddingMore && (
        <>
          <div className="grid grid-cols-3 gap-1.5 mb-2 relative">
            <button
              onClick={() => { setMode("chapter"); setBrowseStep("book"); setShowBookmarkMenu(false); setShowSearchRow(false); }}
              className="h-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              style={{ borderRadius: "4px" }}
            >
              <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              성경목차
            </button>
            <button
              onClick={() => { setShowBookmarkMenu(!showBookmarkMenu); setShowSearchRow(false); }}
              className={`h-10 border ${totalBookmarkCount > 0 ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950" : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"} hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors`}
              style={{ borderRadius: "4px" }}
            >
              <svg className={`w-3.5 h-3.5 ${totalBookmarkCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              책갈피
              {totalBookmarkCount > 0 && (
                <span className="text-[9px] bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-1 rounded-sm font-medium ml-0.5">{totalBookmarkCount}</span>
              )}
            </button>
            <button
              onClick={() => {
                const next = !showSearchRow;
                setShowSearchRow(next);
                setShowBookmarkMenu(false);
                if (next) setSearchHelperShown(true);
              }}
              className={`h-10 border flex items-center justify-center gap-1.5 transition-colors text-xs font-semibold ${
                showSearchRow
                  ? "bg-gray-900 dark:bg-gray-700 border-gray-900 dark:border-gray-700 text-white"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
              style={{ borderRadius: "4px" }}
            >
              <svg className={`w-3.5 h-3.5 ${showSearchRow ? "text-white" : "text-gray-500 dark:text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607Z" />
              </svg>
              검색
              <svg className={`w-2.5 h-2.5 ${showSearchRow ? "text-white" : "text-gray-400"} transition-transform ${showSearchRow ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* 책갈피 펼침 메뉴 */}
            {showBookmarkMenu && (
              <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg dark:shadow-none overflow-hidden">
                {/* 최근 (자동) */}
                {recent && (
                  <button
                    onClick={() => jumpTo(recent)}
                    className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-amber-50 dark:hover:bg-amber-950 border-b border-gray-100 dark:border-gray-700 text-left"
                  >
                    <span className="text-amber-600 dark:text-amber-400 text-sm shrink-0">⚡</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                        최근: {recent.book_name} {recent.chapter}장
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">{formatRelativeTime(recent.savedAt)} · 자동 갱신</div>
                    </div>
                  </button>
                )}
                {/* 수동 책갈피 목록 */}
                {bookmarks.length > 0 && (
                  <div className="max-h-64 overflow-y-auto">
                    {bookmarks.map((b) => (
                      <div key={b.id} className="flex items-center hover:bg-gray-50 dark:hover:bg-gray-900 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                        <button
                          onClick={() => jumpTo(b)}
                          className="flex-1 px-3 py-2.5 flex items-center gap-2 text-left min-w-0"
                        >
                          <span className="text-amber-600 dark:text-amber-400 text-sm shrink-0">🔖</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                              {b.book_name} {b.chapter}장
                            </div>
                            <div className="text-[10px] text-gray-500 dark:text-gray-400">{formatRelativeTime(b.savedAt)}</div>
                          </div>
                        </button>
                        <button
                          onClick={() => b.id && deleteBookmark(b.id)}
                          className="p-2 mr-1 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
                          title="삭제"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* 현재 위치 추가 */}
                {canAddCurrent && (
                  <button
                    onClick={addCurrentToBookmarks}
                    disabled={isCurrentInBookmarks}
                    className="w-full px-3 py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-50 disabled:cursor-not-allowed border-t border-gray-100 dark:border-gray-700"
                  >
                    <span>+</span>
                    {isCurrentInBookmarks
                      ? "이미 책갈피에 있습니다"
                      : `현재 위치(${getBookByCode(bookCode)?.nameKr ?? ""} ${chapter}장) 추가`}
                  </button>
                )}
                {!recent && bookmarks.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-gray-400 italic">
                    성경 본문을 읽으면 자동으로 기록됩니다
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 검색 펼침 행 (showSearchRow 시) */}
          {showSearchRow && (
            <div className="mb-2">
              <div className="flex gap-1.5 mb-1.5">
                <div className="relative flex-1 min-w-0">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607Z" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchInput}
                    onChange={(e) => { setSearchInput(e.target.value); setShowHistory(false); }}
                    onFocus={() => { if (searchHistory.length > 0 && !searchInput) setShowHistory(true); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { setMode("search"); setSearchHelperShown(false); executeSearch(); } if (e.key === "Escape") setShowHistory(false); }}
                    onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                    placeholder="창1:1, 두려워 말라…"
                    className="w-full h-9 pl-8 pr-3 border border-gray-300 dark:border-gray-600 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    style={{ borderRadius: "4px" }}
                  />
                  {showHistory && !searchInput && searchHistory.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg dark:shadow-none max-h-48 overflow-y-auto">
                      <div className="px-3 py-2 text-xs text-gray-400 font-medium">최근 검색어</div>
                      {searchHistory.map((h, i) => (
                        <div
                          key={i}
                          className="w-full px-3 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900 flex items-center justify-between cursor-pointer"
                        >
                          <span className="flex-1" onMouseDown={() => { setSearchInput(h); setShowHistory(false); }}>{h}</span>
                          <button
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = searchHistory.filter(term => term !== h);
                              setSearchHistory(next);
                              try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-400 rounded"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setMode("search"); setSearchHelperShown(false); executeSearch(); }}
                  disabled={searchLoading}
                  className="shrink-0 h-9 px-3 bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  style={{ borderRadius: "4px" }}
                >
                  {searchLoading && mode === "search" ? "..." : "본문"}
                </button>
                <button
                  onClick={() => {
                    setMode("topic");
                    setTopicInput(searchInput);
                    setSearchHelperShown(false);
                    setTimeout(() => searchTopic(), 0);
                  }}
                  disabled={topicLoading}
                  className="shrink-0 h-9 px-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-50 dark:bg-gray-900 disabled:opacity-50 transition-colors"
                  style={{ borderRadius: "4px" }}
                >
                  {topicLoading && mode === "topic" ? "..." : "주제"}
                </button>
              </div>
              {searchHelperShown && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                  <span className="font-semibold text-gray-500 dark:text-gray-400">본문</span> 창1:1·두려워 말라
                  &nbsp;·&nbsp;
                  <span className="font-semibold text-gray-500 dark:text-gray-400">주제</span> 감사·위로·새해
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Tab 1: 말씀 검색 결과 ─── */}
      {mode === "search" && (
        <div>
          {searchError && (
            <p className="text-sm text-red-500 mb-3 text-center">{searchError}</p>
          )}

          {searchResults.length > 0 && (
            <>
              {fontSlider}
              <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[60vh] overflow-y-auto">
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
                  className="w-full py-2.5 mt-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded-lg hover:bg-gray-100 dark:bg-gray-800 disabled:opacity-50 transition-colors"
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
              <div className="flex gap-1 mb-3 bg-gray-50 dark:bg-gray-900 p-1 rounded-xl">
                <button
                  onClick={() => setBookTestament("old")}
                  className={`flex-1 py-2 text-xs font-medium text-center rounded-lg transition-colors ${
                    bookTestament === "old" ? "bg-gray-900 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:bg-gray-800"
                  }`}
                >
                  구약
                </button>
                <button
                  onClick={() => setBookTestament("new")}
                  className={`flex-1 py-2 text-xs font-medium text-center rounded-lg transition-colors ${
                    bookTestament === "new" ? "bg-gray-900 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:bg-gray-800"
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
                        : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900 active:bg-gray-100 dark:bg-gray-800"
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
                  className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  목차로
                </button>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
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
                        : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900 active:bg-gray-100 dark:bg-gray-800"
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
                  className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300 transition-colors shrink-0"
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
                  <span className="text-sm text-gray-600 dark:text-gray-400 mx-1">
                    {getBookByCode(bookCode)?.nameKr}{" "}
                    <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{chapter}</span>
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

                {/* 우: 풀스크린 버튼 */}
                <div className="flex items-center shrink-0 gap-1.5">

                  <button
                    type="button"
                    onClick={() => setShowFullscreen(true)}
                    disabled={!canFullscreen}
                    title="풀스크린 (빔프로젝터 읽기 모드)"
                    aria-label="전체화면"
                    className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm dark:shadow-none hover:bg-gray-50 dark:bg-gray-900 hover:text-gray-800 dark:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    전체화면
                  </button>
                </div>
              </div>

              {parallel && browseVersesAlt.length > 0 ? (
                /* 병기 모드 */
                <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[60vh] overflow-y-auto">
                  {loadingBrowse ? (
                    <div className="p-4 text-center text-gray-400">불러오는 중...</div>
                  ) : (
                    <>
                      {/* PC: 좌우 2단 헤더 */}
                      <div className="hidden lg:grid lg:grid-cols-2 lg:gap-0 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        <div className="px-4 py-2">{mainVersionLabel}</div>
                        <div className="px-4 py-2 border-l border-gray-200 dark:border-gray-700">{subVersionLabel}</div>
                      </div>

                      {browseVerses.map((v) => {
                        const alt = browseVersesAlt.find((a) => a.verse === v.verse);
                        // 편집 중인 절: EditForm으로 교체 (주절 또는 대역절 모두 처리)
                        if (editingVerseId === v.id) {
                          return <EditForm key={v.id} verse={v} />;
                        }
                        if (alt && editingVerseId === alt.id) {
                          return <EditForm key={alt.id} verse={alt} />;
                        }
                        const selected = isSelected(v, selectedVerses);
                        return (
                          <button
                            key={v.id}
                            onClick={() => handleToggle(v)}
                            className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 transition-colors ${
                              selected ? "bg-gray-100 dark:bg-gray-800 border-l-4 border-l-gray-400" : "hover:bg-gray-50 dark:bg-gray-900"
                            }`}
                          >
                            {/* 모바일: 교차 (세로) */}
                            <div className="lg:hidden">
                              <div className="flex items-start gap-1.5">
                                <span className={`font-semibold text-sm shrink-0 ${selected ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}>
                                  {v.verse}
                                </span>
                                <span className={`${selected ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`} style={{ fontSize: `${fontSize}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
                                  {v.text}
                                </span>
                              </div>
                              {alt && (
                                <div className="mt-1 ml-7 text-gray-400 leading-relaxed" style={{ fontSize: `${fontSize - 2}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
                                  {alt.text}
                                </div>
                              )}
                            </div>

                            {/* PC: 좌우 2단 */}
                            <div className="hidden lg:grid lg:grid-cols-2 lg:gap-4">
                              <div>
                                <span className={`font-semibold text-sm mr-1.5 ${selected ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}>
                                  {v.verse}
                                </span>
                                <span className={`${selected ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`} style={{ fontSize: `${fontSize}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
                                  {v.text}
                                </span>
                              </div>
                              <div className="text-gray-500 dark:text-gray-400 border-l border-gray-100 dark:border-gray-800 pl-4" style={{ fontSize: `${fontSize - 2}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
                                <span className="text-gray-400 mr-1.5">{v.verse}</span>
                                {alt?.text || ""}
                              </div>
                            </div>

                            {selected && (
                              <span className="float-right text-gray-700 dark:text-gray-300 text-sm">&#10003;</span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : (
                /* 단일 버전 모드 */
                <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[60vh] overflow-y-auto">
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

      {/* ─── Tab 3: 주제 추천 결과 ─── */}
      {mode === "topic" && (
        <div>

          {topicError && (
            <p className="text-sm text-red-500 mb-3 text-center">
              {topicError}
            </p>
          )}

          {topicLoading && (
            <div className="p-8 text-center">
              <div className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm">
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
              {fontSlider}
              <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[60vh] overflow-y-auto">
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

      {/* ─── 플로팅 액션 (선택 절이 있을 때) ─── */}
      {selectedVerses.length > 0 && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-40 flex flex-col items-end gap-2 pointer-events-none">
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
              className="pointer-events-auto px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-md dark:shadow-none hover:bg-gray-50 dark:bg-gray-900 active:scale-95 transition-all"
            >
              본문으로 가기
            </button>
          )}
          <button
            onClick={handleCopyToClipboard}
            className="pointer-events-auto px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-md dark:shadow-none hover:bg-gray-50 dark:bg-gray-900 active:scale-95 transition-all"
          >
            {copied ? "✓ 복사됨" : "클립보드 복사"}
          </button>
          {/* 관리자: 단일 선택 시 [수정] 진입 (A안) */}
          {adminMode && !bulkEditMode && selectedVerses.length === 1 && editingVerseId == null && (
            <button
              onClick={() => enterEdit(selectedVerses[0])}
              className="pointer-events-auto px-4 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-full shadow-md dark:shadow-none hover:bg-amber-100 dark:hover:bg-amber-900/40 active:scale-95 transition-all flex items-center gap-1.5"
              title="이 절을 수정"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              수정
            </button>
          )}
          <button
            onClick={onConfirm}
            className="pointer-events-auto px-5 py-3 text-sm font-semibold text-white bg-[#B8860B] rounded-full shadow-xl hover:bg-[#9A7009] active:scale-95 transition-all flex items-center gap-2"
          >
            선택 완료
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-xs font-semibold bg-white/25 text-white rounded-full">
              {selectedVerses.length}
            </span>
          </button>
        </div>
      )}

      {/* 관리자 편집 결과 토스트 */}
      {editToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-3 py-2 bg-amber-600 text-white text-xs font-semibold rounded-lg shadow-lg z-[200] animate-[fadeInUp_0.2s_ease-out]">
          {editToast}
        </div>
      )}
    </div>
  );
}
