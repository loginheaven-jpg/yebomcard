"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { OLD_TESTAMENT, NEW_TESTAMENT, getBookByCode, getBookByName } from "@/lib/books";
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
import {
  fetchReadChapters,
  markChapterRead,
  computeProgress,
  type ReadChapter,
} from "@/lib/reading-progress";
import {
  HIGHLIGHT_COLORS,
  colorTint,
  fetchChapterNotes,
  saveVerseNote,
  reportNote,
  type VerseNote,
  type SharedNote,
} from "@/lib/verse-notes";
import { syncOnLogin, pushBookmarks, pushRecent } from "@/lib/userSync";
import FullscreenReader, { type FullscreenVerseItem } from "./FullscreenReader";
import QuickNavFab from "./QuickNavFab";
import HomeBlankContent from "./HomeBlankContent";
import TTSButton from "./TTSButton";
import { useTts, type TtsTrack } from "@/contexts/TtsContext";
import { useHardwareBack, getActiveModalCount } from "@/hooks/useHardwareBack";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";
import { useFont, FONTS } from "@/contexts/FontContext";
import { linkify } from "@/lib/linkify";

export interface NavRequest {
  /** 하단 탭이 요청한 화면 — Phase 2a */
  target: "toc" | "search" | "read" | "bookmark";
  /** 같은 target 재요청 시에도 effect 가 다시 돌도록 nonce */
  nonce: number;
}

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
  /** 하단 5탭에서 들어오는 네비게이션 요청 (Phase 2a) */
  navRequest?: NavRequest;
  /** SettingsSheet 에서 전체화면 진입 요청 (Phase 2b) — nonce 갱신 시 전체화면 열림 */
  fullscreenRequestNonce?: number;
  /** 책갈피 메뉴 안 스크랩 버튼 클릭 시 — app/page.tsx 에서 ScrapList 열기 (Phase 2b 후속) */
  onOpenScrap?: () => void;
  /** 스크랩 카운트 — 책갈피 메뉴 안 스크랩 버튼 배지 표시 (Phase 2b 후속) */
  scrapCount?: number;
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
  navRequest,
  fullscreenRequestNonce,
  onOpenScrap,
  scrapCount,
}: SearchPanelProps) {
  const { session, isLoggedIn, loading: sessionLoading } = useSession();
  const adminMode = isAdmin(session);
  // 통독은 로그인 확정 시에만 표시 (loading 중에도 제외해 hydration mismatch 방지)
  const versionOptions: readonly BibleVersion[] = (
    !sessionLoading && isLoggedIn
      ? (["nkrv", "rnksv", "easy", "web", "kjv", "nirv", "gnt"] as const)
      : (["nkrv", "rnksv", "web", "kjv", "nirv", "gnt"] as const)
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

  const { fontSize, setFontSize, fontKey } = useFont();
  const currentFont = FONTS.find((f) => f.key === fontKey) || FONTS[0];
  // 읽기 중 빠른 글자 크기 조절 — 대역 선택 우측 'A' 버튼 → 인라인 스테퍼 팝오버
  const [fontStepOpen, setFontStepOpen] = useState(false);

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
  const [searchFallbackNote, setSearchFallbackNote] = useState("");
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
  const bookmarkMenuContainerRef = useRef<HTMLDivElement>(null);

  // ─── 통독 진도 (로그인 전용, reading_progress) ───
  const [readChapters, setReadChapters] = useState<ReadChapter[]>([]);
  const progress = useMemo(() => computeProgress(readChapters), [readChapters]);
  useEffect(() => {
    if (sessionLoading || !isLoggedIn) { setReadChapters([]); return; }
    fetchReadChapters().then(setReadChapters);
  }, [sessionLoading, isLoggedIn]);

  // ─── 기기간 동기화 (로그인 시 1회: 책갈피 union + 마지막 위치 merge) ───
  const syncedRef = useRef(false);
  useEffect(() => {
    if (sessionLoading || !isLoggedIn || syncedRef.current) return;
    syncedRef.current = true;
    syncOnLogin().then(({ bookmarks, recent }) => {
      setBookmarks(bookmarks);
      if (recent) setRecent(recent);
    });
  }, [sessionLoading, isLoggedIn]);

  // ─── 묵상 노트·하이라이트 (로그인 전용, verse_notes) ───
  const [chapterNotes, setChapterNotes] = useState<VerseNote[]>([]);
  const [sharedNotes, setSharedNotes] = useState<SharedNote[]>([]); // 타인의 공개 메모(목장/전체)
  const [expandedShared, setExpandedShared] = useState<Set<number>>(new Set()); // 펼친 공유 메모 id
  const [expandedMine, setExpandedMine] = useState<Set<number>>(new Set()); // 펼친 내 메모 (verse 번호)
  const [noteVisibility, setNoteVisibility] = useState<string>("목장"); // 저장 공개 범위 (기본 목장)
  const [noteEditorVerse, setNoteEditorVerse] = useState<BibleVerse | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [reportToast, setReportToast] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());
  useHardwareBack(!!noteEditorVerse, () => setNoteEditorVerse(null));

  // 현재 browse 장의 노트만 로드 (전체 페치 금지 — 쿼리 부하 최소화)
  useEffect(() => {
    if (sessionLoading || !isLoggedIn || mode !== "chapter" || browseStep !== "verse" || !bookCode || !chapter) {
      setChapterNotes([]);
      setSharedNotes([]);
      return;
    }
    fetchChapterNotes(bookCode, chapter).then(({ notes, shared }) => {
      setChapterNotes(notes);
      setSharedNotes(shared);
    });
  }, [sessionLoading, isLoggedIn, mode, browseStep, bookCode, chapter]);

  const noteFor = useCallback(
    (v: BibleVerse) =>
      chapterNotes.find(
        (n) => n.book_code === v.book_code && n.chapter === v.chapter && n.verse === v.verse
      ),
    [chapterNotes]
  );
  const refreshChapterNotes = useCallback(() => {
    if (bookCode && chapter)
      return fetchChapterNotes(bookCode, chapter).then(({ notes, shared }) => {
        setChapterNotes(notes);
        setSharedNotes(shared);
      });
    return Promise.resolve();
  }, [bookCode, chapter]);

  // 타인 공유 메모 — 절별 조회 + 날짜 포맷 + 펼침 토글 + 신고
  const sharedFor = useCallback(
    (v: BibleVerse) => sharedNotes.filter((s) => s.verse === v.verse),
    [sharedNotes],
  );
  const fmtNoteDate = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  };
  const toggleSharedExpand = (id: number) =>
    setExpandedShared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMineExpand = (verseNo: number) =>
    setExpandedMine((prev) => {
      const next = new Set(prev);
      if (next.has(verseNo)) next.delete(verseNo);
      else next.add(verseNo);
      return next;
    });
  async function handleReportNote(id: number) {
    setReportedIds((prev) => new Set(prev).add(id));
    const r = await reportNote(id);
    if (r.ok && r.hidden) setSharedNotes((prev) => prev.filter((s) => s.id !== id));
    setReportToast(!r.ok ? "신고 처리에 실패했습니다" : r.hidden ? "신고 누적 — 임시 숨김 처리됐습니다" : "신고가 접수되었습니다");
    window.setTimeout(() => setReportToast(null), 2500);
  }

  // 로컬 chapterNotes 낙관적 upsert — 색/메모를 네트워크 대기 없이 즉시 반영
  function upsertLocalNote(v: BibleVerse, patch: { color?: string | null; note?: string | null; visibility?: string }) {
    setChapterNotes((prev) => {
      const next = [...prev];
      const i = next.findIndex(
        (n) => n.book_code === v.book_code && n.chapter === v.chapter && n.verse === v.verse
      );
      const cur = i >= 0 ? next[i] : null;
      const color = patch.color !== undefined ? patch.color : cur?.color ?? null;
      const note = patch.note !== undefined ? patch.note : cur?.note ?? null;
      const visibility = patch.visibility !== undefined ? patch.visibility : cur?.visibility ?? null;
      if (!color && !note) {
        if (i >= 0) next.splice(i, 1); // 색·메모 모두 없으면 제거
      } else if (i >= 0) {
        next[i] = { ...next[i], color, note, visibility };
      } else {
        next.push({
          id: -Date.now() - v.verse, // 임시 id (렌더에 미사용)
          book_code: v.book_code,
          chapter: v.chapter,
          verse: v.verse,
          color,
          note,
          visibility,
          version: mainVersion,
          updated_at: new Date().toISOString(),
        });
      }
      return next;
    });
  }

  // 선택된 절들에 하이라이트 색 적용/해제 — 낙관적 즉시 반영 + 서버 저장은 백그라운드
  function applyHighlight(color: string | null) {
    const targets = [...selectedVerses];
    if (targets.length === 0) return;
    // 1) 색 즉시 반영(네트워크 대기 X) + 선택 해제(회색 배경이 색 가리지 않도록)
    targets.forEach((v) => upsertLocalNote(v, { color }));
    targets.forEach((v) => onToggleVerse(v));
    // 2) 서버 저장은 백그라운드 — 실패한 게 있을 때만 서버 상태로 보정
    const saves = targets.map((v) => {
      const existing = noteFor(v); // 기존 메모 보존 (변경 전 값)
      return saveVerseNote({
        book_code: v.book_code,
        chapter: v.chapter,
        verse: v.verse,
        color,
        note: existing?.note ?? null,
        version: mainVersion,
      });
    });
    Promise.all(saves)
      .then((results) => { if (results.some((ok) => !ok)) refreshChapterNotes(); })
      .catch(() => refreshChapterNotes());
  }
  function openNoteEditor(v: BibleVerse) {
    const ex = noteFor(v);
    setNoteDraft(ex?.note ?? "");
    setNoteVisibility(ex?.visibility || "목장"); // 기존 메모는 그 범위 유지, 신규는 기본 목장
    setNoteEditorVerse(v);
  }
  function saveNote() {
    if (!noteEditorVerse) return;
    const v = noteEditorVerse;
    const existing = noteFor(v); // 기존 색 보존
    const note = noteDraft.trim() || null;
    // 즉시 반영(visibility 포함) + 모달 닫기 → 재오픈 시 방금 고른 공개범위가 그대로 보임
    upsertLocalNote(v, { note, visibility: noteVisibility });
    setNoteEditorVerse(null);
    // 서버 저장 백그라운드
    saveVerseNote({
      book_code: v.book_code,
      chapter: v.chapter,
      verse: v.verse,
      color: existing?.color ?? null,
      note,
      version: mainVersion,
      visibility: noteVisibility,
    }).then((ok) => { if (!ok) refreshChapterNotes(); });
  }

  // 책갈피 메뉴 외부 클릭 시 자동 닫기 (Fix #2)
  // 하단 5탭 책갈피 버튼 (data-bookmark-tab) 은 토글이므로 제외
  useEffect(() => {
    if (!showBookmarkMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (bookmarkMenuContainerRef.current?.contains(target)) return;
      if (target.closest?.('[data-bookmark-tab="true"]')) return;
      setShowBookmarkMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showBookmarkMenu]);

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
      // /share '본문가기' 딥링크: ?goto=version.book.chapter.verse → 해당 절 본문으로
      const goto = params.get("goto");
      if (goto) {
        const [ver, bc, ch, vs] = goto.split(".");
        if (bc && ch && vs) {
          bootstrappedRef.current = true;
          window.history.replaceState(window.history.state, "", "/"); // URL 정리
          setBookCode(bc);
          setChapter(parseInt(ch, 10));
          setRememberedVerse(parseInt(vs, 10));
          setMode("chapter");
          setBrowseStep("verse");
          if (ver) setMainVersion(ver as BibleVersion);
          return;
        }
      }
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

  // ─── Phase 2a 하단 5탭 네비게이션 요청 처리 ───
  // 외부(BottomTabBar)에서 nonce 와 함께 target 을 보내면 내부 상태 동기화
  useEffect(() => {
    if (!navRequest) return;
    const { target } = navRequest;
    if (target === "toc") {
      setMode("chapter");
      setBrowseStep("book");
      setShowBookmarkMenu(false);
      setShowSearchRow(false);
    } else if (target === "search") {
      setMode("search");
      setShowSearchRow(true);
      setShowBookmarkMenu(false);
    } else if (target === "read") {
      // 마지막 위치(recent) 복귀
      const r = readRecent();
      if (r && r.book_code && r.chapter) {
        setBookCode(r.book_code);
        setChapter(r.chapter);
        setMode("chapter");
        setBrowseStep("verse");
        if (r.version) setMainVersion(r.version);
        if (r.subVersion !== undefined) setSubVersion(r.subVersion);
      } else {
        // recent 없으면 목차로 폴백
        setMode("chapter");
        setBrowseStep("book");
      }
      setShowBookmarkMenu(false);
      setShowSearchRow(false);
    } else if (target === "bookmark") {
      // 책갈피 탭 재클릭 토글 (사용자 요청)
      setShowBookmarkMenu((prev) => !prev);
      setShowSearchRow(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest?.nonce]);

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
    () => { setSearchByVersion([]); setSearchError(""); setSearchFallbackNote(""); }
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
      const recentPos: BiblePosition = { ...next, savedAt: Date.now() };
      saveRecent(next);
      setRecent(recentPos);
      // 통독 진도 + 마지막 위치 동기화 (로그인 시) + 낙관적 진도 갱신 (서버 SELECT-then-UPSERT 가 중복 흡수)
      if (isLoggedIn) {
        markChapterRead(bookCode, chapter, mainVersion);
        pushRecent(recentPos);
        setReadChapters((prev) =>
          prev.some((r) => r.book_code === bookCode && r.chapter === chapter)
            ? prev
            : [...prev, { book_code: bookCode, chapter, read_at: new Date().toISOString() }]
        );
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [mode, browseStep, bookCode, chapter, mainVersion, subVersion, isLoggedIn]);

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
    if (isLoggedIn) pushBookmarks(updated);
  }
  function deleteBookmark(id: string) {
    const updated = removeBookmark(id);
    setBookmarks(updated);
    if (isLoggedIn) pushBookmarks(updated);
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
  // 재생 중 미니플레이어(하단 고정 오버레이)가 본문 끝줄을 가리지 않도록 스크롤 영역 하단 예약을 늘림
  const playerActive = tts.status !== "idle";
  const browseScrollMaxH = playerActive
    ? "max-h-[calc(100dvh-272px-env(safe-area-inset-bottom,0px))] lg:max-h-[calc(100dvh-222px)]"
    : "max-h-[calc(100dvh-200px-env(safe-area-inset-bottom,0px))] lg:max-h-[calc(100dvh-150px)]";
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
    const ALL = ["nkrv", "rnksv", "easy", "web", "kjv", "nirv", "gnt"];
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
  const PREFERRED_VERSION_ORDER: BibleVersion[] = ["nkrv", "rnksv", "easy", "web", "kjv", "nirv", "gnt"];
  const KOREAN_VERSIONS: BibleVersion[] = ["nkrv", "rnksv", "easy"];
  const ENGLISH_VERSIONS: BibleVersion[] = ["web", "kjv", "nirv", "gnt"];
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
        // 현재 역본 먼저 → 결과 있는 다른 역본 → 결과 없는 역본 (순차 폴백)
        const mainHas = (groups.find((g) => g.version === mainVersion)?.verses.length ?? 0) > 0;
        const sorted = [
          ...groups.filter((g) => g.version === mainVersion && g.verses.length > 0),
          ...groups.filter((g) => g.version !== mainVersion && g.verses.length > 0),
          ...groups.filter((g) => g.verses.length === 0),
        ];
        setSearchByVersion(sorted);
        const totalCount = sorted.reduce((acc, g) => acc + g.verses.length, 0);
        if (totalCount === 0) {
          setSearchError("해당 구절을 찾을 수 없습니다");
          setSearchFallbackNote("");
        } else {
          setSearchFallbackNote(mainHas ? "" : "현재 역본에는 없어 다른 역본에서 찾은 결과입니다");
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
        const mainHas = (groups.find((g) => g.version === mainVersion)?.verses.length ?? 0) > 0;
        const sorted = [
          ...groups.filter((g) => g.version === mainVersion && g.verses.length > 0),
          ...groups.filter((g) => g.version !== mainVersion && g.verses.length > 0),
          ...groups.filter((g) => g.verses.length === 0),
        ];
        setSearchByVersion(sorted);
        const totalCount = sorted.reduce((acc, g) => acc + g.verses.length, 0);
        if (totalCount === 0) {
          setSearchError("검색 결과가 없습니다");
          setSearchFallbackNote("");
        } else {
          setSearchFallbackNote(mainHas ? "" : "현재 역본에는 없어 다른 역본에서 찾은 결과입니다");
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

      // AI 가 반환한 책명(한글/영문)을 book_code 로 변환 → 모든 version 호환 조회
      const versePromises = recommendations.map((rec) => {
        const book = getBookByName(rec.book);
        if (!book) return Promise.resolve({ data: null, _unmapped: rec.book } as { data: BibleVerse | null; _unmapped?: string });
        return supabase
          .from("bible_verses")
          .select("*")
          .eq("version", mainVersion)
          .eq("book_code", book.code)
          .eq("chapter", rec.chapter)
          .eq("verse", rec.verse)
          .single()
          .then((res) => ({ data: res.data as BibleVerse | null }));
      });
      const verseResults = await Promise.all(versePromises);

      const found: BibleVerse[] = [];
      const unmapped: string[] = [];
      for (const res of verseResults) {
        if (res.data) found.push(res.data);
        else if ((res as { _unmapped?: string })._unmapped) unmapped.push((res as { _unmapped?: string })._unmapped!);
      }

      setTopicResults(found);
      if (found.length === 0) {
        if (unmapped.length > 0) {
          console.warn("[topic-recommend] 책명 매핑 실패:", unmapped);
          setTopicError("AI 가 추천한 책명을 인식하지 못했습니다");
        } else {
          setTopicError("추천 결과를 본문과 매칭하지 못했습니다");
        }
      }
    } catch {
      setTopicError("추천 중 오류가 발생했습니다");
    } finally {
      setTopicLoading(false);
    }
  }, [topicInput, mainVersion]);

  // ─── Verse toggle with scroll preservation ───
  function handleToggle(verse: BibleVerse) {
    // 길게 누르기로 전체화면 진입 직후의 합성 click 무시 (Q1=B)
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
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
    const note = noteFor(verse);
    const tint = note?.color ? colorTint(note.color) : "";
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
            : tint || "hover:bg-gray-50 dark:bg-gray-900"
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
          <div className="bible-sub-text leading-relaxed text-gray-400" style={{ fontSize: `${fontSize - 2}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
            {altText}
          </div>
        )}
        {note?.note && (() => {
          const open = expandedMine.has(verse.verse);
          return (
            <div
              className="mt-1.5 flex items-start gap-1 text-[13px] leading-snug text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40 rounded-md px-2 py-1 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleMineExpand(verse.verse); }}
            >
              <span className="shrink-0">📝</span>
              <div className="min-w-0 flex-1">
                <div className={open ? "whitespace-pre-wrap break-words" : "truncate"}>{linkify(note.note)}</div>
                {open && (
                  <div className="text-[10px] text-amber-500/70 mt-0.5">({fmtNoteDate(note.updated_at)})</div>
                )}
              </div>
              <span className="shrink-0 text-amber-400 select-none" aria-hidden>{open ? "▾" : "▸"}</span>
            </div>
          );
        })()}
        {sharedFor(verse).length > 0 && (
          <div className="mt-1 space-y-1" onClick={(e) => e.stopPropagation()}>
            {sharedFor(verse).map((s) => {
              const open = expandedShared.has(s.id);
              const reported = reportedIds.has(s.id);
              return (
                <div key={s.id} className="flex items-start gap-1 text-[13px] leading-snug text-blue-800 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/30 rounded-md px-2 py-1">
                  <span className="shrink-0">💬</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[10px] text-blue-500 dark:text-blue-400 mb-0.5">
                      <span className="font-semibold">{s.user_name || "익명"}</span>
                      {s.visibility === "목장" && (
                        <span className="px-1 rounded bg-blue-100 dark:bg-blue-900/50">목장</span>
                      )}
                      <span className="opacity-70">({fmtNoteDate(s.created_at)})</span>
                    </div>
                    <div className={open ? "whitespace-pre-wrap break-words" : "truncate"}>{linkify(s.note)}</div>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSharedExpand(s.id)}
                    className="shrink-0 cursor-pointer px-1 text-blue-400 select-none"
                    aria-label={open ? "접기" : "펼치기"}
                  >
                    {open ? "▾" : "▸"}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => !reported && handleReportNote(s.id)}
                    className={`shrink-0 cursor-pointer px-1 select-none ${reported ? "opacity-30" : "text-blue-400 hover:text-red-500"}`}
                    title="신고"
                    aria-label="신고"
                  >
                    🚩
                  </span>
                </div>
              );
            })}
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

  // Phase 2c + 3 — 좌우 스와이프(장 이동) + 길게 누르기(전체화면) 통합 터치 핸들러
  // 활성: 본문 영역 가운데 60% (가장자리 20% 제외 — iOS swipe-back 보호)
  // 임계 스와이프: |dx| > 50px, 각도 30° 이내
  // 임계 long-press: 500ms 정지, 이동 < 8px
  // 비활성: editing/isAddingMore/모달 열림
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);
  // visibleMain 은 아래 useMemo 로 정의 — 핸들러 클로저에서는 ref 로 접근
  const visibleMainCountRef = useRef(0);

  const goChapter = useCallback(
    (delta: -1 | 1) => {
      if (delta === -1 && canPrevChapter) {
        setChapter(chapters[chapterIdx - 1]);
      } else if (delta === 1 && canNextChapter) {
        setChapter(chapters[chapterIdx + 1]);
      }
    },
    [canPrevChapter, canNextChapter, chapters, chapterIdx],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleVerseSwipeStart = useCallback(
    (e: React.TouchEvent) => {
      longPressedRef.current = false;
      if (editingVerseId !== null) return;
      if (isAddingMore) return;
      const t = e.touches[0];
      if (!t) return;
      const w = window.innerWidth;
      if (t.clientX < w * 0.2 || t.clientX > w * 0.8) return;
      swipeStartRef.current = { x: t.clientX, y: t.clientY };
      // 길게 누르기 타이머 — 500ms 후 전체화면 진입 (Q1=B)
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressedRef.current = true;
        if (visibleMainCountRef.current > 0) {
          setShowFullscreen(true);
        }
      }, 500);
    },
    [editingVerseId, isAddingMore, cancelLongPress],
  );

  const handleVerseSwipeMove = useCallback(
    (e: React.TouchEvent) => {
      const s = swipeStartRef.current;
      if (!s) return;
      const t = e.touches[0];
      if (!t) return;
      // 8px 이상 이동하면 long-press 가 아님 — 타이머 취소
      if (Math.abs(t.clientX - s.x) > 8 || Math.abs(t.clientY - s.y) > 8) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  const handleVerseSwipeEnd = useCallback(
    (e: React.TouchEvent) => {
      cancelLongPress();
      const s = swipeStartRef.current;
      if (!s) return;
      swipeStartRef.current = null;
      // long-press 가 발화했으면 swipe 평가 스킵
      if (longPressedRef.current) {
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 50) return;
      if (Math.abs(dy) > Math.abs(dx) * 0.577) return;
      goChapter(dx > 0 ? -1 : 1);
    },
    [goChapter, cancelLongPress],
  );

  // 현재 탭의 표시 구절 (풀스크린 입력용)
  const visibleMain: BibleVerse[] = useMemo(() => {
    if (mode === "search") return searchResults;
    if (mode === "chapter" && browseStep === "verse") return browseVerses;
    if (mode === "topic") return topicResults;
    return [];
  }, [mode, browseStep, searchResults, browseVerses, topicResults]);
  // 핸들러 클로저(timeout)에서 최신 길이 참조용
  visibleMainCountRef.current = visibleMain.length;

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

  // 풀스크린 진입 — Phase 2b 에서 설정 시트로 이동 (사용자 #6)
  // fontSlider 는 빈 자리 유지 (다른 컨트롤 추가 가능성)
  const fontSlider = (
    <div className="flex items-center justify-end mb-2 gap-2"></div>
  );

  // SettingsSheet 의 "전체화면(1절씩 보기)" 요청 처리 — fullscreenRequestNonce 변경 시 전체화면 열림
  useEffect(() => {
    if (!fullscreenRequestNonce) return;
    if (visibleMain.length === 0) return;
    setShowFullscreen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreenRequestNonce]);

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
      {/* Header — 3열 grid: 좌(브랜드) · 중앙(번역본 셀렉터들) · 우(QuickNavFab 자리 비움) */}
      {!isAddingMore && (
        <div className="grid grid-cols-3 items-start mb-3 gap-2">
          <div className="flex flex-col items-center justify-self-start shrink-0 leading-none">
            <div className="text-gray-900 dark:text-gray-100">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <div
              className="italic text-gray-600 dark:text-gray-300 font-[family-name:var(--font-playfair)] mt-0.5"
              style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "0.4px", lineHeight: 1 }}
            >
              Yebom
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 justify-self-center">
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
              className="flex items-center justify-center text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
              style={{
                width: subVersion === "none" ? "26px" : "42px",
                height: subVersion === "none" ? "30px" : "34px",
                borderRadius: "8px",
                fontSize: subVersion === "none" ? "13px" : "17px",
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              ⇄
            </button>
            <select
              value={subVersion}
              onChange={(e) => setSubVersion(e.target.value as BibleVersion | "none")}
              className={`text-[11px] font-semibold bg-white dark:bg-gray-800 outline-none cursor-pointer text-center border ${
                subVersion === "none"
                  ? "border-dashed border-gray-400 dark:border-gray-500 text-gray-400 dark:text-gray-500"
                  : "border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
              }`}
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
              <option value="none">대역 선택…</option>
              {subVersionOptions.map((v) => (
                <option key={v} value={v}>{getVersionLabel(v)}</option>
              ))}
            </select>
            {/* 화면 설정 아이콘 — Phase 2b 에서 하단 5탭 "설정" 으로 흡수 (사용자 #5) */}
          </div>
          {/* 우측 컬럼: 글자 크기 '가' — 버전 셀렉터는 col-2 정중앙, '가'는 우측으로 분리해 좌우 균형 */}
          <div className="relative shrink-0 justify-self-end">
            <button
              type="button"
              onClick={() => setFontStepOpen((v) => !v)}
              aria-label="글자 크기 조절"
              aria-expanded={fontStepOpen}
              title="글자 크기"
              className="flex items-center justify-center text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-90 transition-all"
              style={{ width: "30px", height: "30px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, lineHeight: 1 }}
            >
              가
            </button>
            {fontStepOpen && (
              <>
                <div className="fixed inset-0 z-[59]" onClick={() => setFontStepOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full mt-1.5 z-[60] flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1">
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.max(16, fontSize - 2))}
                    aria-label="글자 작게"
                    className="w-8 h-8 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-all text-sm font-bold flex items-center justify-center"
                  >
                    A−
                  </button>
                  <span className="min-w-[34px] text-center text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-100">{fontSize}</span>
                  <button
                    type="button"
                    onClick={() => setFontSize(Math.min(60, fontSize + 2))}
                    aria-label="글자 크게"
                    className="w-8 h-8 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 transition-all text-sm font-bold flex items-center justify-center"
                  >
                    A+
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Adding more indicator */}
      {isAddingMore && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm text-gray-800 dark:text-gray-200 text-center">
          현재 {selectedVerses.length}절 선택됨 — 추가할 구절을 선택하세요
        </div>
      )}

      {/* 상단 4탭 (성경목차/본문검색/주제추천/책갈피) — Phase 2b 후속 하단 5탭으로 통합되어 제거 */}
      {!isAddingMore && (
        <>
          {/* 책갈피 펼침 메뉴 — 하단 책갈피 탭이 트리거. 외부 클릭 시 자동 닫기 */}
          <div className="relative mb-2">
            {showBookmarkMenu && (
              <div
                ref={bookmarkMenuContainerRef}
                className="absolute z-30 left-0 right-0 top-0 bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 rounded-xl shadow-lg dark:shadow-none overflow-hidden"
              >
                {/* 통독 진도 (로그인 전용) */}
                {isLoggedIn && (
                  <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">📖 통독 진도</span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">
                        {progress.readCount}/{progress.total}장
                      </span>
                    </div>
                    {[
                      { label: "전체", p: progress.percent },
                      { label: "구약", p: progress.ot.percent },
                      { label: "신약", p: progress.nt.percent },
                    ].map(({ label, p }) => (
                      <div key={label} className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 w-6 shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                          <div className="h-full bg-[var(--amber)] rounded-full transition-all" style={{ width: `${p}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-400 w-9 shrink-0 text-right">{p}%</span>
                      </div>
                    ))}
                  </div>
                )}
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
                {/* 스크랩 진입 — 사용자 #3 (좌하단 스크랩 FAB 흡수) */}
                {onOpenScrap && (
                  <button
                    onClick={() => { setShowBookmarkMenu(false); onOpenScrap(); }}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--amber-deep)] dark:text-amber-400 hover:bg-[var(--amber-tint)] dark:hover:bg-amber-950/30 border-t border-[var(--line)] dark:border-gray-700 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm">📌</span>
                      <span>스크랩</span>
                      {typeof scrapCount === "number" && scrapCount > 0 && (
                        <span className="text-[10px] bg-[var(--amber)] text-white px-1.5 py-0.5 rounded-full">
                          {scrapCount > 99 ? "99+" : scrapCount}
                        </span>
                      )}
                    </span>
                    <span className="text-[var(--ink-faint)]">→</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 검색 펼침 행 (showSearchRow 시) */}
          {showSearchRow && (
            <div className="mb-2">
              {/* 본문/주제 세그먼트 (사용자 #4) */}
              <div
                role="tablist"
                aria-label="검색 모드"
                className="flex bg-[var(--paper-2)] dark:bg-gray-700 rounded-md p-0.5 mb-1.5"
              >
                <button
                  role="tab"
                  aria-selected={searchMode === "ref"}
                  onClick={() => { setSearchMode("ref"); setSearchHelperShown(true); }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    searchMode === "ref"
                      ? "bg-[var(--paper)] dark:bg-gray-800 text-[var(--ink)] dark:text-gray-100 shadow-sm"
                      : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                  }`}
                >
                  본문
                </button>
                <button
                  role="tab"
                  aria-selected={searchMode === "topic"}
                  onClick={() => { setSearchMode("topic"); setSearchHelperShown(true); }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    searchMode === "topic"
                      ? "bg-[var(--paper)] dark:bg-gray-800 text-[var(--ink)] dark:text-gray-100 shadow-sm"
                      : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                  }`}
                >
                  주제
                </button>
              </div>
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
                  {(searchMode === "ref" ? (searchLoading && mode === "search") : (topicLoading && mode === "topic"))
                    ? "..."
                    : searchMode === "topic" ? "추천" : "검색"}
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
          {!searchError && searchFallbackNote && (
            <p className="text-xs text-[var(--amber-deep)] dark:text-amber-400 mb-3 text-center">{searchFallbackNote}</p>
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
              <div ref={scrollRef} className={`border border-gray-200 dark:border-gray-700 rounded-lg ${browseScrollMaxH} overflow-y-auto`}>
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

          {/* Step: 절 본문 (리스트) — 스와이프 + 길게 누르기 통합 핸들러 */}
          {browseStep === "verse" && (
            <div
              onTouchStart={handleVerseSwipeStart}
              onTouchMove={handleVerseSwipeMove}
              onTouchEnd={handleVerseSwipeEnd}
              onTouchCancel={() => { cancelLongPress(); swipeStartRef.current = null; }}
            >
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

                {/* 우: 읽기(TTS) + 전체화면(1절씩) 버튼 */}
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
                    disabled={browseVerses.length === 0}
                    aria-label="전체화면 (1절씩 보기)"
                    title="전체화면 (1절씩 보기)"
                    className="inline-flex items-center px-2.5 py-1.5 rounded-lg shadow-sm dark:shadow-none transition-all border text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                  </button>
                </div>
              </div>

              {parallel && browseVersesAlt.length > 0 ? (
                /* 병기 모드 */
                <div ref={scrollRef} className={`border border-gray-200 dark:border-gray-700 rounded-lg ${browseScrollMaxH} overflow-y-auto`}>
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
                        const note = noteFor(v);
                        const tint = note?.color ? colorTint(note.color) : "";
                        return (
                          <button
                            key={v.id}
                            onClick={() => handleToggle(v)}
                            className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 transition-colors ${
                              selected ? "bg-gray-100 dark:bg-gray-800 border-l-4 border-l-gray-400" : tint || "hover:bg-gray-50 dark:bg-gray-900"
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
                                <div className="bible-sub-text ml-7 leading-relaxed text-gray-400" style={{ fontSize: `${fontSize - 2}px`, fontFamily: currentFont.css, fontWeight: currentFont.weight }}>
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

                            {note?.note && (() => {
                              const open = expandedMine.has(v.verse);
                              return (
                                <div
                                  className="mt-1.5 flex items-start gap-1 text-[13px] leading-snug text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40 rounded-md px-2 py-1 cursor-pointer"
                                  onClick={(e) => { e.stopPropagation(); toggleMineExpand(v.verse); }}
                                >
                                  <span className="shrink-0">📝</span>
                                  <div className="min-w-0 flex-1">
                                    <div className={open ? "whitespace-pre-wrap break-words" : "truncate"}>{linkify(note.note)}</div>
                                    {open && (
                                      <div className="text-[10px] text-amber-500/70 mt-0.5">({fmtNoteDate(note.updated_at)})</div>
                                    )}
                                  </div>
                                  <span className="shrink-0 text-amber-400 select-none" aria-hidden>{open ? "▾" : "▸"}</span>
                                </div>
                              );
                            })()}
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
                <div ref={scrollRef} className={`border border-gray-200 dark:border-gray-700 rounded-lg ${browseScrollMaxH} overflow-y-auto`}>
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
              <div ref={scrollRef} className={`border border-gray-200 dark:border-gray-700 rounded-lg ${browseScrollMaxH} overflow-y-auto`}>
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

      {/* ─── 플로팅 액션 카드 (선택 절이 있을 때) — 시안 F: 통합 카드 + 윤곽선 아이콘 ─── */}
      {selectedVerses.length > 0 && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-40 pointer-events-none">
          <div className="pointer-events-auto w-[156px] bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 rounded-2xl shadow-lg dark:shadow-none overflow-hidden">
            {/* 본문으로 (검색 결과에서만) */}
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
                className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 border-b border-[var(--line)] dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
              >
                <svg className="w-[17px] h-[17px] shrink-0 text-gray-500 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                본문으로
              </button>
            )}
            {/* 복사 */}
            <button
              onClick={handleCopyToClipboard}
              className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 border-b border-[var(--line)] dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
            >
              <svg className="w-[17px] h-[17px] shrink-0 text-gray-500 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185.64-.074 1.281-.135 1.927-.184" />
              </svg>
              {copied ? "복사됨" : "복사"}
            </button>
            {/* 메모 (로그인 + 단일) */}
            {isLoggedIn && selectedVerses.length === 1 && (
              <button
                onClick={() => openNoteEditor(selectedVerses[0])}
                className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 border-b border-[var(--line)] dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
              >
                <svg className="w-[17px] h-[17px] shrink-0 text-gray-500 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
                메모
              </button>
            )}
            {/* 수정 (관리자 + 단일) */}
            {adminMode && !bulkEditMode && selectedVerses.length === 1 && editingVerseId == null && (
              <button
                onClick={() => enterEdit(selectedVerses[0])}
                className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 text-[12.5px] font-semibold text-amber-700 dark:text-amber-400 border-b border-[var(--line)] dark:border-gray-700 hover:bg-amber-50 dark:hover:bg-amber-950/30 active:bg-amber-100 dark:active:bg-amber-900/40 transition-colors"
                title="이 절을 수정"
              >
                <svg className="w-[17px] h-[17px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
                수정
              </button>
            )}
            {/* 하이라이트 색칩 4종 + 지우개 (로그인) */}
            {isLoggedIn && (
              <div className="flex items-center px-3 py-3 border-b border-[var(--line)] dark:border-gray-700">
                <div className="flex flex-1 items-center justify-around">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => applyHighlight(c.key)}
                      className={`w-5 h-5 rounded-full ${c.chip} ring-1 ring-black/10 active:scale-90 transition-transform`}
                      title={c.label}
                      aria-label={`${c.label} 하이라이트`}
                    />
                  ))}
                </div>
                <span className="w-px h-5 bg-[var(--line)] dark:bg-gray-600 mx-1.5" aria-hidden />
                <button
                  onClick={() => applyHighlight(null)}
                  className="w-5 h-5 shrink-0 text-gray-400 dark:text-gray-500 active:scale-90 transition-transform"
                  title="하이라이트 지우기"
                  aria-label="하이라이트 지우기"
                >
                  <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M22 21H7" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 11 9 9" />
                  </svg>
                </button>
              </div>
            )}
            {/* 선택 완료 (primary) */}
            <button
              onClick={onConfirm}
              className="w-full flex items-center justify-center gap-2 px-2 py-3 bg-[var(--amber)] hover:bg-[var(--amber-deep)] text-white text-[13px] font-bold active:brightness-95 transition-colors"
            >
              선택 완료
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[11px] font-semibold bg-white/25 rounded-full">
                {selectedVerses.length}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 묵상 메모 에디터 */}
      {noteEditorVerse && (
        <div
          className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4 animate-[fadeInUp_0.2s_ease-out]"
          onClick={() => setNoteEditorVerse(null)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {noteEditorVerse.book_name} {noteEditorVerse.chapter}:{noteEditorVerse.verse} 메모
            </div>
            <p className="text-xs text-gray-400 mb-3 line-clamp-2">{stripNotes(noteEditorVerse.text)}</p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={8}
              autoFocus
              placeholder="이 말씀에 대한 묵상을 적어보세요"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-sm text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--amber)]"
            />
            {/* 공개 범위 — 홀로/목장/전체 (기본 목장). 메모를 적었을 때만 의미 있음 */}
            <div className="mt-3">
              <div className="text-[11px] text-gray-400 mb-1">공개 범위</div>
              <div className="flex gap-1" role="group" aria-label="공개 범위">
                {(["홀로", "목장", "전체"] as const).map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setNoteVisibility(val)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      noteVisibility === val
                        ? "bg-[var(--amber)] text-white"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:brightness-95"
                    }`}
                  >
                    {val}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {noteVisibility === "홀로"
                  ? "나만 봅니다."
                  : noteVisibility === "목장"
                    ? "우리 목장 사람들에게 보입니다."
                    : "전체 사용자에게 보입니다."}
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setNoteEditorVerse(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={saveNote}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--amber)] text-white hover:bg-[var(--amber-deep)]"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 신고 결과 토스트 */}
      {reportToast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[200] bg-gray-900/90 text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          {reportToast}
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
