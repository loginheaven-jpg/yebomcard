"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { OLD_TESTAMENT, NEW_TESTAMENT, getBookByCode } from "@/lib/books";
import { supabase } from "@/lib/supabase";
import type { BibleVersion } from "@/lib/types";
import { readRecent, readBookmarks, type Bookmark, type BiblePosition } from "@/lib/bookmark";

type FabPos = "tr" | "br";

interface QuickNavFabProps {
  currentBookCode: string;
  currentChapter: number;
  mainVersion: BibleVersion;
  /** 절을 선택했을 때 호출. 부모에서 jumpTo 동등 처리 (헤더 버전 그대로 사용) */
  onJump: (bookCode: string, chapter: number, verse: number) => void;
}

// FAB 위치 — 우측 상단 구석(기본) / 우측 하단 (BottomTabBar 위)
// 사용자 요청: 더블탭·길게 누르기로 두 위치 사이 토글
const FAB_POS: Record<FabPos, React.CSSProperties> = {
  tr: { top: "12px", right: "12px" },     // 헤더 우측 빈 자리 (3열 grid 우측 column)
  br: { bottom: "80px", right: "12px" },  // BottomTabBar(~60px) 위
};

// 패널은 FAB 위치와 무관하게 항상 같은 자리 (헤더 아래)
const PANEL_POS: React.CSSProperties = {
  position: "fixed",
  top: "64px",
  right: "64px",
  bottom: "80px",
  maxHeight: "calc(100dvh - 144px)",
};

export default function QuickNavFab({
  currentBookCode,
  currentChapter,
  mainVersion,
  onJump,
}: QuickNavFabProps) {
  const [pos, setPos] = useState<FabPos>("tr");
  const [open, setOpen] = useState(false);
  const [testament, setTestament] = useState<"old" | "new">("old");
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [chapters, setChapters] = useState<number[]>([]);
  const [verses, setVerses] = useState<number[]>([]);
  const [recents, setRecents] = useState<(BiblePosition | Bookmark)[]>([]);

  // 위치 토글 (사용자 요청 복원): 길게 누르기(500ms) + 더블 탭(250ms 이내)
  const longPressTimer = useRef<number | null>(null);
  const singleTapTimer = useRef<number | null>(null);
  const lastTapTime = useRef(0);
  const wasLongPress = useRef(false);

  // 컬럼 스크롤 ref (▲▼ 버튼용)
  const bookScrollRef = useRef<HTMLDivElement>(null);
  const chapterScrollRef = useRef<HTMLDivElement>(null);
  const verseScrollRef = useRef<HTMLDivElement>(null);

  // localStorage 위치 로드/저장
  useEffect(() => {
    try {
      const stored = localStorage.getItem("yebom_quicknav_pos");
      if (stored === "tr" || stored === "br") setPos(stored);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("yebom_quicknav_pos", pos); } catch {}
  }, [pos]);

  // 최근 위치 모음
  useEffect(() => {
    if (!open) return;
    const r = readRecent();
    const bm = readBookmarks();
    const merged: (BiblePosition | Bookmark)[] = [];
    if (r) merged.push(r);
    for (const b of bm) {
      if (!merged.find((m) => m.book_code === b.book_code && m.chapter === b.chapter)) {
        merged.push(b);
      }
    }
    setRecents(merged.slice(0, 8));
  }, [open]);

  // 패널 열릴 때 현재 위치를 기본 선택
  useEffect(() => {
    if (!open) return;
    if (currentBookCode) {
      const book = getBookByCode(currentBookCode);
      if (book) {
        setTestament(book.testament === "old" ? "old" : "new");
        setSelectedBook(currentBookCode);
      }
    }
    if (currentChapter) setSelectedChapter(currentChapter);
  }, [open, currentBookCode, currentChapter]);

  // 선택된 책 → 장 목록 fetch
  useEffect(() => {
    if (!selectedBook) { setChapters([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_chapters", {
        p_version: mainVersion,
        p_book_code: selectedBook,
      });
      if (cancelled) return;
      if (data) setChapters((data as { chapter: number }[]).map((d) => d.chapter));
    })();
    return () => { cancelled = true; };
  }, [selectedBook, mainVersion]);

  // 선택된 책+장 → 절 목록 fetch
  useEffect(() => {
    if (!selectedBook || !selectedChapter) { setVerses([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("bible_verses")
        .select("verse")
        .eq("version", mainVersion)
        .eq("book_code", selectedBook)
        .eq("chapter", selectedChapter)
        .order("verse");
      if (cancelled) return;
      if (data) {
        const unique = Array.from(new Set((data as { verse: number }[]).map((d) => d.verse)));
        setVerses(unique);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBook, selectedChapter, mainVersion]);

  // 위치 토글 헬퍼 (햅틱 진동 포함)
  const togglePosShared = () => {
    setPos((p) => (p === "tr" ? "br" : "tr"));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate(50); } catch {}
    }
  };

  // 길게 누르기 (500ms) → 위치 토글 + 햅틱
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const handlePointerDown = () => {
    wasLongPress.current = false;
    longPressTimer.current = window.setTimeout(() => {
      wasLongPress.current = true;
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      togglePosShared();
    }, 500);
  };
  const handlePointerUp = () => cancelLongPress();
  const handlePointerLeave = () => cancelLongPress();
  const handlePointerCancel = () => cancelLongPress();

  const handleClick = () => {
    // 길게 누르기 후 합성 click 무시
    if (wasLongPress.current) {
      wasLongPress.current = false;
      return;
    }
    const now = Date.now();
    const isDouble = now - lastTapTime.current < 250;
    if (isDouble) {
      // 더블 탭 → 위치 토글
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      lastTapTime.current = 0;
      togglePosShared();
      return;
    }
    // 단일 탭 → 250ms 대기 후 panel toggle
    lastTapTime.current = now;
    singleTapTimer.current = window.setTimeout(() => {
      setOpen((v) => !v);
      singleTapTimer.current = null;
    }, 250);
  };

  // 0열 최근 항목 탭 → 즉시 점프
  const handleRecentTap = (r: BiblePosition | Bookmark) => {
    onJump(r.book_code, r.chapter, r.verse ?? 1);
    setOpen(false);
    setSelectedBook(null);
    setSelectedChapter(null);
  };

  // 절 탭 → 점프 + 닫기
  const handleVerseTap = (verse: number) => {
    if (!selectedBook || !selectedChapter) return;
    onJump(selectedBook, selectedChapter, verse);
    setOpen(false);
    setSelectedBook(null);
    setSelectedChapter(null);
  };

  // 컬럼 스크롤 helper (▲▼ 버튼)
  const scrollColumn = (ref: React.RefObject<HTMLDivElement | null>, delta: number) => {
    if (ref.current) ref.current.scrollBy({ top: delta, behavior: "smooth" });
  };

  // 책 목록 (구약/신약)
  const bookList = useMemo(
    () => (testament === "old" ? OLD_TESTAMENT : NEW_TESTAMENT),
    [testament]
  );

  return (
    <>
      {/* FAB — 우측 상단(기본) / 우측 하단 (더블탭·길게누르기로 토글) */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        title="성경 빠른 이동 (더블탭 또는 길게 누르면 위치 토글)"
        aria-label="성경 빠른 이동"
        className={`fixed w-11 h-11 rounded-full border-2 shadow-lg active:scale-95 transition-all z-[55] flex items-center justify-center cursor-pointer hover:scale-105 ${
          open ? "border-[var(--amber)] text-white" : "border-[var(--amber)] text-[var(--amber)]"
        }`}
        style={{
          ...FAB_POS[pos],
          backgroundColor: open ? "var(--amber)" : "rgba(255, 255, 255, 0.85)",
        }}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center ${open ? "bg-white text-amber-600" : "bg-amber-600 text-white"}`}>
          {open ? "◂" : "▸"}
        </span>
      </button>

      {/* 펼침 패널 — FAB 위치와 무관하게 항상 같은 자리 */}
      {open && (
        <>
          {/* 바깥 탭 시 닫기 */}
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />

          <div
            className="z-[60] flex border border-gray-300 dark:border-gray-600 rounded-lg shadow-2xl overflow-hidden"
            style={{
              ...PANEL_POS,
              backgroundColor: "var(--qnav-panel-bg)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 0열: 최근 */}
            <div className="flex flex-col bg-amber-50/40 dark:bg-amber-950/20" style={{ width: 46 }}>
              <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 text-center py-2 tracking-wide bg-gray-100/70 dark:bg-gray-900/60 sticky top-0">최근</div>
              <div className="flex-1 overflow-y-auto scrollbar-hide">
                {recents.length > 0 ? recents.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => handleRecentTap(r)}
                    className="block w-full text-center text-[11px] py-2 text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 truncate font-semibold"
                  >
                    {getBookByCode(r.book_code)?.abbr ?? r.book_code}
                    {r.chapter}
                  </button>
                )) : (
                  <div className="text-[8px] text-gray-300 dark:text-gray-600 text-center pt-3 px-1 italic">없음</div>
                )}
              </div>
            </div>

            {/* 1열: 권 (구약/신약) */}
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 34 }}>
              <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 text-center py-2 tracking-wide bg-gray-100/70 dark:bg-gray-900/60 sticky top-0">권</div>
              <button
                onClick={() => { setTestament("old"); setSelectedBook(null); setSelectedChapter(null); }}
                className={`text-[12px] py-2 transition-colors ${testament === "old" ? "bg-gray-900 text-white font-bold" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                구
              </button>
              <button
                onClick={() => { setTestament("new"); setSelectedBook(null); setSelectedChapter(null); }}
                className={`text-[12px] py-2 transition-colors ${testament === "new" ? "bg-gray-900 text-white font-bold" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                신
              </button>
            </div>

            {/* 2열: 책 */}
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 56 }}>
              <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 text-center py-2 tracking-wide bg-gray-100/70 dark:bg-gray-900/60 sticky top-0">책</div>
              <button
                onClick={() => scrollColumn(bookScrollRef, -80)}
                className="h-4 bg-gray-50/70 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="위로"
              >▲</button>
              <div ref={bookScrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
                {bookList.map((b) => (
                  <button
                    key={b.code}
                    onClick={() => { setSelectedBook(b.code); setSelectedChapter(null); }}
                    className={`block w-full text-center text-[12px] py-2 transition-colors ${selectedBook === b.code ? "bg-gray-900 text-white font-bold" : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                  >
                    {b.abbr}
                  </button>
                ))}
              </div>
              <button
                onClick={() => scrollColumn(bookScrollRef, 80)}
                className="h-4 bg-gray-50/70 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="아래로"
              >▼</button>
            </div>

            {/* 3열: 장 */}
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 56 }}>
              <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 text-center py-2 tracking-wide bg-gray-100/70 dark:bg-gray-900/60 sticky top-0">장</div>
              <button
                onClick={() => scrollColumn(chapterScrollRef, -80)}
                className="h-4 bg-gray-50/70 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >▲</button>
              <div ref={chapterScrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
                {chapters.length === 0 && selectedBook && (
                  <div className="text-[8px] text-gray-300 dark:text-gray-600 text-center pt-3 italic">···</div>
                )}
                {chapters.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedChapter(c)}
                    className={`block w-full text-center text-[12px] py-2 transition-colors ${selectedChapter === c ? "bg-gray-900 text-white font-bold" : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <button
                onClick={() => scrollColumn(chapterScrollRef, 80)}
                className="h-4 bg-gray-50/70 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >▼</button>
            </div>

            {/* 4열: 절 */}
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 56 }}>
              <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 text-center py-2 tracking-wide bg-gray-100/70 dark:bg-gray-900/60 sticky top-0">절</div>
              <button
                onClick={() => scrollColumn(verseScrollRef, -80)}
                className="h-4 bg-gray-50/70 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >▲</button>
              <div ref={verseScrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
                {verses.length === 0 && selectedChapter && (
                  <div className="text-[8px] text-gray-300 dark:text-gray-600 text-center pt-3 italic">···</div>
                )}
                {verses.map((v) => (
                  <button
                    key={v}
                    onClick={() => handleVerseTap(v)}
                    className="block w-full text-center text-[12px] py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-900 hover:text-white transition-colors font-medium"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                onClick={() => scrollColumn(verseScrollRef, 80)}
                className="h-4 bg-gray-50/70 dark:bg-gray-900/40 text-gray-400 dark:text-gray-500 text-[9px] hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >▼</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
