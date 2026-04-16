"use client";

import { useState, useCallback, useEffect } from "react";
import SearchPanel from "@/components/SearchPanel";
import VerseDisplay from "@/components/VerseDisplay";
import CardPreview from "@/components/CardPreview";
import ScrapList from "@/components/ScrapList";
import { addScrapToServer, fetchMyScraps, migrateLocalScraps } from "@/lib/scrap";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import WorshipBible from "@/components/WorshipBible";
import type { BibleVerse, ViewMode } from "@/lib/types";

export default function Home() {
  const { session, requireAuth, isLoggedIn, logout } = useSession();
  const [selectedVerses, setSelectedVerses] = useState<BibleVerse[]>([]);
  const [view, setView] = useState<ViewMode>("search");
  const [isAddingMore, setIsAddingMore] = useState(false);
  const [scrapCount, setScrapCount] = useState(0);
  const [showScrap, setShowScrap] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [showWorship, setShowWorship] = useState(false);

  // 로그인 후 스크랩 카운트 + localStorage 마이그레이션
  useEffect(() => {
    if (!isLoggedIn) return;
    (async () => {
      await migrateLocalScraps();
      const scraps = await fetchMyScraps();
      setScrapCount(scraps.length);
    })();
  }, [isLoggedIn]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const handleToggleVerse = useCallback((verse: BibleVerse) => {
    setSelectedVerses((prev) => {
      const match = (v: BibleVerse) =>
        v.id === verse.id ||
        (v.book_code === verse.book_code &&
          v.chapter === verse.chapter &&
          v.verse === verse.verse &&
          v.version === verse.version);

      if (prev.some(match)) {
        return prev.filter((v) => !match(v));
      }
      return [...prev, verse];
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setView("display");
    setIsAddingMore(false);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedVerses([]);
    setIsAddingMore(false);
    setView("search");
  }, []);

  const handleAddMore = useCallback(() => {
    setIsAddingMore(true);
    setView("search");
  }, []);

  const handleRemoveVerse = useCallback((verse: BibleVerse) => {
    setSelectedVerses((prev) => {
      const next = prev.filter(
        (v) =>
          !(
            v.book_code === verse.book_code &&
            v.chapter === verse.chapter &&
            v.verse === verse.verse &&
            v.version === verse.version
          )
      );
      if (next.length === 0) {
        setView("search");
        setIsAddingMore(false);
      }
      return next;
    });
  }, []);

  const handleCreateCard = useCallback(async () => {
    if (!requireAuth()) return;
    if (selectedVerses.length > 0) {
      await addScrapToServer(selectedVerses, selectedVerses[0].version as "nkrv" | "rnksv");
      const scraps = await fetchMyScraps();
      setScrapCount(scraps.length);
      showToast("스크랩에 저장되었습니다");
    }
    setView("card");
  }, [selectedVerses, showToast, requireAuth]);

  const handleBackToDisplay = useCallback(() => {
    setView("display");
  }, []);

  // 스크랩 저장 콜백 (VerseDisplay에서 링크 복사 시)
  const handleScrapSaved = useCallback(async () => {
    const scraps = await fetchMyScraps();
    setScrapCount(scraps.length);
    showToast("스크랩에 저장되었습니다");
  }, [showToast]);

  // 스크랩 목록에서 항목 선택 (version, bookCode, chapter, verseStart, verseEnd)
  const handleSelectScrap = useCallback(async (
    version: string, bookCode: string, chapter: number, verseStart: number, verseEnd: number
  ) => {
    const lo = Math.min(verseStart, verseEnd);
    const hi = Math.max(verseStart, verseEnd);
    const verses: number[] = [];
    for (let v = lo; v <= hi; v++) verses.push(v);

    const { data } = await supabase
      .from("bible_verses")
      .select("*")
      .eq("version", version)
      .eq("book_code", bookCode)
      .eq("chapter", chapter)
      .in("verse", verses)
      .order("verse");

    if (data && data.length > 0) {
      setSelectedVerses(data as BibleVerse[]);
      setView("display");
    }
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-2 sm:px-4 overflow-x-hidden">
      {view === "card" ? (
        <CardPreview
          verses={selectedVerses}
          onBack={handleBackToDisplay}
        />
      ) : view === "display" ? (
        <VerseDisplay
          verses={selectedVerses}
          onBack={handleBack}
          onAddMore={handleAddMore}
          onRemoveVerse={handleRemoveVerse}
          onCreateCard={handleCreateCard}
          onScrapSaved={handleScrapSaved}
          requireAuth={requireAuth}
        />
      ) : (
        <SearchPanel
          selectedVerses={selectedVerses}
          onToggleVerse={handleToggleVerse}
          onConfirm={handleConfirm}
          isAddingMore={isAddingMore}
        />
      )}

      {/* 스크랩 오버레이 팝업 */}
      {showScrap && (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setShowScrap(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80vh] bg-gray-50 rounded-t-2xl overflow-y-auto p-4 pt-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
            <ScrapList
              onBack={() => setShowScrap(false)}
              onSelectScrap={(...args) => { setShowScrap(false); handleSelectScrap(...args); }}
              onScrapCountChange={setScrapCount}
            />
          </div>
        </div>
      )}

      {/* 플로팅 스크랩 아이콘 */}
      <button
          onClick={() => { if (requireAuth()) setShowScrap(true); }}
          className="fixed bottom-6 left-6 z-40 w-12 h-12 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-lg hover:bg-gray-50 active:scale-95 transition-all"
          title="스크랩"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
          </svg>
          {scrapCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-gray-700 text-white text-[10px] rounded-full flex items-center justify-center px-1">
              {scrapCount > 99 ? "99+" : scrapCount}
            </span>
          )}
        </button>

      {/* 도구함 아이콘 (우상단) */}
      <div className="fixed top-4 right-4 z-40">
        <button
          onClick={() => setShowToolMenu(!showToolMenu)}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white border border-gray-200 shadow-lg hover:bg-gray-50 active:scale-95 transition-all"
          title="도구함"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        {showToolMenu && (
          <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden min-w-[160px]">
            <button
              onClick={() => { setShowToolMenu(false); setShowWorship(true); }}
              className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              예배성경
            </button>
          </div>
        )}
      </div>

      {/* 예배성경 패널 */}
      {showWorship && (
        <WorshipBible onClose={() => setShowWorship(false)} />
      )}

      {/* 토스트 */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-xl shadow-lg z-50 animate-[fadeInUp_0.2s_ease-out]">
          {toastMessage}
        </div>
      )}
    </main>
  );
}
