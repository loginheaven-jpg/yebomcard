"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import SearchPanel, { type NavRequest } from "@/components/SearchPanel";
import VerseDisplay from "@/components/VerseDisplay";
import CardPreview from "@/components/CardPreview";
import ScrapList from "@/components/ScrapList";
import BottomTabBar, { type ActiveTab } from "@/components/BottomTabBar";
import ReadingPlanPanel from "@/components/ReadingPlanPanel";
import PlanHeader from "@/components/PlanHeader";
import UnitCompleteSheet, { wasUnitSheetShown } from "@/components/UnitCompleteSheet";
import {
  YEBOM91,
  flattenPlan,
  findPlanIndex,
  planStep,
  unitChapters as unitChaptersOf,
  computeUnitProgress,
  chapterEntryVerse,
  chapterSegments,
} from "@/lib/plans/yebom91";
import { fetchReadChapters, computeProgress } from "@/lib/reading-progress";
import { fetchUnitChecks } from "@/lib/reading-plan";
import { getBookByCode } from "@/lib/books";
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
import { isIntentionalLeave, markIntentionalLeave } from "@/lib/appExit";
import type { BibleVerse, ViewMode, BibleVersion } from "@/lib/types";
import { useFont } from "@/contexts/FontContext";

const MAIN_VERSION_KEY = "yebom_main_version";
const SUB_VERSION_KEY = "yebom_sub_version";
const AUTOHIDE_TABBAR_KEY = "yebom_autohide_tabbar";
/** 본문에서 무조작 시 하단 탭바를 감추기까지의 시간 */
const TABBAR_HIDE_MS = 3000;

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

  // ─── 본문 몰입: 하단 탭바 자동 숨김 ───
  // 본문(장 읽기) 화면에서만 동작. 무조작 3초 → 아래로 슬라이드 감춤(얇은 손잡이만 남음).
  // 복귀: 하단 손잡이 탭 + 위로 스크롤. 본문은 내부 컨테이너 스크롤이라 capture 로 수집.
  const [autoHideTabBar, setAutoHideTabBar] = useState(true);
  const [isReadingView, setIsReadingView] = useState(false);
  const [tabBarHidden, setTabBarHidden] = useState(false);
  const tabBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(AUTOHIDE_TABBAR_KEY);
      if (v !== null) setAutoHideTabBar(v === "1");
    } catch {}
  }, []);

  const changeAutoHideTabBar = useCallback((on: boolean) => {
    setAutoHideTabBar(on);
    try { localStorage.setItem(AUTOHIDE_TABBAR_KEY, on ? "1" : "0"); } catch {}
  }, []);

  const armTabBarHide = useCallback((enabled: boolean) => {
    if (tabBarTimer.current) clearTimeout(tabBarTimer.current);
    tabBarTimer.current = null;
    if (!enabled) return;
    tabBarTimer.current = setTimeout(() => setTabBarHidden(true), TABBAR_HIDE_MS);
  }, []);

  // 자동 숨김은 **본문을 볼 때만**이다. 말씀의삶 탭은 목록 화면이라 숨기면 안 된다.
  // SearchPanel 이 display:none 으로만 가려져 언마운트되지 않으므로 isReadingView 는
  // plan 뷰에서도 true 로 남는다 — view 조건을 반드시 함께 봐야 한다.
  const shouldAutoHideTabBar = autoHideTabBar && isReadingView && view === "search";

  /** 탭바 표시 + (본문·설정 ON 이면) 다시 감출 타이머 재무장 */
  const revealTabBar = useCallback(() => {
    setTabBarHidden(false);
    armTabBarHide(shouldAutoHideTabBar);
  }, [armTabBarHide, shouldAutoHideTabBar]);

  // 본문 진입/이탈 · 설정 변경 시 재평가
  useEffect(() => {
    setTabBarHidden(false);
    armTabBarHide(shouldAutoHideTabBar);
    return () => { if (tabBarTimer.current) clearTimeout(tabBarTimer.current); };
  }, [shouldAutoHideTabBar, armTabBarHide]);

  // 위로 스크롤하면 다시 표시 (scroll 은 버블링하지 않으므로 capture 단계에서 수집)
  useEffect(() => {
    if (!shouldAutoHideTabBar) return;
    const lastTop = new WeakMap<EventTarget, number>();
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const prev = lastTop.get(t) ?? t.scrollTop;
      const cur = t.scrollTop;
      lastTop.set(t, cur);
      if (cur < prev - 4) revealTabBar(); // 위로 스크롤 → 표시
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [shouldAutoHideTabBar, revealTabBar]);

  // ─── Phase 2a 하단 6탭 ───
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [navRequest, setNavRequest] = useState<NavRequest | undefined>();
  const navNonceRef = useRef(0);
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [reportCount, setReportCount] = useState(0); // 운영자 미처리 신고 건수 (톱니 점·설정 배지)

  // 책갈피 카운트 — 진입 시 + 5초 폴링 (책갈피 추가/삭제는 SearchPanel 안에서 일어남)
  useEffect(() => {
    const refresh = () => setBookmarkCount(readBookmarks().length);
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  // ─── 말씀의삶 플랜 모드 ───
  // 위치(idx)를 상태로 들지 않는다. SearchPanel 의 setChapter/setBookCode 호출 지점이
  // 20곳이 넘고 그중 다수가 플랜과 무관한 점프라, 상태로 들면 헤더가 거짓말을 한다.
  // on/off 와 seq 만 들고 현재 위치에서 매번 파생한다.
  // 위치 보고 콜백이 최신 view 를 보게 한다 — 콜백을 매번 새로 만들면 SearchPanel 의
  // 보고 effect 가 매 렌더 재실행된다(deps 에 콜백이 있다).
  const viewRef = useRef<ViewMode>("search");
  useEffect(() => { viewRef.current = view; }, [view]);

  const [planMode, setPlanMode] = useState<{ planId: "yebom91"; seq: number } | null>(null);
  const [planPos, setPlanPos] = useState<{ book: string; chapter: number } | null>(null);
  const [planReadByBook, setPlanReadByBook] = useState<Record<string, Set<number>>>({});
  const [planManual, setPlanManual] = useState<Set<number>>(new Set());
  const [completedSeq, setCompletedSeq] = useState<number | null>(null);
  const [fullscreenCloseNonce, setFullscreenCloseNonce] = useState(0);

  const planFlat = useMemo(() => flattenPlan(YEBOM91), []);
  const planIdx =
    planMode && planPos ? findPlanIndex(planFlat, planMode.seq, planPos.book, planPos.chapter) : -1;
  const planUnit = planMode ? YEBOM91.units[planMode.seq - 1] : null;
  const planUnitChapters = useMemo(
    () => (planUnit ? unitChaptersOf(planUnit) : undefined),
    [planUnit],
  );

  // 진도 — 플랜 헤더의 "n / total장" 과 완료 시트에 쓴다
  const reloadPlanProgress = useCallback(async () => {
    const [read, seqs] = await Promise.all([fetchReadChapters(), fetchUnitChecks()]);
    setPlanReadByBook(computeProgress(read).readByBook);
    setPlanManual(new Set(seqs));
  }, []);
  useEffect(() => {
    if (planMode) void reloadPlanProgress();
  }, [planMode, reloadPlanProgress]);

  /** 회차로 진입 — entryChapter 로 간다 */
  const openPlanUnit = useCallback(
    (seq: number) => {
      const progress = computeUnitProgress(YEBOM91, planReadByBook, planManual);
      const unit = YEBOM91.units[seq - 1];
      const chs = unitChaptersOf(unit);
      // 그 회차가 currentSeq 면 entryChapter 를, 아니면 회차 첫 장을 쓴다
      const target =
        progress.entryChapter && progress.entryChapter.seq === seq
          ? { book: progress.entryChapter.book, chapter: progress.entryChapter.chapter }
          : { book: chs[0].book, chapter: chs[0].chapter };
      setPlanMode({ planId: "yebom91", seq });
      setPlanPos(target);
      setView("search");
      setActiveTab("read");
      // 진도표는 새번역 기준이다. 성우는 TtsContext 의 역본 기본값 규칙이 이어받아
      // 영희(f4)로 맞춘다 — 교인이 성우를 직접 고른 적이 있으면 그 선택을 존중한다.
      setMainVersion("rnksv");
      navNonceRef.current += 1;
      setNavRequest({
        target: "chapter",
        nonce: navNonceRef.current,
        book: target.book,
        chapter: target.chapter,
        verse: chapterEntryVerse(unit, target.book, target.chapter),
      });
    },
    [planReadByBook, planManual],
  );

  /** 플랜 순서로 이동 — 도착 항목이 seq 를 결정한다 */
  const goPlan = useCallback(
    (t: { book: string; chapter: number; seq?: number; verse?: number }) => {
      setPlanPos({ book: t.book, chapter: t.chapter });
      navNonceRef.current += 1;
      setNavRequest({
        target: "chapter",
        nonce: navNonceRef.current,
        book: t.book,
        chapter: t.chapter,
        // 진도표가 장 중간부터 읽는 구간이면 그 절로 내려간다(예: 10회차 민수기 9:15)
        verse: t.verse,
      });
    },
    [],
  );

  const planNav = useMemo(() => {
    if (!planMode || !planUnit) return undefined;
    const prev = planIdx >= 0 ? planStep(planFlat, planIdx, -1) : null;
    const next = planIdx >= 0 ? planStep(planFlat, planIdx, 1) : null;
    const readCount = planUnitChapters
      ? planUnitChapters.filter((c: { book: string; chapter: number }) =>
          planReadByBook[c.book]?.has(c.chapter)).length
      : 0;
    return {
      header: (
        <PlanHeader
          unit={planUnit}
          readCount={readCount}
          total={planUnitChapters?.length ?? 0}
          current={planPos}
          offPlan={planIdx === -1}
          bookName={(code) => getBookByCode(code)?.nameKr ?? code}
          isLoggedIn={!!session?.isLoggedIn}
          onOpenPlan={() => setView("plan")}
          onReturnToPlan={() => openPlanUnit(planMode.seq)}
        />
      ),
      // 도착 장의 진입 절까지 실어 보낸다. 도착지가 다른 회차일 수 있으므로
      // 진입 절은 **도착 항목의 seq** 기준으로 뽑는다.
      prev: prev
        ? {
            book: prev.book,
            chapter: prev.chapter,
            seq: prev.seq,
            verse: chapterEntryVerse(YEBOM91.units[prev.seq - 1], prev.book, prev.chapter),
            segments: chapterSegments(YEBOM91.units[prev.seq - 1], prev.book, prev.chapter),
          }
        : null,
      next: next
        ? {
            book: next.book,
            chapter: next.chapter,
            seq: next.seq,
            verse: chapterEntryVerse(YEBOM91.units[next.seq - 1], next.book, next.chapter),
            // 자동 다음 장 낭독이 도착 장의 순서를 그대로 따르게 한다
            segments: chapterSegments(YEBOM91.units[next.seq - 1], next.book, next.chapter),
          }
        : null,
      // 지금 보고 있는 장을 이 회차가 어떤 순서로 읽는가 — 낭독이 이 순서를 따른다
      segments: chapterSegments(planUnit, planPos?.book ?? "", planPos?.chapter ?? 0),
      onGo: (t: { book: string; chapter: number; seq?: number; verse?: number }) => {
        // 도착 항목의 seq 로 갱신한다(인접 중복 장은 planStep 이 이미 건너뛴다)
        if (t.seq) setPlanMode({ planId: "yebom91", seq: t.seq });
        goPlan(t);
      },
    };
  }, [planMode, planUnit, planIdx, planFlat, planUnitChapters, planReadByBook, planPos, session, openPlanUnit, goPlan]);

  /** SearchPanel 이 보고한 현재 위치 — 본문을 볼 때만 받는다.
   *  SearchPanel 은 다른 뷰에서도 언마운트되지 않아 숨은 위치 변화까지 올라온다. */
  const handlePositionChange = useCallback(
    (book: string, chapter: number) => {
      if (viewRef.current !== "search") return;
      setPlanPos((p) => (p && p.book === book && p.chapter === chapter ? p : { book, chapter }));
    },
    [],
  );

  /** 회차 완료 — 이미 보여준 회차면 시트를 띄우지 않는다(새로고침 후에도) */
  const handleUnitComplete = useCallback((seq: number) => {
    if (wasUnitSheetShown(seq)) return;
    setFullscreenCloseNonce((n) => n + 1);   // 풀스크린이면 닫고 띄운다
    setCompletedSeq(seq);
    void reloadPlanProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === "settings") {
      setShowSettingsSheet(true);
      return;
    }
    // 말씀의삶은 별도 뷰다. 아래로 내려가면 setView("search") 가 먼저 걸려
    // 검색 뷰만 뜨고 target="plan" 은 SearchPanel 에서 조용히 무시된다.
    if (tab === "plan") {
      setView("plan");
      return;
    }
    // 목차·검색·책갈피로 나가면 플랜 모드를 푼다. 본문(read)은 유지한다.
    if (tab === "toc" || tab === "search" || tab === "bookmark") setPlanMode(null);
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

  // 운영자 미처리 신고 건수 — 설정 톱니 점 배지 + 설정 시트 링크 배지 (마운트 + 창 포커스 시 갱신)
  useEffect(() => {
    if (!adminMode) {
      setReportCount(0);
      return;
    }
    const load = () =>
      fetch("/api/admin/verse-notes")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setReportCount((d.items || []).length); })
        .catch(() => {});
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [adminMode]);

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
  // 말씀의삶 → 본문. 이 등록은 뒤로가기뿐 아니라 **키보드 격리**도 겸한다 —
  // SearchPanel 은 display:none 으로만 가려져 window keydown 리스너가 살아 있는데,
  // modalStack 이 2 가 되면 그쪽 가드(getActiveModalCount() > 1)에 걸려
  // 진도표를 보며 방향키를 눌러도 뒤에 숨은 본문의 장이 바뀌지 않는다.
  useHardwareBack(view === "plan", () => setView("search"));

  // 루트 종료 방지
  const exitingRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
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

  // 무확인 종료 차단 안전망 (beforeunload).
  // Chrome/Edge 는 trivial context(항목 1개) 또는 사용자 제스처 없는 pushState 를 강등/건너뛰어
  // history 기반 종료 트랩(위 isAppRoot/isHome, useHardwareBack)을 무력화한다 → 뒤로가기가
  // 확인 없이 앱을 이탈. 이 환경에서 유일하게 동작하는 차단막이 beforeunload(브라우저 기본
  // 확인창)다. length·제스처 감지가 불안정하므로 "튕기는 집단"(로그인 + 비-PWA 브라우저 탭)에
  // 조건 없이 무장한다. 의도된 이탈은 통과: 종료 버튼(exitingRef), 로그인 SSO 이동
  // (markIntentionalLeave). PWA standalone 은 intervention 비적용 + 새로고침/주소창 없음 → 면역.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isLoggedIn) return;
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (exitingRef.current || isIntentionalLeave()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isLoggedIn]);

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

  // 선택 모두 해제 / 되돌리기 — 절 선택 팝업의 '해제', 복사·메모/수정 저장·음원 다시 만들기 요청 뒤 자동 해제
  const handleClearSelection = useCallback(() => {
    setSelectedVerses([]);
    setIsAddingMore(false);
  }, []);
  const handleRestoreSelection = useCallback((verses: BibleVerse[]) => {
    setSelectedVerses(verses);
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
          onClearSelection={handleClearSelection}
          onRestoreSelection={handleRestoreSelection}
          isAddingMore={isAddingMore}
          bulkEditMode={bulkEditMode}
          onVerseUpdated={handleVerseUpdated}
          navRequest={navRequest}
          fullscreenRequestNonce={fullscreenRequestNonce}
          onOpenScrap={() => {
            if (ensureLogin("스크랩")) setShowScrap(true);
          }}
          scrapCount={scrapCount}
          onReadingViewChange={setIsReadingView}
          onPositionChange={handlePositionChange}
          planNav={view === "search" ? planNav : undefined}
          unitChapters={planUnitChapters}
          unitSeq={planMode?.seq}
          onUnitComplete={handleUnitComplete}
          fullscreenCloseNonce={fullscreenCloseNonce}
          tabBarHidden={tabBarHidden}
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
            markIntentionalLeave();
            window.location.href = LOGIN_URL;
          }}
          onLogout={async () => { await logout(); }}
          adminMode={adminMode}
          reportCount={reportCount}
          bulkEditMode={bulkEditMode}
          onToggleBulkEdit={() => setBulkEditMode((v) => !v)}
          onOpenHymn={() => setShowHymn(true)}
          onOpenWorship={() => setShowWorship(true)}
          onOpenCardBuilder={() => setShowCardBuilder(true)}
          canCreateCard={selectedVerses.length > 0}
          onOpenFullscreen={() => setFullscreenRequestNonce((n) => n + 1)}
          canOpenFullscreen={view === "search"}
          autoHideTabBar={autoHideTabBar}
          onAutoHideTabBarChange={changeAutoHideTabBar}
          onExit={() => setShowExitConfirm(true)}
        />
      )}

      {/* Phase 2a/2b — 하단 5탭 (목차/검색/읽기/책갈피/설정) */}
      {/* 말씀의삶 — 조건부 마운트.
          다른 뷰처럼 display:none 으로 두면 offsetTop 이 0 이라
          "지금 회차를 화면 상단 1/3 에" 스크롤이 동작하지 않는다.
          진입할 때마다 마운트되므로 진도도 매번 최신으로 다시 읽는다. */}
      {view === "plan" && (
        <ReadingPlanPanel
          onOpenUnit={openPlanUnit}
          onLogin={() => ensureLogin("말씀의삶")}
        />
      )}

      {/* 회차 완료 시트 — 풀스크린을 닫고 띄운다 */}
      {completedSeq !== null && (() => {
        const unit = YEBOM91.units[completedSeq - 1];
        const nextUnit = YEBOM91.units[completedSeq] ?? null;
        return (
          <UnitCompleteSheet
            seq={completedSeq}
            label={unit.label}
            totalChapters={unitChaptersOf(unit).length}
            next={nextUnit ? { seq: nextUnit.seq, label: nextUnit.label } : null}
            onOpenPlan={() => { setCompletedSeq(null); setView("plan"); }}
            onReadNext={() => {
              setCompletedSeq(null);
              if (nextUnit) openPlanUnit(nextUnit.seq);
            }}
            onClose={() => setCompletedSeq(null)}
          />
        );
      })()}

      {(view === "search" || view === "plan") && (
        <BottomTabBar
          active={activeTab}
          onTabChange={handleTabChange}
          bookmarkCount={bookmarkCount}
          settingsDot={reportCount > 0}
          hidden={tabBarHidden}
          onReveal={revealTabBar}
          onInteract={revealTabBar}
        />
      )}
    </main>
  );
}
