"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { OLD_TESTAMENT, NEW_TESTAMENT, getBookByCode } from "@/lib/books";
import { supabase } from "@/lib/supabase";
import type { BibleVersion } from "@/lib/types";
import { readRecent, readBookmarks, type Bookmark, type BiblePosition } from "@/lib/bookmark";

interface QuickNavFabProps {
  currentBookCode: string;
  currentChapter: number;
  mainVersion: BibleVersion;
  /** 절을 선택했을 때 호출. 부모에서 jumpTo 동등 처리 (헤더 버전 그대로 사용) */
  onJump: (bookCode: string, chapter: number, verse: number) => void;
}

// FAB 위치 — 사용자 요청: 우측 상단 구석 고정 (TR/BR 토글 폐지)
const FAB_STYLE: React.CSSProperties = { top: "64px", right: "12px" };

// 패널은 FAB 바로 옆 (왼쪽으로 펼침)
const PANEL_POS: React.CSSProperties = {
  position: "fixed",
  top: "64px",
  right: "64px",
  bottom: "76px",
  maxHeight: "calc(100dvh - 140px)",
};

export default function QuickNavFab({
  currentBookCode,
  currentChapter,
  mainVersion,
  onJump,
}: QuickNavFabProps) {
  const [open, setOpen] = useState(false);
  const [testament, setTestament] = useState<"old" | "new">("old");
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [chapters, setChapters] = useState<number[]>([]);
  const [verses, setVerses] = useState<number[]>([]);
  const [recents, setRecents] = useState<(BiblePosition | Bookmark)[]>([]);

  // 컬럼 스크롤 ref (▲▼ 버튼용)
  const bookScrollRef = useRef<HTMLDivElement>(null);
  const chapterScrollRef = useRef<HTMLDivElement>(null);
  const verseScrollRef = useRef<HTMLDivElement>(null);

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

  // 사용자 요청: FAB 위치 고정(TR) — 토글·길게누르기·더블탭 동작 폐지. 단순 클릭으로 패널 토글.
  const handleClick = () => setOpen((v) => !v);

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
      {/* FAB — 우측 상단 구석 고정 (사용자 요청) */}
      <button
        type="button"
        onClick={handleClick}
        title="성경 빠른 이동"
        aria-label="성경 빠른 이동"
        className={`fixed w-11 h-11 rounded-full border-2 shadow-lg active:scale-95 transition-all z-[55] flex items-center justify-center cursor-pointer hover:scale-105 ${
          open ? "border-[var(--amber)] text-white" : "border-[var(--amber)] text-[var(--amber)]"
        }`}
        style={{
          ...FAB_STYLE,
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
