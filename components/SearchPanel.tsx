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
import QuickNavFab from "./QuickNavFab";
import HomeBlankContent from "./HomeBlankContent";
import TTSButton from "./TTSButton";
import { useTts, type TtsTrack } from "@/contexts/TtsContext";
import { useHardwareBack, getActiveModalCount } from "@/hooks/useHardwareBack";
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

  // ─── 검색 펼침 토글 + 모드 (본문검색 vs 주제추천) ───
  const [showSearchRow, setShowSearchRow] = useState(false);
  const [searchHelperShown, setSearchHelperShown] = useState(true);
  const [searchMode, setSearchMode] = useState<"ref" | "topic">("ref");

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

  // 검색 펼침 시 입력창 자동 포커스
  useEffect(() => {
    if (showSearchRow) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showSearchRow]);

  function addToHistory(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ─── Unified search state (reference + word merged, multi-version) ───
  const [searchInput, setSearchInput] = useState("");
  // 모든 버전을 한 번에 검색해 그룹별로 보관 (있는 버전 먼저, 없는 버전 뒤로)
  const [searchByVersion, setSearchByVersion] = useState<{ version: BibleVersion; verses: BibleVerse[] }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [lastSearchType, setLastSearchType] = useState<"ref" | "word-and" | "word-or" | null>(null);
  const [topicResultsAlt, setTopicResultsAlt] = useState<BibleVerse[]>([]);
  // 풀스크린 등 외부에서 사용하는 mainVersion 결과 (호환용 derived)
  const searchResults = useMemo(
    () => searchByVersion.find((g) => g.version === mainVersion)?.verses ?? [],
    [searchByVersion, mainVersion]
  );

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
  // 첫 마운트 시 최근 위치로 자동 점프 (한 번만)
  // ?fresh=1 param 있으면 자동 점프 스킵 (예: /share에서 홈으로 누른 경우)
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    const r = readRecent();
    setRecent(r);
    setBookmarks(readBookmarks());
    if (bootstrappedRef.current) return;

    // URL ?fresh=1 검사: 블랭크 홈으로 시작
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("fresh") === "1") {
        bootstrappedRef.current = true;
        // URL 정리 (fresh param 제거)
        window.history.replaceState(window.history.state, "", "/");
        return;
      }
    }

    if (r && r.book_code && r.chapter) {
      bootstrappedRef.current = true;
      setBookCode(r.book_code);
      setChapter(r.chapter);
      setMode("chapter");
      setBrowseStep("verse");
      if (r.version) setMainVersion(r.version);
      if (r.subVersion !== undefined) setSubVersion(r.subVersion);
    }
  }, []);

  // ─── 하드웨어 뒤로가기: 다단계 (verse → chapter → book → 블랭크 홈 → 종료팝업) ───
  // 모달성(showSearchRow/showBookmarkMenu/editingVerseId)은 마지막에 등록되어 stack top → 우선 처리
  useHardwareBack(
    mode === "chapter" && browseStep === "verse" && !isAddingMore,
    () => setBrowseStep("chapter")
  );
  useHardwareBack(
    mode === "chapter" && browseStep === "chapter" && !isAddingMore,
    () => setBrowseStep("book")
  );
  useHardwareBack(
    mode === "chapter" && browseStep === "book" && !isAddingMore,
    () => setMode("search")
  );
  useHardwareBack(
    mode === "search" && searchByVersion.some((g) => g.verses.length > 0),
    () => { setSearchByVersion([]); setSearchError(""); }
  );
  useHardwareBack(
    mode === "topic" && (topicResults.length > 0 || topicRecommendations.length > 0),
    () => { setTopicResults([]); setTopicRecommendations([]); setTopicError(""); }
  );
  // 모달성: 검색 펼침 행 / 책갈피 메뉴 (verse browse + 편집은 별도 hook)
  useHardwareBack(showSearchRow, () => setShowSearchRow(false));
  useHardwareBack(showBookmarkMenu, () => setShowBookmarkMenu(false));

  // ─── 키보드: ← 이전장 / → 다음장 / Space 스마트 다음장 (PC) ───
  useEffect(() => {
    if (mode !== "chapter" || browseStep !== "verse") return;
    if (showFullscreen) return;

    const handler = (e: KeyboardEvent) => {
      // 입력 요소에 포커스 있으면 무시
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      // 모디파이어 키 있으면 무시 (Ctrl/Shift/Alt/Meta+화살표 = 텍스트 선택 등)
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      // verse useHardwareBack 외에 다른 모달/메뉴 열림 시 무시
      // (verse 핸들러 1개는 기본 — 그 이상이면 책갈피 메뉴, 검색 펼침, 편집 등이 열린 상태)
      if (getActiveModalCount() > 1) return;

      const idx = chapters.indexOf(chapter);
      const canPrev = idx > 0;
      const canNext = idx >= 0 && idx < chapters.length - 1;

      if (e.key === "ArrowLeft") {
        if (canPrev) {
          e.preventDefault();
          setChapter(chapters[idx - 1]);
        }
      } else if (e.key === "ArrowRight") {
        if (canNext) {
          e.preventDefault();
          setChapter(chapters[idx + 1]);
        }
      } else if (e.key === " " || e.code === "Space") {
        if (!canNext) return;
        // 스마트 Space: 본문 컨테이너가 하단까지 스크롤됐을 때만 다음 장
        const container = scrollRef.current;
        if (container) {
          const atBottom =
            container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
          if (!atBottom) return; // 평소처럼 스크롤 (preventDefault 안 함)
        }
        e.preventDefault();
        setChapter(chapters[idx + 1]);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, browseStep, showFullscreen, chapters, chapter]);

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
        subVersion,
      };
      saveRecent(next);
      setRecent({ ...next, savedAt: Date.now() });
    }, 3000);
    return () => clearTimeout(t);
  }, [mode, browseStep, bookCode, chapter, mainVersion, subVersion]);

  // 위치로 점프 — 번역본(주·부)도 함께 복원
  function jumpTo(pos: BiblePosition | Bookmark) {
    setBookCode(pos.book_code);
    setChapter(pos.chapter);
    setMode("chapter");
    setBrowseStep("verse");
    setShowBookmarkMenu(false);
    // 저장 당시 번역본 복원 (없으면 현재 유지)
    if (pos.version) setMainVersion(pos.version);
    if (pos.subVersion !== undefined) setSubVersion(pos.subVersion);
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
      subVersion,
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

  // ─── TTS (본문 읽기) ───
  const tts = useTts();
  const ttsActiveOnThisChapter =
    tts.status !== "idle" &&
    tts.currentTrack?.bookCode === bookCode &&
    tts.currentTrack?.chapter === chapter;

  const buildTtsTracks = useCallback(
    (verses: BibleVerse[]): TtsTrack[] =>
      verses
        .filter((v) => v.text && v.text.trim().length > 0)
        .map((v) => ({
          text: stripNotes(v.text),
          ref: `${v.book_name} ${v.chapter}:${v.verse}`,
          version: v.version,
          bookCode: v.book_code,
          bookName: v.book_name,
          chapter: v.chapter,
          verse: v.verse,
        })),
    [],
  );

  const loadNextChapterForTts = useCallback(async (): Promise<TtsTrack[] | null> => {
    const idx = chapters.indexOf(chapter);
    if (idx === -1 || idx >= chapters.length - 1) return null;
    const nextCh = chapters[idx + 1];
    const { data } = await supabase
      .from("bible_verses")
      .select("*")
      .eq("version", mainVersion)
      .eq("book_code", bookCode)
      .eq("chapter", nextCh)
      .order("verse");
    if (!data || data.length === 0) return null;
    setChapter(nextCh);
    return buildTtsTracks(data as BibleVerse[]);
  }, [bookCode, chapter, chapters, mainVersion, buildTtsTracks]);

  const handleTtsToggle = useCallback(() => {
    if (ttsActiveOnThisChapter) {
      tts.stop();
      return;
    }
    const tracks = buildTtsTracks(browseVerses);
    if (tracks.length === 0) return;
    tts.start({ tracks, loadNextChapter: loadNextChapterForTts });
  }, [ttsActiveOnThisChapter, tts, browseVerses, buildTtsTracks, loadNextChapterForTts]);

  // TTS 재생 중 현재 절을 화면 중앙으로 스크롤
  useEffect(() => {
    if (!ttsActiveOnThisChapter || !tts.currentTrack) return;
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector(
      `[data-book="${tts.currentTrack.bookCode}"][data-chapter="${tts.currentTrack.chapter}"][data-verse="${tts.currentTrack.verse}"]`,
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [tts.currentTrack, ttsActiveOnThisChapter]);

  // 사용자가 chapter 화살표/키보드/QuickNav 등으로 같은 책의 다른 장으로 이동 시 TTS 도 따라가기.
  // auto-next 경로는 TtsContext 가 먼저 currentTrack 을 새 장으로 갱신하므로 이 useEffect 는 skip.
  useEffect(() => {
    if (browseVerses.length === 0) return;
    if (tts.status === "idle" || !tts.currentTrack) return;
    if (tts.currentTrack.bookCode !== bookCode) return;
    if (tts.currentTrack.chapter === chapter) return;
    const tracks = buildTtsTracks(browseVerses);
    if (tracks.length === 0) return;
    tts.start({ tracks, loadNextChapter: loadNextChapterForTts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookCode, chapter, browseVerses]);

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
    setEditLoading(false);  // 이전 편집의 잔존 로딩 상태 리셋
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
    setEditLoading(false);
    setComparisonVerses([]);
  }

  // 편집 모드는 가장 안쪽 상태 — useHardwareBack 스택에서 top이 되도록 마지막에 등록
  useHardwareBack(editingVerseId !== null, () => cancelEdit());

  async function saveEdit() {
    if (editingVerseId == null) return;
    const trimmed = editText.trim();
    if (!trimmed) {
      setEditError("본문이 비어있을 수 없습니다");
      return;
    }
    // 변경 없으면 그냥 닫기
    const allSearchVerses = searchByVersion.flatMap((g) => g.verses);
    const current = [...browseVerses, ...allSearchVerses, ...topicResults, ...browseVersesAlt, ...topicResultsAlt]
      .find((v) => v.id === editingVerseId);
    if (current && current.text === trimmed) {
      cancelEdit();
      return;
    }

    const targetId = editingVerseId; // 저장 시점 id 캡처 (race 방지)
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch("/api/admin/verse", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: targetId, text: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json.error || `저장 실패 (${res.status})`);
        return;
      }
      const updated = (json.verse ?? { id: targetId, text: trimmed }) as BibleVerse;
      // 모든 표시 배열 업데이트
      setBrowseVerses((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setSearchByVersion((prev) =>
        prev.map((g) => ({
          ...g,
          verses: g.verses.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)),
        }))
      );
      setTopicResults((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setBrowseVersesAlt((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      setTopicResultsAlt((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
      // 부모(selectedVerses) 동기화
      onVerseUpdated?.(updated);
      const where = updated.book_name && updated.chapter && updated.verse
        ? `${updated.book_name} ${updated.chapter}:${updated.verse}`
        : "구절";
      setEditToast(`저장됨: ${where}`);
      setTimeout(() => setEditToast(null), 1800);
      // 저장 완료된 verse가 현재 편집 중인 것과 같을 때만 닫기 (race 방지)
      if (editingVerseId === targetId) {
        cancelEdit();
      }
    } catch (e) {
      setEditError("네트워크 오류");
    } finally {
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

  // ─── 말씀 검색 (모든 버전 동시 검색, 결과 있는 버전부터 정렬) ───
  const PREFERRED_VERSION_ORDER: BibleVersion[] = ["nkrv", "rnksv", "easy", "kjv", "nirv", "gnt"];
  const KOREAN_VERSIONS: BibleVersion[] = ["nkrv", "rnksv", "easy"];
  const ENGLISH_VERSIONS: BibleVersion[] = ["kjv", "nirv", "gnt"];
  const hasKorean = (s: string) => /[가-힯]/.test(s);
  const executeSearch = useCallback(async () => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSearchError("창1:1-3 또는 두려워 말라, 사랑은 언제나");
      return;
    }
    setShowHistory(false);
    addToHistory(trimmed);

    // 통독은 로그인 시에만
    const allVersions: BibleVersion[] = (!sessionLoading && isLoggedIn)
      ? PREFERRED_VERSION_ORDER
      : PREFERRED_VERSION_ORDER.filter((v) => v !== "easy");

    const parsed = parseReference(trimmed);

    if (parsed) {
      // === Reference search: 모든 버전 (절 비교 가치 있음) ===
      setLastSearchType("ref");
      setSearchError("");
      setSearchLoading(true);

      try {
        const queries = allVersions.map((v) => {
          let q = supabase
            .from("bible_verses")
            .select("*")
            .eq("version", v)
            .eq("book_code", parsed.bookCode)
            .eq("chapter", parsed.chapter);
          if (parsed.verses.length > 0) q = q.in("verse", parsed.verses);
          return q.order("verse");
        });
        const results = await Promise.all(queries);
        const groups = allVersions.map((v, i) => ({
          version: v,
          verses: ((results[i].data ?? []) as BibleVerse[]),
        }));
        // 결과 있는 것 먼저, 없는 것 나중 (preferred order 유지)
        const sorted = [
          ...groups.filter((g) => g.verses.length > 0),
          ...groups.filter((g) => g.verses.length === 0),
        ];
        setSearchByVersion(sorted);
        const totalCount = sorted.reduce((acc, g) => acc + g.verses.length, 0);
        if (totalCount === 0) {
          setSearchError("해당 구절을 찾을 수 없습니다");
        }
        // 자동 선택: 주성경 결과가 정확히 1개일 때만
        const mainGroup = sorted.find((g) => g.version === mainVersion);
        if (mainGroup?.verses.length === 1 && !isSelected(mainGroup.verses[0], selectedVerses)) {
          onToggleVerse(mainGroup.verses[0]);
        }
        requestAnimationFrame(() => {
          if (scrollRef.current && savedScroll.current > 0) {
            scrollRef.current.scrollTop = savedScroll.current;
            savedScroll.current = 0;
          }
        });
      } catch {
        setSearchError("검색 중 오류가 발생했습니다");
      } finally {
        setSearchLoading(false);
      }
    } else {
      // === Word search: 언어 감지로 한글 3개 또는 영어 3개만 쿼리 ===
      if (trimmed.length < 2) {
        setSearchError("2글자 이상 입력해주세요");
        return;
      }
      setSearchError("");
      setSearchLoading(true);

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

        setLastSearchType(isOr ? "word-or" : "word-and");
        const PER_VERSION_LIMIT = 50;

        // 검색어에 한글 포함 여부로 언어 그룹 결정
        const isKorean = hasKorean(trimmed);
        let searchVersions = isKorean ? KOREAN_VERSIONS : ENGLISH_VERSIONS;
        // 통독(easy)은 로그인 시에만
        if (sessionLoading || !isLoggedIn) {
          searchVersions = searchVersions.filter((v) => v !== "easy");
        }

        const versionPromises = searchVersions.map(async (v) => {
          if (isOr) {
            const subPromises = words.map((w) =>
              supabase
                .from("bible_verses")
                .select("*")
                .eq("version", v)
                .ilike("text", `%${w}%`)
                .order("book_order")
                .order("chapter")
                .order("verse")
                .limit(30)
            );
            const subResults = await Promise.all(subPromises);
            const merged = new Map<number, BibleVerse>();
            for (const res of subResults) {
              if (res.data) for (const verse of res.data as BibleVerse[]) merged.set(verse.id, verse);
            }
            const sortedVerses = [...merged.values()].sort((a, b) => {
              if (a.book_order !== b.book_order) return a.book_order - b.book_order;
              if (a.chapter !== b.chapter) return a.chapter - b.chapter;
              return a.verse - b.verse;
            });
            return { version: v, verses: sortedVerses.slice(0, PER_VERSION_LIMIT) };
          } else {
            let q = supabase.from("bible_verses").select("*").eq("version", v);
            for (const w of words) q = q.ilike("text", `%${w}%`);
            const { data } = await q
              .order("book_order")
              .order("chapter")
              .order("verse")
              .range(0, PER_VERSION_LIMIT - 1);
            return { version: v, verses: (data ?? []) as BibleVerse[] };
          }
        });

        const groups = await Promise.all(versionPromises);
        const sorted = [
          ...groups.filter((g) => g.verses.length > 0),
          ...groups.filter((g) => g.verses.length === 0),
        ];
        setSearchByVersion(sorted);
        const totalCount = sorted.reduce((acc, g) => acc + g.verses.length, 0);
        if (totalCount === 0) setSearchError("검색 결과가 없습니다");

        requestAnimationFrame(() => {
          if (scrollRef.current && savedScroll.current > 0) {
            scrollRef.current.scrollTop = savedScroll.current;
            savedScroll.current = 0;
          }
        });
      } catch {
        setSearchError("검색 중 오류가 발생했습니다");
      } finally {
        setSearchLoading(false);
      }
    }
  }, [searchInput, mainVersion, isLoggedIn, sessionLoading, selectedVerses, onToggleVerse]);

  // ─── 장절 선택 (Chapter browse) ───
  useEffect(() => {
    let cancelled = false;
    async function loadChapters() {
      // RPC로 DISTINCT chapter 조회 (Supabase 1000행 제한 우회)
      const { data, error } = await supabase.rpc("get_chapters", {
        p_version: mainVersion,
        p_book_code: bookCode,
      });
      if (cancelled) return; // 이전 요청 결과 무시 (race 방지)

      if (error || !data) return;

      const unique = (data as { chapter: number }[]).map((d) => d.chapter);
      setChapters(unique);
      if (unique.length > 0 && !unique.includes(chapter)) {
        setChapter(unique[0]);
      }
    }
    loadChapters();
    return () => { cancelled = true; };
  }, [bookCode, mainVersion]);

  useEffect(() => {
    let cancelled = false;
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
      if (cancelled) return; // 이전 요청 결과 무시 (race 방지)

      if (!error && data) {
        setBrowseVerses(data as BibleVerse[]);
      }
      setLoadingBrowse(false);
    }
    loadVerses();
    return () => { cancelled = true; };
  }, [bookCode, chapter, mainVersion]);

  // 병기 모드: 부 버전 로드
  useEffect(() => {
    if (!parallel || !chapter) { setBrowseVersesAlt([]); return; }
    let cancelled = false;
    const altVersion = subVersion;
    supabase
      .from("bible_verses")
      .select("*")
      .eq("version", altVersion)
      .eq("book_code", bookCode)
      .eq("chapter", chapter)
      .order("verse")
      .then(({ data }) => {
        if (cancelled) return; // 이전 요청 결과 무시 (race 방지)
        if (data) setBrowseVersesAlt(data as BibleVerse[]);
      });
    return () => { cancelled = true; };
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

  // ─── 버전 전환 시 주제 추천 결과 재조회 (말씀검색은 모든 버전 캐싱되어 재조회 불필요) ───
  const prevVersion = useRef(mainVersion);
  useEffect(() => {
    if (prevVersion.current !== mainVersion) {
      prevVersion.current = mainVersion;
      if (topicRecommendations.length > 0) {
        let cancelled = false;
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
          if (cancelled) return;
          const found: BibleVerse[] = [];
          for (const res of results) {
            if (res.data) found.push(res.data as BibleVerse);
          }
          setTopicResults(found);
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
          });
        })();
        return () => { cancelled = true; };
      }
    }
  }, [mainVersion]);

  // ─── 병기: 주제 추천 부 버전만 (말씀검색은 모든 버전 동시 표시되어 alt 불필요) ───
  useEffect(() => {
    if (!parallel) {
      setTopicResultsAlt([]);
      return;
    }
    let cancelled = false;
    const altVersion = subVersion;
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
        if (cancelled) return;
        setTopicResultsAlt(
          results.filter((r) => r.data).map((r) => r.data as BibleVerse)
        );
      })();
    }
    return () => { cancelled = true; };
  }, [parallel, topicResults, mainVersion, subVersion]);

  // ─── 주제 추천 ───
  // topic 인자를 받으면 그 값으로, 없으면 topicInput state로 검색 (state 갱신 race 회피)
  const searchTopic = useCallback(async (topic?: string) => {
    const trimmed = (topic ?? topicInput).trim();
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

  // ─── 편집 폼 JSX (함수 컴포넌트가 아닌 단순 렌더 함수 — 매 렌더 remount 방지) ───
  function renderEditForm(verse: BibleVerse) {
    return (
      <div
        key={`edit-${verse.id}`}
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

  // ─── Shared: verse item 렌더 함수 (컴포넌트가 아닌 JSX 반환 — 매 렌더 remount 방지) ───
  function renderVerseItem(
    verse: BibleVerse,
    opts?: { showBookInfo?: boolean; altText?: string }
  ) {
    if (editingVerseId === verse.id) {
      return renderEditForm(verse);
    }
    const { showBookInfo, altText } = opts ?? {};
    const selected = isSelected(verse, selectedVerses);
    return (
      <button
        key={verse.id}
        onClick={() => handleToggle(verse)}
        data-book={verse.book_code}
        data-chapter={verse.chapter}
        data-verse={verse.verse}
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
    if (mode === "search") return []; // 말씀검색은 모든 버전 동시 표시 → alt 불필요
    if (mode === "chapter" && browseStep === "verse") return browseVersesAlt;
    if (mode === "topic") return topicResultsAlt;
    return [];
  }, [mode, browseStep, browseVersesAlt, topicResultsAlt]);

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
        bookCode: v.book_code,
        bookName: v.book_name,
        chapter: v.chapter,
        verse: v.verse,
        version: v.version,
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
    <div className="w-full max-w-[1400px] mx-auto">
      {/* PC 전용: 좌/우 공백 클릭으로 이전/다음 장 (목차 브라우즈 verse step에서만) */}
      {mode === "chapter" && browseStep === "verse" && (
        <>
          {canPrevChapter && (
            <button
              type="button"
              onClick={() => setChapter(chapters[chapterIdx - 1])}
              className="hidden lg:flex fixed left-0 top-24 bottom-24 z-20 items-center justify-start pl-2 group cursor-pointer bg-transparent"
              style={{ width: "max(40px, calc((100vw - 1400px) / 2))" }}
              title="이전 장"
              aria-label="이전 장"
            >
              <svg className="w-8 h-8 text-gray-400 opacity-0 group-hover:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
          {canNextChapter && (
            <button
              type="button"
              onClick={() => setChapter(chapters[chapterIdx + 1])}
              className="hidden lg:flex fixed right-0 top-24 bottom-24 z-20 items-center justify-end pr-2 group cursor-pointer bg-transparent"
              style={{ width: "max(40px, calc((100vw - 1400px) / 2))" }}
              title="다음 장"
              aria-label="다음 장"
            >
              <svg className="w-8 h-8 text-gray-400 opacity-0 group-hover:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}
        </>
      )}

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
                style={{ fontSize: "9px", fontWeight: 500, letterSpacing: "1.2px", lineHeight: 1, textAlign: "left" }}
              >
                Yebom
              </div>
              <div
                className="italic text-gray-700 dark:text-gray-200 font-[family-name:var(--font-playfair)]"
                style={{ fontSize: "16px", fontWeight: 400, letterSpacing: "0.4px", lineHeight: 1, marginTop: "3px" }}
              >
                BIBLE
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <select
              value={mainVersion}
              onChange={(e) => setMainVersion(e.target.value as BibleVersion)}
              className="text-[11px] font-semibold bg-gray-900 text-white border-none outline-none cursor-pointer text-center"
              style={{
                height: "30px",
                width: "78px",
                paddingLeft: "10px",
                paddingRight: "18px",
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
              className="flex items-center justify-center text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ width: "26px", height: "30px", borderRadius: "4px", fontSize: "13px", fontWeight: 600 }}
            >
              ⇄
            </button>
            <select
              value={subVersion}
              onChange={(e) => setSubVersion(e.target.value as BibleVersion | "none")}
              className="text-[11px] font-semibold bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 outline-none cursor-pointer text-center"
              style={{
                height: "30px",
                width: "78px",
                paddingLeft: "10px",
                paddingRight: "18px",
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
              title="화면 설정 (글꼴·테마)"
              aria-label="화면 설정"
              className="flex items-center justify-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ml-1"
              style={{ width: "44px", height: "30px", borderRadius: "4px" }}
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.542-.56.94-1.11.94h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
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

      {/* 4버튼 액션 (성경목차 / 본문검색 / 주제추천 / 책갈피) */}
      {!isAddingMore && (
        <>
          <div className="grid grid-cols-4 gap-1 mb-2 relative">
            <button
              onClick={() => { setMode("chapter"); setBrowseStep("book"); setShowBookmarkMenu(false); setShowSearchRow(false); }}
              className="h-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors px-1"
              style={{ borderRadius: "4px" }}
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              성경목차
            </button>
            <button
              onClick={() => {
                // 같은 모드로 열려있으면 닫기, 아니면 ref 모드로 열기/전환
                if (showSearchRow && searchMode === "ref") {
                  setShowSearchRow(false);
                } else {
                  setSearchMode("ref");
                  setShowSearchRow(true);
                  setSearchHelperShown(true);
                  setShowBookmarkMenu(false);
                }
              }}
              className={`h-10 border flex items-center justify-center gap-1 transition-colors text-[11px] font-semibold px-1 ${
                showSearchRow && searchMode === "ref"
                  ? "bg-gray-900 dark:bg-gray-700 border-gray-900 dark:border-gray-700 text-white"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
              style={{ borderRadius: "4px" }}
            >
              <svg className={`w-3.5 h-3.5 shrink-0 ${showSearchRow && searchMode === "ref" ? "text-white" : "text-gray-500 dark:text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607Z" />
              </svg>
              본문검색
            </button>
            <button
              onClick={() => {
                if (showSearchRow && searchMode === "topic") {
                  setShowSearchRow(false);
                } else {
                  setSearchMode("topic");
                  setShowSearchRow(true);
                  setSearchHelperShown(true);
                  setShowBookmarkMenu(false);
                }
              }}
              className={`h-10 border flex items-center justify-center gap-1 transition-colors text-[11px] font-semibold px-1 ${
                showSearchRow && searchMode === "topic"
                  ? "bg-gray-900 dark:bg-gray-700 border-gray-900 dark:border-gray-700 text-white"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
              style={{ borderRadius: "4px" }}
            >
              <svg className={`w-3.5 h-3.5 shrink-0 ${showSearchRow && searchMode === "topic" ? "text-white" : "text-gray-500 dark:text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
              주제추천
            </button>
            <button
              onClick={() => { setShowBookmarkMenu(!showBookmarkMenu); setShowSearchRow(false); }}
              className={`h-10 border ${totalBookmarkCount > 0 ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950" : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"} hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors px-1`}
              style={{ borderRadius: "4px" }}
            >
              <svg className={`w-3.5 h-3.5 shrink-0 ${totalBookmarkCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              책갈피
              {totalBookmarkCount > 0 && (
                <span className="text-[9px] bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-1 rounded-sm font-medium">{totalBookmarkCount}</span>
              )}
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
                    lang="ko"
                    inputMode="text"
                    autoComplete="off"
                    value={searchInput}
                    onChange={(e) => { setSearchInput(e.target.value); setShowHistory(false); }}
                    onFocus={() => { if (searchHistory.length > 0 && !searchInput) setShowHistory(true); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const t = searchInput;
                        setSearchHelperShown(false);
                        if (searchMode === "topic") {
                          setMode("topic");
                          setTopicInput(t);
                          addToHistory(t);
                          searchTopic(t);
                        } else {
                          setMode("search");
                          executeSearch();
                        }
                      }
                      if (e.key === "Escape") setShowHistory(false);
                    }}
                    onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                    placeholder={searchMode === "topic" ? "감사, 위로, 새해…" : "창1:1, 두려워 말라…"}
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
                  onClick={() => {
                    const t = searchInput;
                    setSearchHelperShown(false);
                    if (searchMode === "topic") {
                      setMode("topic");
                      setTopicInput(t);
                      addToHistory(t);
                      searchTopic(t);
                    } else {
                      setMode("search");
                      executeSearch();
                    }
                  }}
                  disabled={searchMode === "ref" ? searchLoading : topicLoading}
                  className="shrink-0 h-9 px-4 bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  style={{ borderRadius: "4px" }}
                >
                  {(searchMode === "ref" ? (searchLoading && mode === "search") : (topicLoading && mode === "topic")) ? "..." : "검색"}
                </button>
              </div>
              {searchHelperShown && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                  {searchMode === "topic" ? (
                    <><span className="font-semibold text-gray-500 dark:text-gray-400">주제</span> 한 두 단어 입력 (예: 감사·위로·새해)</>
                  ) : (
                    <><span className="font-semibold text-gray-500 dark:text-gray-400">본문</span> 구절 또는 단어 (예: 창1:1·두려워 말라)</>
                  )}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Tab 1: 말씀 검색 결과 (모든 버전 동시 표시) ─── */}
      {mode === "search" && (
        <div>
          {searchError && (
            <p className="text-sm text-red-500 mb-3 text-center">{searchError}</p>
          )}

          {/* 빈 홈 화면 — 검색 전이고 결과 없을 때만 표시 (다시 펴기 · 책갈피 · 환영) */}
          {!searchError &&
            !searchLoading &&
            !isAddingMore &&
            lastSearchType === null &&
            !searchByVersion.some((g) => g.verses.length > 0) && (
              <HomeBlankContent
                recent={recent}
                bookmarks={bookmarks}
                mainVersion={mainVersion}
                onJump={(pos) => jumpTo(pos)}
                onOpenAllBookmarks={() => {
                  setShowBookmarkMenu(true);
                  setShowSearchRow(false);
                }}
              />
            )}

          {searchByVersion.some((g) => g.verses.length > 0) && (
            <>
              {fontSlider}
              <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[72vh] lg:max-h-[86vh] overflow-y-auto">
                {searchByVersion.map((group) => {
                  const has = group.verses.length > 0;
                  return (
                    <div key={group.version}>
                      {/* 버전 섹션 헤더 (sticky) */}
                      <div
                        className={`sticky top-0 z-10 px-4 py-1.5 text-[11px] font-bold border-b ${
                          has
                            ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600"
                            : "bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500 border-gray-100 dark:border-gray-700"
                        }`}
                      >
                        <span>{getVersionLabel(group.version)}</span>
                        <span className="ml-2 font-normal text-[10px]">
                          {has ? `${group.verses.length}건` : "없음"}
                        </span>
                        {group.version === mainVersion && (
                          <span className="ml-2 text-[9px] font-medium text-gray-500 dark:text-gray-400">· 주성경</span>
                        )}
                      </div>
                      {/* 구절 목록 */}
                      {group.verses.map((v) => renderVerseItem(v, { showBookInfo: true }))}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                총 {searchByVersion.reduce((acc, g) => acc + g.verses.length, 0)}건 ·
                {" "}
                {searchByVersion.filter((g) => g.verses.length > 0).length}/{searchByVersion.length}개 버전
                {(lastSearchType === "word-and" || lastSearchType === "word-or") && " · 버전당 최대 50건"}
              </p>
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
                <button
                  type="button"
                  onClick={() => setBrowseStep("book")}
                  className="text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title="성경 선택으로"
                >
                  {getBookByCode(bookCode)?.nameKr || "책 선택"}
                </button>
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
                  <button
                    type="button"
                    onClick={() => setBrowseStep("chapter")}
                    className="text-sm text-gray-600 dark:text-gray-400 mx-1 hover:text-gray-800 dark:hover:text-gray-200 transition-colors cursor-pointer"
                    title="장 선택으로"
                  >
                    {getBookByCode(bookCode)?.nameKr}{" "}
                    <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{chapter}</span>
                    <span className="text-gray-400">/{chapters.length}장</span>
                  </button>
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

                {/* 우: 읽기 + 전체화면 버튼 */}
                <div className="flex items-center shrink-0 gap-1.5">
                  <TTSButton
                    isPlaying={ttsActiveOnThisChapter}
                    isLoading={ttsActiveOnThisChapter && tts.status === "loading"}
                    disabled={browseVerses.length === 0}
                    onClick={handleTtsToggle}
                  />
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
                <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[72vh] lg:max-h-[86vh] overflow-y-auto">
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
                          return <div key={v.id}>{renderEditForm(v)}</div>;
                        }
                        if (alt && editingVerseId === alt.id) {
                          return <div key={alt.id}>{renderEditForm(alt)}</div>;
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
                <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[72vh] lg:max-h-[86vh] overflow-y-auto">
                  {loadingBrowse ? (
                    <div className="p-4 text-center text-gray-400">불러오는 중...</div>
                  ) : browseVerses.length === 0 ? (
                    <div className="p-4 text-center text-gray-400">구절이 없습니다</div>
                  ) : (
                    browseVerses.map((v) => renderVerseItem(v))
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
              <div ref={scrollRef} className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-[72vh] lg:max-h-[86vh] overflow-y-auto">
                {topicResults.map((v) => {
                  const alt = parallel ? topicResultsAlt.find(
                    (a) => a.book_code === v.book_code && a.chapter === v.chapter && a.verse === v.verse
                  ) : undefined;
                  return renderVerseItem(v, { showBookInfo: true, altText: alt?.text });
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

      {/* 퀵 네비게이션 FAB */}
      {!isAddingMore && (
        <QuickNavFab
          currentBookCode={bookCode}
          currentChapter={chapter}
          mainVersion={mainVersion}
          onJump={(bc, ch, v) => {
            // 헤더 버전(주/부)은 그대로 두고 위치만 이동 + 해당 절로 자동 스크롤
            setBookCode(bc);
            setChapter(ch);
            setRememberedVerse(v);
            setMode("chapter");
            setBrowseStep("verse");
            setShowBookmarkMenu(false);
            setShowSearchRow(false);
          }}
        />
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
