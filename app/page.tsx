"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import SearchPanel, { type NavRequest } from "@/components/SearchPanel";
import VerseDisplay from "@/components/VerseDisplay";
import CardPreview from "@/components/CardPreview";
import ScrapList from "@/components/ScrapList";
import BottomTabBar, { type ActiveTab } from "@/components/BottomTabBar";
import SettingsSheet from "@/components/SettingsSheet";
import { readBookmarks } from "@/lib/bookmark";
import { addScrapToServer, fetchMyScraps, migrateLocalScraps } from "@/lib/scrap";
import { supabase } from "@/lib/supabase";
import { useSession, LOGIN_URL } from "@/hooks/useSession";
import { useLoginGate } from "@/components/LoginGate";
import { isAdmin } from "@/lib/admin";
import WorshipBible from "@/components/WorshipBible";
import CardBuilder from "@/components/CardBuilder";
import HymnModal from "@/components/HymnModal";
import GlobalFontSettings from "@/components/GlobalFontSettings";
import { useHardwareBack, getActiveModalCount } from "@/hooks/useHardwareBack";
import type { BibleVerse, ViewMode, BibleVersion } from "@/lib/types";
import { useFont } from "@/contexts/FontContext";

const MAIN_VERSION_KEY = "yebom_main_version";
const SUB_VERSION_KEY = "yebom_sub_version";

export default function Home() {
  const { session, isLoggedIn, logout } = useSession();
  const { ensureLogin } = useLoginGate();
  const adminMode = isAdmin(session);
  const [selectedVerses, setSelectedVerses] = useState<BibleVerse[]>([]);
  const [view, setView] = useState<ViewMode>("search");
  const [mainVersion, setMainVersion] = useState<BibleVersion>("rnksv");
  const [subVersion, setSubVersion] = useState<BibleVersion | "none">("none");
  const [versionsLoaded, setVersionsLoaded] = useState(false);

  // 번역본 설정 localStorage 복원/영속화
  useEffect(() => {
    try {
      const m = localStorage.getItem(MAIN_VERSION_KEY) as BibleVersion | null;
      const s = localStorage.getItem(SUB_VERSION_KEY) as BibleVersion | "none" | null;
      if (m) setMainVersion(m);
      if (s) setSubVersion(s);
    } catch {}
    setVersionsLoaded(true);
  }, []);
  useEffect(() => {
    if (!versionsLoaded) return;
    try { localStorage.setItem(MAIN_VERSION_KEY, mainVersion); } catch {}
  }, [mainVersion, versionsLoaded]);
  useEffect(() => {
    if (!versionsLoaded) return;
    try { localStorage.setItem(SUB_VERSION_KEY, subVersion); } catch {}
  }, [subVersion, versionsLoaded]);
  const [isAddingMore, setIsAddingMore] = useState(false);
  const [scrapCount, setScrapCount] = useState(0);
  const [showScrap, setShowScrap] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // 도구함 FAB 제거됨 (Phase 2b SettingsSheet 흡수) — showToolMenu/setShowToolMenu 상태도 함께 제거
  const [showWorship, setShowWorship] = useState(false);
  const [showCardBuilder, setShowCardBuilder] = useState(false);
  const [showHymn, setShowHymn] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const { showFontSettings, setShowFontSettings } = useFont();
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [fullscreenRequestNonce, setFullscreenRequestNonce] = useState(0);

  // ─── Phase 2a 하단 5탭 ───
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [navRequest, setNavRequest] = useState<NavRequest | undefined>();
  const navNonceRef = useRef(0);
  const [bookmarkCount, setBookmarkCount] = useState(0);

  // 책갈피 카운트 — 진입 시 + 5초 폴링 (책갈피 추가/삭제는 SearchPanel 안에서 일어남)
  useEffect(() => {
    const refresh = () => setBookmarkCount(readBookmarks().length);
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === "settings") {
      setShowSettingsSheet(true);
      return;
    }
    setView("search");
    navNonceRef.current += 1;
    setNavRequest({
      target: tab as "toc" | "search" | "read" | "bookmark",
      nonce: navNonceRef.current,
    });
  }, []);

  // 관리자 권한 잃으면 편집 모드 자동 해제
  useEffect(() => {
    if (!adminMode && bulkEditMode) setBulkEditMode(false);
  }, [adminMode, bulkEditMode]);

  // 편집 저장 후 selectedVerses 동기화
  const handleVerseUpdated = useCallback((updated: BibleVerse) => {
    setSelectedVerses((prev) => prev.map((v) => (v.id === updated.id ? { ...v, text: updated.text } : v)));
  }, []);

  // --- 하드웨어 뒤로가기 제어 ---
  useHardwareBack(showScrap, () => setShowScrap(false));
  useHardwareBack(showHymn, () => setShowHymn(false));
  useHardwareBack(showWorship, () => setShowWorship(false));
  useHardwareBack(showCardBuilder, () => setShowCardBuilder(false));
  useHardwareBack(showFontSettings, () => setShowFontSettings(false));
  useHardwareBack(view === "card", () => setView("display"));
  useHardwareBack(view === "display", () => {
    setView("search");
  });
  useHardwareBack(isAddingMore, () => setIsAddingMore(false));

  // 루트 종료 방지
  const exitingRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Chrome "trivial session history context"(히스토리 항목 1개) 대응:
    // 항목이 하나뿐이면 pushState 가 replaceState 로 처리되어 아래 종료 트랩(isAppRoot/isHome)이
    // 안 만들어지고, 뒤로가기가 명시적 확인 없이 곧장 앱 밖으로 나간다.
    // 해시 내비게이션(fragment navigation)으로 실제 항목을 1개 추가해 non-trivial 로 만든 뒤
    // URL 의 해시만 제거(항목은 유지)한다 → 이후 pushState 트랩이 정상 동작.
    if (window.history.length <= 1 && !window.history.state?.isAppRoot) {
      try {
        const cleanUrl = window.location.pathname + window.location.search;
        window.location.hash = "g";
        window.history.replaceState(window.history.state, "", cleanUrl);
      } catch {}
    }
    if (!window.history.state?.isAppRoot) {
      const currentState = window.history.state || {};
      window.history.replaceState({ ...currentState, isAppRoot: true }, "", window.location.href);
      window.history.pushState({ ...currentState, isAppRoot: true, isHome: true }, "", window.location.href);
    }

    const handlePop = (e: PopStateEvent) => {
      // 종료 진행 중이면 핸들러 우회 (무한 재차단 방지)
      if (exitingRef.current) return;
      // useHardwareBack 모달이 활성 상태면 그쪽에서 처리 — 종료 팝업 우회
      // (마운트 타이밍상 modalId 상태가 isHome 없이 history에 끼어들어
      //  sub-mode 뒤로가기에서 종료 팝업이 같이 떠버리는 버그 방지)
      if (getActiveModalCount() > 0) return;
      if (e.state && e.state.isAppRoot && !e.state.isHome) {
        setShowExitConfirm(true);
        // 즉시 홈 상태를 복구하여 앱 종료를 막음
        const currentState = window.history.state || {};
        window.history.pushState({ ...currentState, isAppRoot: true, isHome: true }, "", window.location.href);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

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
    if (!ensureLogin("카드 만들기")) return;
    if (selectedVerses.length > 0) {
      await addScrapToServer(selectedVerses, mainVersion);
      const scraps = await fetchMyScraps();
      setScrapCount(scraps.length);
      showToast("스크랩에 저장되었습니다");
    }
    setView("card");
  }, [selectedVerses, mainVersion, showToast, ensureLogin]);

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
  // 스크랩의 version 으로 mainVersion 도 동기화 — 절 추가 시 같은 version 으로 selectedVerses 가
  // 유지되어 저장 시 중복 row 생성 방지 (다른 version 으로 저장되면 UNIQUE 키 달라 새 row 됨)
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
      setMainVersion(version as BibleVersion);
      setView("display");
    }
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 py-4 px-2 sm:px-4 lg:px-6 overflow-x-hidden">
      <div style={{ display: view === "card" ? "block" : "none" }}>
        <CardPreview
          verses={selectedVerses}
          mainVersion={mainVersion}
          subVersion={subVersion}
          onBack={handleBackToDisplay}
        />
      </div>

      <div style={{ display: view === "display" ? "block" : "none" }}>
        <VerseDisplay
          verses={selectedVerses}
          mainVersion={mainVersion}
          subVersion={subVersion}
          onBack={handleBack}
          onAddMore={handleAddMore}
          onRemoveVerse={handleRemoveVerse}
          onCreateCard={handleCreateCard}
          onScrapSaved={handleScrapSaved}
        />
      </div>

      <div style={{ display: view === "search" ? "block" : "none" }}>
        <SearchPanel
          selectedVerses={selectedVerses}
          mainVersion={mainVersion}
          subVersion={subVersion}
          onMainVersionChange={setMainVersion}
          onSubVersionChange={setSubVersion}
          onToggleVerse={handleToggleVerse}
          onConfirm={handleConfirm}
          isAddingMore={isAddingMore}
          bulkEditMode={bulkEditMode}
          onVerseUpdated={handleVerseUpdated}
          navRequest={navRequest}
          fullscreenRequestNonce={fullscreenRequestNonce}
          onOpenScrap={() => {
            if (ensureLogin("스크랩")) setShowScrap(true);
          }}
          scrapCount={scrapCount}
        />
      </div>

      {/* 스크랩 오버레이 팝업 */}
      {showScrap && (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setShowScrap(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80vh] bg-gray-50 dark:bg-gray-900 rounded-t-2xl overflow-y-auto p-4 pt-2"
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

      {/* 좌하단 스크랩 FAB — Phase 2b 후속 책갈피 탭 안 스크랩 버튼으로 흡수 (사용자 #3) */}
      {/* 도구함 FAB — Phase 2b SettingsSheet 흡수 (사용자 #5) */}

      {/* 예배성경 패널 */}
      {showWorship && (
        <WorshipBible onClose={() => setShowWorship(false)} />
      )}

      {/* 찬송가 모달 */}
      {showHymn && (
        <HymnModal onClose={() => setShowHymn(false)} />
      )}

      {/* 성경카드 빌더 */}
      {showCardBuilder && (
        <CardBuilder
          onClose={() => setShowCardBuilder(false)}
          onStart={(verses) => {
            setSelectedVerses(verses);
            setView("card");
            setShowCardBuilder(false);
          }}
        />
      )}

      {/* 토스트 */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-xl shadow-lg dark:shadow-none z-50 animate-[fadeInUp_0.2s_ease-out]">
          {toastMessage}
        </div>
      )}

      {/* 앱 종료 확인 팝업 */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-72 shadow-xl animate-[scaleIn_0.2s_ease-out]">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">앱 종료</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">예봄성경을 종료하시겠습니까?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:bg-gray-700"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowExitConfirm(false);
                  exitingRef.current = true;
                  // 우리가 푸시한 isHome + isAppRoot 두 단계를 한 번에 통과
                  // (TWA/PWA에서 history 끝에 도달하면 OS가 앱 종료)
                  window.history.go(-2);
                  // PWA standalone에서는 window.close() 시도 (대부분 차단되지만 일부 환경에서 동작)
                  setTimeout(() => {
                    try { window.close(); } catch {}
                  }, 100);
                }}
                className="flex-1 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-xl hover:bg-black"
              >
                종료
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showFontSettings && <GlobalFontSettings onClose={() => setShowFontSettings(false)} />}

      {/* 통합 설정 시트 — Phase 2b */}
      {showSettingsSheet && (
        <SettingsSheet
          onClose={() => setShowSettingsSheet(false)}
          userName={session?.name}
          isLoggedIn={isLoggedIn}
          onLogin={() => {
            window.location.href = LOGIN_URL;
          }}
          onLogout={async () => { await logout(); }}
          adminMode={adminMode}
          bulkEditMode={bulkEditMode}
          onToggleBulkEdit={() => setBulkEditMode((v) => !v)}
          onOpenHymn={() => setShowHymn(true)}
          onOpenWorship={() => setShowWorship(true)}
          onOpenCardBuilder={() => setShowCardBuilder(true)}
          canCreateCard={selectedVerses.length > 0}
          onOpenFullscreen={() => setFullscreenRequestNonce((n) => n + 1)}
          canOpenFullscreen={view === "search"}
          onExit={() => setShowExitConfirm(true)}
        />
      )}

      {/* Phase 2a/2b — 하단 5탭 (목차/검색/읽기/책갈피/설정) */}
      {view === "search" && (
        <BottomTabBar
          active={activeTab}
          onTabChange={handleTabChange}
          bookmarkCount={bookmarkCount}
        />
      )}
    </main>
  );
}
