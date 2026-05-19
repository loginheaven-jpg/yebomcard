"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { OLD_TESTAMENT, NEW_TESTAMENT, getBookByCode } from "@/lib/books";
import { supabase } from "@/lib/supabase";
import type { BibleVersion } from "@/lib/types";
import { readRecent, readBookmarks, type Bookmark, type BiblePosition } from "@/lib/bookmark";

type Corner = "tl" | "tr" | "bl" | "br";

interface QuickNavFabProps {
  currentBookCode: string;
  currentChapter: number;
  mainVersion: BibleVersion;
  /** 절을 선택했을 때 호출. 부모에서 jumpTo 동등 처리 (헤더 버전 그대로 사용) */
  onJump: (bookCode: string, chapter: number, verse: number) => void;
}

const CORNER_POS: Record<Corner, { top?: string; bottom?: string; left?: string; right?: string }> = {
  tl: { top: "12px", left: "12px" },
  tr: { top: "12px", right: "12px" },
  bl: { bottom: "68px", left: "12px" },   // 좌하단 스크랩 FAB 위
  br: { bottom: "68px", right: "12px" },  // 우하단 도구 FAB 위
};

// 패널은 FAB의 안쪽 방향으로 펼침
const PANEL_POS: Record<Corner, { top?: string; bottom?: string; left?: string; right?: string }> = {
  tl: { top: "60px", left: "12px" },
  tr: { top: "60px", right: "12px" },
  bl: { bottom: "120px", left: "12px" },
  br: { bottom: "120px", right: "12px" },
};

export default function QuickNavFab({
  currentBookCode,
  currentChapter,
  mainVersion,
  onJump,
}: QuickNavFabProps) {
  const [corner, setCorner] = useState<Corner>("tl");
  const [open, setOpen] = useState(false);
  const [testament, setTestament] = useState<"old" | "new">("old");
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [chapters, setChapters] = useState<number[]>([]);
  const [verses, setVerses] = useState<number[]>([]);
  const [recents, setRecents] = useState<(BiblePosition | Bookmark)[]>([]);

  // 드래그 상태
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const moved = useRef(false);

  // 컬럼 스크롤 ref (▲▼ 버튼용)
  const bookScrollRef = useRef<HTMLDivElement>(null);
  const chapterScrollRef = useRef<HTMLDivElement>(null);
  const verseScrollRef = useRef<HTMLDivElement>(null);

  // localStorage 코너 위치
  useEffect(() => {
    try {
      const stored = localStorage.getItem("yebom_quicknav_pos");
      if (stored && ["tl", "tr", "bl", "br"].includes(stored)) {
        setCorner(stored as Corner);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("yebom_quicknav_pos", corner); } catch {}
  }, [corner]);

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

  // 길게 누르기 → 드래그 진입
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    moved.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    longPressTimer.current = window.setTimeout(() => {
      setDragging(true);
      setDragPos({ x: startX, y: startY });
    }, 400);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragging) {
      moved.current = true;
      setDragPos({ x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (dragging && dragPos) {
      // 가장 가까운 코너로 스냅
      const w = window.innerWidth;
      const h = window.innerHeight;
      const left = dragPos.x < w / 2;
      const top = dragPos.y < h / 2;
      const newCorner = `${top ? "t" : "b"}${left ? "l" : "r"}` as Corner;
      setCorner(newCorner);
      setDragging(false);
      setDragPos(null);
    }
  };

  const handleClick = () => {
    // 드래그 종료 직후 클릭은 무시
    if (moved.current) {
      moved.current = false;
      return;
    }
    setOpen((v) => !v);
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

  // 컬럼 스크롤 helper
  const scrollColumn = (ref: React.RefObject<HTMLDivElement | null>, delta: number) => {
    if (ref.current) ref.current.scrollBy({ top: delta, behavior: "smooth" });
  };

  // 책 목록 (구약/신약)
  const bookList = useMemo(
    () => (testament === "old" ? OLD_TESTAMENT : NEW_TESTAMENT),
    [testament]
  );

  // FAB 위치 스타일
  const fabStyle = dragging && dragPos
    ? { position: "fixed" as const, left: dragPos.x - 22, top: dragPos.y - 22 }
    : { position: "fixed" as const, ...CORNER_POS[corner] };

  // 패널 위치 스타일
  const panelStyle = { position: "fixed" as const, ...PANEL_POS[corner] };

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        title="퀵 네비게이션 (길게 누르면 위치 이동)"
        aria-label="퀵 네비게이션"
        className={`w-11 h-11 rounded-full bg-white border-2 border-amber-600 shadow-lg active:scale-95 transition-transform z-[55] flex items-center justify-center ${dragging ? "opacity-70 cursor-grabbing" : "cursor-pointer hover:scale-105"}`}
        style={fabStyle}
      >
        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-600 text-white text-[8px] font-bold flex items-center justify-center">▸</span>
      </button>

      {/* 드래그 가이드 점 */}
      {dragging && (
        <>
          <span className="fixed top-3 left-3 w-2 h-2 rounded-full bg-amber-600/40 z-[54] pointer-events-none" />
          <span className="fixed top-3 right-3 w-2 h-2 rounded-full bg-amber-600/40 z-[54] pointer-events-none" />
          <span className="fixed bottom-3 left-3 w-2 h-2 rounded-full bg-amber-600/40 z-[54] pointer-events-none" />
          <span className="fixed bottom-3 right-3 w-2 h-2 rounded-full bg-amber-600/40 z-[54] pointer-events-none" />
        </>
      )}

      {/* 펼침 패널 */}
      {open && !dragging && (
        <>
          {/* 바깥 탭 시 닫기 */}
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />

          <div
            className="z-[60] flex bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-2xl overflow-hidden"
            style={{ ...panelStyle, height: "440px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 0열: 최근 */}
            <div className="flex flex-col bg-amber-50/40 dark:bg-amber-950/20" style={{ width: 42 }}>
              <div className="text-[8px] font-bold text-gray-400 dark:text-gray-500 text-center py-1 tracking-wide bg-gray-50 dark:bg-gray-900/60 sticky top-0">최근</div>
              <div className="flex-1 overflow-y-auto scrollbar-hide">
                {recents.length > 0 ? recents.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => handleRecentTap(r)}
                    className="block w-full text-center text-[9px] py-1.5 text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 truncate font-semibold"
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
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 32 }}>
              <div className="text-[8px] font-bold text-gray-400 dark:text-gray-500 text-center py-1 tracking-wide bg-gray-50 dark:bg-gray-900/60 sticky top-0">권</div>
              <button
                onClick={() => { setTestament("old"); setSelectedBook(null); setSelectedChapter(null); }}
                className={`text-[10px] py-2 transition-colors ${testament === "old" ? "bg-gray-900 text-white font-bold" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                구
              </button>
              <button
                onClick={() => { setTestament("new"); setSelectedBook(null); setSelectedChapter(null); }}
                className={`text-[10px] py-2 transition-colors ${testament === "new" ? "bg-gray-900 text-white font-bold" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
              >
                신
              </button>
            </div>

            {/* 2열: 책 */}
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 52 }}>
              <div className="text-[8px] font-bold text-gray-400 dark:text-gray-500 text-center py-1 tracking-wide bg-gray-50 dark:bg-gray-900/60 sticky top-0">책</div>
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
                    className={`block w-full text-center text-[10px] py-1.5 transition-colors ${selectedBook === b.code ? "bg-gray-900 text-white font-bold" : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
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
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 52 }}>
              <div className="text-[8px] font-bold text-gray-400 dark:text-gray-500 text-center py-1 tracking-wide bg-gray-50 dark:bg-gray-900/60 sticky top-0">장</div>
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
                    className={`block w-full text-center text-[10px] py-1.5 transition-colors ${selectedChapter === c ? "bg-gray-900 text-white font-bold" : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
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
            <div className="flex flex-col border-l border-gray-100 dark:border-gray-700" style={{ width: 52 }}>
              <div className="text-[8px] font-bold text-gray-400 dark:text-gray-500 text-center py-1 tracking-wide bg-gray-50 dark:bg-gray-900/60 sticky top-0">절</div>
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
                    className="block w-full text-center text-[10px] py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-900 hover:text-white transition-colors font-medium"
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
