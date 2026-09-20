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
  YEBOM91_ID,
  flattenPlan,
  findPlanIndex,
  planStep,
  unitChapters as unitChaptersOf,
  computeUnitProgress,
  chapterEntryVerse,
  chapterSegments,
} from "@/lib/plans/yebom91";
import type { ReadingPlan } from "@/lib/plans/engine";
import { fetchReadChapters, computeProgress } from "@/lib/reading-progress";
import { fetchUnitChecks, loadPlanForClient } from "@/lib/reading-plan";
import { getBookByCode } from "@/lib/books";
import SettingsSheet from "@/components/SettingsSheet";
import { readBookmarks } from "@/lib/bookmark";
import { addScrapToServer, fetchMyScraps, migrateLocalScraps } from "@/lib/scrap";
import { supabase } from "@/lib/supabase";
import { useSession, LOGIN_URL } from "@/hooks/useSession";
import { useLoginGate } from "@/components/LoginGate";
import { isAdmin, isSuperAdmin } from "@/lib/admin";
import WorshipBible from "@/components/WorshipBible";
import HymnModal from "@/components/HymnModal";
import GlobalFontSettings from "@/components/GlobalFontSettings";
import { useHardwareBack, getActiveModalCount } from "@/hooks/useHardwareBack";
import { isIntentionalLeave, markIntentionalLeave } from "@/lib/appExit";
import { readPendingGroupCode } from "@/lib/auth/device-owner";
import type { BibleVerse, ViewMode, BibleVersion } from "@/lib/types";
import { useFont } from "@/contexts/FontContext";

const MAIN_VERSION_KEY = "yebom_main_version";
/** 지금 읽는 진도표를 기기에 기억한다(2026-09-20 — 그룹마다 다른 진도표) */
const PLAN_ID_KEY = "yebom_plan_id";
const SUB_VERSION_KEY = "yebom_sub_version";
const AUTOHIDE_TABBAR_KEY = "yebom_autohide_tabbar";
/** 본문에서 무조작 시 하단 탭바를 감추기까지의 시간 */
const TABBAR_HIDE_MS = 3000;

export default function Home() {
  const { session, isLoggedIn, logout, deviceReady } = useSession();
  const { ensureLogin } = useLoginGate();
  const adminMode = isAdmin(session);
  // 성경 질문 기록은 수퍼어드민만 본다(docs/BIBLE_QA_DOCTRINE.md §B-10).
  // 화면 판정은 표시 제어일 뿐 — 실제 차단은 API 안의 게이트다.
  const superAdmin = isSuperAdmin(session);
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
  // ⋮ 메뉴가 열려 있는 동안은 감추지 않는다 — ⋮ 을 누르면 탭바가 함께 올라와 '메뉴가 두 무리' 라는 것을
  // 보여 준다(2026-09-17 지휘부). 메뉴를 닫으면 다시 3초 뒤 감춘다.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuCloseNonce, setMoreMenuCloseNonce] = useState(0);
  const shouldAutoHideTabBar = autoHideTabBar && isReadingView && view === "search" && !moreMenuOpen;

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
  // 음원 생성에서 사람이 손봐야 할 것 — 응답 없는 PC · 오류로 선 작업 · 노는 PC · 쌓인 보류 절.
  // 며칠씩 도는 일이라 **아무도 안 보면 몇 시간이 그냥 간다**(2026-09-16: PC 한 대가 54분 침묵,
  // 다른 한 대가 39분간 0절). 앱을 열 때 저절로 눈에 띄게 한다.
  const [voiceAttention, setVoiceAttention] = useState(0);

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

  /**
   * 지금 읽는 진도표(2026-09-20 — 그룹마다 다른 진도표).
   * 기억한 것 → 없으면 표준진도표. 진도표 객체는 **id 마다 하나**여야 엔진의 파생 캐시가 산다(registry).
   */
  const [planId, setPlanId] = useState<string>(YEBOM91_ID);
  const [plan, setPlan] = useState<ReadingPlan>(YEBOM91);
  const [planMode, setPlanMode] = useState<{ planId: string; seq: number } | null>(null);
  /** deps 가 빈 콜백(handleUnitComplete)에서 최신 진도표를 읽기 위한 ref */
  const planIdRef = useRef<string>(YEBOM91_ID);
  const [planPos, setPlanPos] = useState<{ book: string; chapter: number } | null>(null);
  const [planReadByBook, setPlanReadByBook] = useState<Record<string, Set<number>>>({});
  const [planManual, setPlanManual] = useState<Set<number>>(new Set());
  const [completedSeq, setCompletedSeq] = useState<number | null>(null);
  const [fullscreenCloseNonce, setFullscreenCloseNonce] = useState(0);

  // 기기에 기억해 둔 진도표를 복원한다. 없거나 지워졌으면 표준진도표로 돌아간다.
  useEffect(() => {
    let alive = true;
    let saved = "";
    try {
      saved = localStorage.getItem(PLAN_ID_KEY) ?? "";
    } catch {}
    if (!saved || saved === YEBOM91_ID) return;
    (async () => {
      const loaded = await loadPlanForClient(saved);
      if (!alive) return;
      if (loaded) {
        setPlanId(loaded.id);
        setPlan(loaded);
      } else {
        // 지워진 진도표를 기억하고 있었다 — 표준진도표로 돌아가고 기억을 지운다.
        try { localStorage.removeItem(PLAN_ID_KEY); } catch {}
      }
    })();
    return () => { alive = false; };
  }, []);

  /** 진도표 바꾸기 — 패널의 고르기 창이 부른다 */
  const changePlan = useCallback(async (nextId: string) => {
    const loaded = await loadPlanForClient(nextId);
    if (!loaded) return;
    setPlanId(loaded.id);
    setPlan(loaded);
    // 옛 진도표의 회차 번호로 열려 있던 플랜 모드를 닫는다 — 그대로 두면 엉뚱한 장으로 이동한다.
    setPlanMode(null);
    setPlanPos(null);
    setCompletedSeq(null);
    try { localStorage.setItem(PLAN_ID_KEY, loaded.id); } catch {}
  }, []);

  /** seq 로 회차를 찾는다. **배열 인덱스로 찾지 않는다** — 회차 번호가 1부터 이어지지 않을 수 있다 */
  const unitBySeq = useMemo(() => new Map(plan.units.map((u) => [u.seq, u])), [plan]);
  const planFlat = useMemo(() => flattenPlan(plan), [plan]);
  useEffect(() => { planIdRef.current = planId; }, [planId]);
  const planIdx =
    planMode && planPos ? findPlanIndex(planFlat, planMode.seq, planPos.book, planPos.chapter) : -1;
  const planUnit = planMode ? unitBySeq.get(planMode.seq) ?? null : null;
  const planUnitChapters = useMemo(
    () => (planUnit ? unitChaptersOf(planUnit) : undefined),
    [planUnit],
  );

  // 진도 — 플랜 헤더의 "n / total장" 과 완료 시트에 쓴다
  const reloadPlanProgress = useCallback(async () => {
    const [read, seqs] = await Promise.all([fetchReadChapters(), fetchUnitChecks(planId)]);
    setPlanReadByBook(computeProgress(read).readByBook);
    setPlanManual(new Set(seqs));
    // 체크는 진도표마다 따로 쌓인다 — planId 를 빠뜨리면 다른 진도표의 체크를 읽는다.
  }, [planId]);
  useEffect(() => {
    if (planMode) void reloadPlanProgress();
  }, [planMode, reloadPlanProgress]);

  /** 회차로 진입 — entryChapter 로 간다 */
  const openPlanUnit = useCallback(
    (seq: number) => {
      const progress = computeUnitProgress(plan, planReadByBook, planManual);
      const unit = unitBySeq.get(seq);
      if (!unit) return;
      const chs = unitChaptersOf(unit);
      if (chs.length === 0) return;
      // 그 회차가 currentSeq 면 entryChapter 를, 아니면 회차 첫 장을 쓴다
      const target =
        progress.entryChapter && progress.entryChapter.seq === seq
          ? { book: progress.entryChapter.book, chapter: progress.entryChapter.chapter }
          : { book: chs[0].book, chapter: chs[0].chapter };
      setPlanMode({ planId, seq });
      setPlanPos(target);
      setView("search");
      setActiveTab("bible");
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
    [plan, planId, unitBySeq, planReadByBook, planManual],
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
            verse: chapterEntryVerse(unitBySeq.get(prev.seq)!, prev.book, prev.chapter),
            segments: chapterSegments(unitBySeq.get(prev.seq)!, prev.book, prev.chapter),
          }
        : null,
      next: next
        ? {
            book: next.book,
            chapter: next.chapter,
            seq: next.seq,
            verse: chapterEntryVerse(unitBySeq.get(next.seq)!, next.book, next.chapter),
            // 자동 다음 장 낭독이 도착 장의 순서를 그대로 따르게 한다
            segments: chapterSegments(unitBySeq.get(next.seq)!, next.book, next.chapter),
          }
        : null,
      // 지금 보고 있는 장을 이 회차가 어떤 순서로 읽는가 — 낭독이 이 순서를 따른다
      segments: chapterSegments(planUnit, planPos?.book ?? "", planPos?.chapter ?? 0),
      onGo: (t: { book: string; chapter: number; seq?: number; verse?: number }) => {
        // 도착 항목의 seq 로 갱신한다(인접 중복 장은 planStep 이 이미 건너뛴다)
        if (t.seq) setPlanMode({ planId, seq: t.seq });
        goPlan(t);
      },
    };
  }, [planMode, planUnit, planIdx, planFlat, planUnitChapters, planReadByBook, planPos, session, openPlanUnit, goPlan, planId, unitBySeq]);

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
    // 기억은 진도표마다 따로 — 진도표를 바꾸면 그 진도표의 1회차 시트가 처음처럼 뜬다.
    if (wasUnitSheetShown(planIdRef.current, seq)) return;
    setFullscreenCloseNonce((n) => n + 1);   // 풀스크린이면 닫고 띄운다
    setCompletedSeq(seq);
    void reloadPlanProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    // ⋮ 메뉴가 열린 채 탭을 눌렀으면 메뉴는 닫는다(탭바가 메뉴 위로 올라와 있어 바로 눌린다)
    setMoreMenuCloseNonce((n) => n + 1);
    if (tab === "settings") {
      setShowSettingsSheet(true);
      return;
    }
    // 찬송가는 화면이 아니라 창이다 — 보고 있던 화면 위에 열고, 닫으면 그 화면으로 돌아온다.
    if (tab === "hymn") {
      setShowHymn(true);
      return;
    }
    // 말씀의삶 — 2026-09-17 탭으로 돌아왔다(9-12 부터는 ⋮ 안에만 있었다)
    if (tab === "plan") {
      setCompletedSeq(null);
      setView("plan");
      return;
    }
    // 성경 = 옛 '목차' + '본문'. 읽는 중에 누르면 목차, 그 밖에서는 마지막 읽던 곳(없으면 SearchPanel 이 목차로).
    // 목차로 나가면 플랜 모드를 푼다(옛 목차 탭과 같다). 본문으로 가는 것은 유지한다.
    let target: "toc" | "search" | "read" | "bookmark";
    if (tab === "bible") target = view === "search" && isReadingView ? "toc" : "read";
    else target = tab;
    if (target === "toc" || target === "search" || target === "bookmark") setPlanMode(null);
    setView("search");
    navNonceRef.current += 1;
    setNavRequest({ target, nonce: navNonceRef.current });
  }, [view, isReadingView]);

  // ─── 말씀의삶 초대링크 — https://bible.yebom.org/?join=코드 ───
  // 링크를 누르면 말씀의삶을 열고 참여를 맡긴다(ReadingPlanPanel). 로그인돼 있으면 곧바로 참여,
  // 아니면 '로그인하고 참여' 한 번 — 로그인 직전에 코드를 기기에 적어 두고(30분), 돌아오면 아래 effect 가 다시 연다.
  // 코드는 URL 에서 곧바로 지운다 — 새로고침·뒤로가기로 두 번 처리하지 않게.
  // **코드를 여기서 기기에 적지 않는다**: 세션 확인이 401(비로그인)이면 SessionContext 가 적어 둔 코드를 지운다.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("join");
    if (raw === null) return;
    window.history.replaceState(window.history.state, "", "/");
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length !== 6) return;
    setInviteCode(code);
    setActiveTab("plan");
    setView("plan");
  }, []);

  // 로그인하러 갔다 돌아왔는데 참여할 코드가 남아 있으면(초대링크·코드 입력 창) 말씀의삶을 연다 —
  // 전에는 교인이 말씀의삶을 다시 찾아 들어가야 참여됐다
  useEffect(() => {
    if (!isLoggedIn || !deviceReady) return;
    if (!readPendingGroupCode()) return;
    setActiveTab("plan");
    setView("plan");
  }, [isLoggedIn, deviceReady]);

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

  // 음원 생성 — 손봐야 할 것 (설정 시트 배지). 관리자만, 마운트 + 창 포커스 시.
  useEffect(() => {
    if (!adminMode) {
      setVoiceAttention(0);
      return;
    }
    const load = () =>
      fetch("/api/voice-studio/fleet")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.attention) setVoiceAttention(d.attention.count || 0); })
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
  // 이관은 기기 주인 판정이 끝난 뒤에만 — 앞 사람이 비로그인으로 남긴 스크랩을 이 계정으로 올리지 않는다
  useEffect(() => {
    if (!isLoggedIn || !deviceReady) return;
    (async () => {
      await migrateLocalScraps();
      const scraps = await fetchMyScraps();
      setScrapCount(scraps.length);
    })();
  }, [isLoggedIn, deviceReady]);

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
          // 본문 상단 ⋮ 메뉴 — 예배성경 · 로그인은 읽는 중에 손 닿는 곳에 둔다
          onOpenWorship={() => setShowWorship(true)}
          onMoreMenuChange={setMoreMenuOpen}
          moreMenuCloseNonce={moreMenuCloseNonce}
          onLogin={() => {
            markIntentionalLeave();
            window.location.href = LOGIN_URL;
          }}
          onLogout={async () => { await logout(); }}
          onPositionChange={handlePositionChange}
          planNav={view === "search" ? planNav : undefined}
          unitChapters={planUnitChapters}
          unitSeq={planMode?.seq}
          onUnitComplete={handleUnitComplete}
          fullscreenCloseNonce={fullscreenCloseNonce}
          tabBarHidden={tabBarHidden}
          isActiveView={view === "search"}
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
          superAdmin={superAdmin}
          reportCount={reportCount}
          voiceAttention={voiceAttention}
          bulkEditMode={bulkEditMode}
          onToggleBulkEdit={() => setBulkEditMode((v) => !v)}
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
          plan={plan}
          onPlanChange={(id) => void changePlan(id)}
          onOpenUnit={openPlanUnit}
          onLogin={() => ensureLogin("말씀의삶")}
          inviteCode={inviteCode}
          onInviteHandled={() => setInviteCode(null)}
          onLoginNow={() => {
            markIntentionalLeave();
            window.location.href = LOGIN_URL;
          }}
        />
      )}

      {/* 회차 완료 시트 — 풀스크린을 닫고 띄운다 */}
      {completedSeq !== null && (() => {
        const unit = unitBySeq.get(completedSeq);
        if (!unit) return null;
        // '다음 회차' 는 배열 인덱스가 아니라 **순서상 다음 항목**이다(회차 번호가 이어지지 않을 수 있다).
        const at = plan.units.findIndex((u) => u.seq === completedSeq);
        const nextUnit = at >= 0 ? plan.units[at + 1] ?? null : null;
        return (
          <UnitCompleteSheet
            planId={planId}
            seq={completedSeq}
            label={unit.label}
            totalChapters={unitChaptersOf(unit).length}
            totalUnits={plan.units.length}
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
          // 말씀의삶은 탭 말고도 들어오는 길이 있다(플랜 헤더·완료 시트·초대링크) — 화면을 보고 정한다
          active={view === "plan" ? "plan" : activeTab === "plan" ? "bible" : activeTab}
          onTabChange={handleTabChange}
          raised={moreMenuOpen && view === "search"}
          bookmarkCount={bookmarkCount}
          settingsDot={reportCount > 0 || voiceAttention > 0}
          hidden={tabBarHidden}
          onReveal={revealTabBar}
          onInteract={revealTabBar}
        />
      )}
    </main>
  );
}
