"use client";

/**
 * 통합 설정 시트 — 리디자인 Phase 2b
 *
 * 흡수: 우상단 설정 아이콘(사용자 #5) + 우하단 도구함 FAB + 전체화면 버튼(사용자 #6)
 *
 * 섹션:
 *  1. 찬송가 (큰 카드 — 사용자 결정 R2: 하위 시트 없이 즉시 노출)
 *  2. 화면 설정 (밝게/어둡게 + 글자 크기 + 글꼴)
 *  3. 읽기 모드 (전체화면 1절씩 진입)
 *  4. 음성 (TTS — 미니플레이어와 동기 view-only)
 *  5. 도구 (예배성경 / 성경카드)
 *  6. 계정 (로그인·로그아웃 / 관리자 편집)
 *  7. 앱 정보 (버전 / 종료)
 */

import { useEffect, useRef, useState } from "react";
import { useFont, FONTS } from "@/contexts/FontContext";
import { useTts, KOREAN_VOICE_LABELS, KOREAN_VOICE_ORDER, koreanVoiceGender, koreanVoiceStatusFrom, type KoreanVoice } from "@/contexts/TtsContext";
import { triggerInstall, isStandaloneMode, isIOSDevice } from "@/lib/pwaInstall";

interface Props {
  onClose: () => void;
  // 계정
  userName?: string;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  // 관리자
  adminMode: boolean;
  reportCount?: number;
  bulkEditMode: boolean;
  onToggleBulkEdit: () => void;
  // 도구
  onOpenHymn: () => void;
  onOpenWorship: () => void;
  onOpenCardBuilder: () => void;
  canCreateCard: boolean;
  // 읽기 모드
  onOpenFullscreen: () => void;
  canOpenFullscreen: boolean;
  /** 본문 볼 때 하단 탭바 자동 숨김 */
  autoHideTabBar: boolean;
  onAutoHideTabBarChange: (on: boolean) => void;
  // 앱
  onExit: () => void;
}

export default function SettingsSheet({
  onClose,
  userName,
  isLoggedIn,
  onLogin,
  onLogout,
  adminMode,
  reportCount = 0,
  bulkEditMode,
  onToggleBulkEdit,
  onOpenHymn,
  onOpenWorship,
  onOpenCardBuilder,
  canCreateCard,
  onOpenFullscreen,
  canOpenFullscreen,
  autoHideTabBar,
  onAutoHideTabBarChange,
  onExit,
}: Props) {
  const { fontSize, setFontSize, fontKey, setFontKey, theme, setTheme } = useFont();
  const tts = useTts();
  const sheetRef = useRef<HTMLDivElement>(null);
  const currentFont = FONTS.find((f) => f.key === fontKey) ?? FONTS[0];

  // 한국어 성우 버튼 — 소진/장애 성우는 disable + 사유 뱃지
  const renderKoreanVoiceBtn = (kv: KoreanVoice) => {
    const st = koreanVoiceStatusFrom(kv, tts.ttsHealth);
    const selected = tts.koreanVoice === kv;
    return (
      <button
        key={kv}
        onClick={() => {
          if (!st.down) tts.setKoreanVoice(kv);
        }}
        disabled={st.down}
        aria-pressed={selected}
        className={`py-2 px-1 text-xs rounded-lg border transition-all text-center truncate ${
          st.down
            ? "bg-[var(--paper)] dark:bg-gray-800 border-[var(--line)] dark:border-gray-700 text-[var(--ink-faint)] dark:text-gray-600 cursor-not-allowed"
            : selected
              ? "bg-[var(--amber)] border-[var(--amber)] text-white shadow-sm"
              : "bg-[var(--paper)] dark:bg-gray-700 border-[var(--line)] dark:border-gray-600 text-[var(--ink)] dark:text-gray-200 hover:brightness-95"
        }`}
      >
        {KOREAN_VOICE_LABELS[kv]}
        {st.down && (
          <span className="ml-1 text-[9px] font-semibold text-red-500 dark:text-red-400">{st.reasonLabel}</span>
        )}
      </button>
    );
  };

  // Phase 3 — 그립 드래그로 시트 닫기 (dy > 80px)
  const dragStartRef = useRef<{ y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  // 시트 모드 — full(기본) / fontCompact(본문 보면서 글꼴 조정)
  const [sheetMode, setSheetMode] = useState<"full" | "fontCompact">("full");

  // ESC 키 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buildId =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_BUILD_ID || "dev"
      : "dev";

  // ── fontCompact 모드 — 본문 그대로 보면서 글꼴/크기 조정 (Kindle 패턴) ──
  if (sheetMode === "fontCompact") {
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-[120] bg-[var(--paper)] dark:bg-gray-900 border-t border-[var(--line)] dark:border-gray-700 shadow-2xl animate-[slideUp_0.22s_cubic-bezier(.2,.7,.2,1)]"
        role="dialog"
        aria-modal="true"
        aria-label="글꼴 조정"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <button
            onClick={() => setSheetMode("full")}
            className="inline-flex items-center gap-1 text-xs text-[var(--ink-soft)] dark:text-gray-400 hover:text-[var(--ink)] dark:hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            설정으로
          </button>
          <span className="text-xs font-semibold text-[var(--ink)] dark:text-gray-100">본문 미리보기 중</span>
          <button
            onClick={onClose}
            className="text-xs font-bold text-[var(--amber-deep)] dark:text-amber-400 px-2 py-0.5 rounded"
          >
            완료
          </button>
        </div>
        <div className="px-4 py-2 flex items-center gap-2">
          <button
            onClick={() => setFontSize(Math.max(16, fontSize - 2))}
            aria-label="글자 크기 줄이기"
            className="w-9 h-9 rounded-lg bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-600 flex items-center justify-center text-[var(--ink)] dark:text-gray-100 hover:brightness-95 active:scale-95"
          >
            A−
          </button>
          <span className="w-12 text-center text-xs font-mono text-[var(--ink-soft)] dark:text-gray-300">{fontSize}px</span>
          <button
            onClick={() => setFontSize(Math.min(60, fontSize + 2))}
            aria-label="글자 크기 키우기"
            className="w-9 h-9 rounded-lg bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-600 flex items-center justify-center text-[var(--ink)] dark:text-gray-100 hover:brightness-95 active:scale-95"
          >
            A+
          </button>
          <div className="flex-1 flex gap-1 overflow-x-auto scrollbar-hide">
            {FONTS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFontKey(f.key)}
                className={`shrink-0 px-2.5 py-1.5 text-xs rounded-lg border transition-all whitespace-nowrap ${
                  fontKey === f.key
                    ? "bg-[var(--amber)] border-[var(--amber)] text-white shadow-sm"
                    : "bg-white dark:bg-gray-800 border-[var(--line)] dark:border-gray-600 text-[var(--ink)] dark:text-gray-200 hover:brightness-95"
                }`}
                style={{ fontFamily: f.css, fontWeight: f.weight }}
                title={f.label}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/35 animate-[fadeIn_0.2s_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="설정"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 bg-[var(--paper)] dark:bg-gray-900 rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          maxHeight: "86vh",
          animation: dragOffset === 0 ? "slideUp 0.28s cubic-bezier(.2,.7,.2,1)" : undefined,
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragStartRef.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {/* 그립 + 헤더 — 그립 영역 드래그하여 닫기 */}
        <div
          className="pt-2 pb-1 flex flex-col items-center shrink-0 border-b border-[var(--line)] dark:border-gray-700 cursor-grab touch-pan-y"
          onPointerDown={(e) => {
            dragStartRef.current = { y: e.clientY };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const s = dragStartRef.current;
            if (!s) return;
            const dy = e.clientY - s.y;
            if (dy > 0) setDragOffset(dy);
          }}
          onPointerUp={() => {
            const s = dragStartRef.current;
            dragStartRef.current = null;
            if (s && dragOffset > 80) {
              onClose();
            }
            setDragOffset(0);
          }}
          onPointerCancel={() => {
            dragStartRef.current = null;
            setDragOffset(0);
          }}
        >
          <div className="w-[38px] h-1 bg-gray-300 dark:bg-gray-600 rounded-full" aria-hidden />
          <div className="w-full flex items-center justify-between px-5 py-2">
            <h2 className="text-base font-bold text-[var(--ink)] dark:text-gray-100">설정</h2>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label="닫기"
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1.5 -mr-1.5 rounded-full"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 본문 — 스크롤 */}
        <div className="overflow-y-auto p-4 space-y-5 flex-1">
          {/* 계정 — 최상단 (사용자 요청) */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">계정</div>
            {isLoggedIn ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--ink)] dark:text-gray-100 truncate">{userName ?? "사용자"}</span>
                  <button
                    onClick={() => {
                      onClose();
                      onLogout();
                    }}
                    className="text-[11px] text-[var(--ink-soft)] dark:text-gray-400 hover:text-[var(--ink)] px-2 py-1 rounded border border-[var(--line)] dark:border-gray-600"
                  >
                    로그아웃
                  </button>
                </div>
                {adminMode && (
                  <>
                  <button
                    onClick={onToggleBulkEdit}
                    className={`w-full mt-3 px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-between ${
                      bulkEditMode
                        ? "bg-[var(--amber-tint)] dark:bg-amber-950/30 text-[var(--amber-deep)] dark:text-amber-400 border-[var(--amber)]"
                        : "bg-white dark:bg-gray-800 text-[var(--ink-soft)] border-[var(--line)] dark:border-gray-600"
                    }`}
                  >
                    <span>관리자 편집 모드</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      bulkEditMode ? "bg-[var(--amber)] text-white" : "bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--ink-soft)]"
                    }`}>
                      {bulkEditMode ? "ON" : "OFF"}
                    </span>
                  </button>
                  <a
                    href="/admin/reports"
                    className="w-full mt-2 px-3 py-2 rounded-lg text-sm font-medium border bg-white dark:bg-gray-800 text-[var(--ink-soft)] border-[var(--line)] dark:border-gray-600 flex items-center justify-between hover:brightness-95"
                  >
                    <span>신고된 메모 관리</span>
                    <span className="flex items-center gap-1.5">
                      {reportCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {reportCount > 99 ? "99+" : reportCount}
                        </span>
                      )}
                      <span className="text-[var(--ink-faint)]">›</span>
                    </span>
                  </a>
                  <a
                    href="/admin/voice-studio"
                    className="w-full mt-2 px-3 py-2 rounded-lg text-sm font-medium border bg-white dark:bg-gray-800 text-[var(--ink-soft)] border-[var(--line)] dark:border-gray-600 flex items-center justify-between hover:brightness-95"
                  >
                    <span>음원 생성 PC 설치</span>
                    <span className="text-[var(--ink-faint)]">›</span>
                  </a>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  onClose();
                  onLogin();
                }}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 hover:brightness-95 transition-all"
              >
                <svg className="w-5 h-5 text-[var(--ink-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                <span className="text-sm font-semibold text-[var(--ink)] dark:text-gray-100">로그인</span>
              </button>
            )}
          </section>

          {/* 찬송가 (큰 카드) */}
          <section>
            <button
              onClick={() => {
                onClose();
                onOpenHymn();
              }}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-[var(--amber-tint)] dark:bg-amber-950/30 hover:brightness-95 transition-all"
            >
              <span className="w-11 h-11 rounded-xl bg-[var(--amber)] text-white flex items-center justify-center shadow-sm">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                </svg>
              </span>
              <span className="flex-1 text-left">
                <span className="block text-[15px] font-semibold text-[var(--ink)] dark:text-gray-100">찬송가</span>
                <span className="block text-xs text-[var(--ink-soft)] dark:text-gray-400">21세기 새찬송가 검색·재생</span>
              </span>
              <svg className="w-4 h-4 text-[var(--ink-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </section>

          {/* 2. 화면 설정 */}
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400">화면 설정</div>
              <button
                onClick={() => setSheetMode("fontCompact")}
                className="text-[11px] font-semibold text-[var(--amber-deep)] dark:text-amber-400 hover:underline inline-flex items-center gap-0.5"
                title="시트를 압축하고 본문 보면서 글꼴/크기 조정"
              >
                본문 보면서 조정
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
            {/* 미리보기 — 현재 설정 적용된 샘플 절 */}
            <div className="bg-[var(--paper)] dark:bg-gray-900 border border-[var(--line)] dark:border-gray-700 rounded-xl p-3 mb-3">
              <div className="text-[10px] text-[var(--ink-faint)] dark:text-gray-500 mb-1.5 tracking-wider uppercase">미리보기</div>
              <div
                className="text-[var(--ink)] dark:text-gray-100 leading-relaxed"
                style={{
                  fontSize: `${fontSize}px`,
                  fontFamily: currentFont.css,
                  fontWeight: currentFont.weight,
                  lineHeight: 1.5,
                }}
              >
                <span className="font-semibold text-[var(--amber)] mr-1.5 text-sm align-baseline">1</span>
                여호와는 나의 목자시니 내게 부족함이 없으리로다
              </div>
            </div>
            <div className="space-y-3">
              {/* 테마 — Phase 3 시스템 추종 옵션 추가 (사용자 Q5=B) */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700">
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-1.5">화면 테마</div>
                <div className="flex bg-[var(--paper-2)] dark:bg-gray-700 rounded-lg p-1">
                  <button
                    onClick={() => setTheme("light")}
                    aria-pressed={theme === "light"}
                    className={`flex-1 py-1.5 text-xs rounded-md transition-all font-medium ${
                      theme === "light"
                        ? "bg-white dark:bg-gray-800 text-[var(--ink)] dark:text-gray-100 shadow-sm"
                        : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                    }`}
                  >
                    밝게
                  </button>
                  <button
                    onClick={() => setTheme("dark")}
                    aria-pressed={theme === "dark"}
                    className={`flex-1 py-1.5 text-xs rounded-md transition-all font-medium ${
                      theme === "dark"
                        ? "bg-gray-800 text-white shadow-sm"
                        : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                    }`}
                  >
                    어둡게
                  </button>
                  <button
                    onClick={() => setTheme("system")}
                    aria-pressed={theme === "system"}
                    className={`flex-1 py-1.5 text-xs rounded-md transition-all font-medium ${
                      theme === "system"
                        ? "bg-[var(--amber)] text-white shadow-sm"
                        : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                    }`}
                  >
                    시스템
                  </button>
                </div>
              </div>
              {/* 글자 크기 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700">
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-1.5">글자 크기</div>
                <div className="flex items-center gap-3 bg-[var(--paper-2)] dark:bg-gray-700 p-1.5 rounded-lg">
                  <button
                    onClick={() => setFontSize(Math.max(16, fontSize - 2))}
                    aria-label="글자 크기 줄이기"
                    className="w-9 h-9 rounded-md bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-600 flex items-center justify-center text-[var(--ink)] dark:text-gray-100 hover:brightness-95 active:scale-95 transition-all"
                  >
                    A−
                  </button>
                  <div className="flex-1 text-center font-medium text-[var(--ink)] dark:text-gray-100 text-sm">{fontSize}px</div>
                  <button
                    onClick={() => setFontSize(Math.min(60, fontSize + 2))}
                    aria-label="글자 크기 키우기"
                    className="w-9 h-9 rounded-md bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-600 flex items-center justify-center text-[var(--ink)] dark:text-gray-100 hover:brightness-95 active:scale-95 transition-all"
                  >
                    A+
                  </button>
                </div>
              </div>
              {/* 글꼴 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700">
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-1.5">글꼴 종류</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {FONTS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFontKey(f.key)}
                      className={`py-2 px-2 text-sm rounded-lg border transition-all text-center ${
                        fontKey === f.key
                          ? "bg-[var(--amber)] border-[var(--amber)] text-white shadow-sm"
                          : "bg-[var(--paper)] dark:bg-gray-700 border-[var(--line)] dark:border-gray-600 text-[var(--ink)] dark:text-gray-200 hover:brightness-95"
                      }`}
                      style={{ fontFamily: f.css, fontWeight: f.weight }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* 본문 몰입 — 하단 메뉴 자동 숨김 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span>
                    <span className="block text-sm text-[var(--ink)] dark:text-gray-100">본문 볼 때 하단 메뉴 자동 숨김</span>
                    <span className="block text-[11px] text-[var(--ink-faint)] dark:text-gray-500 mt-0.5">화면 맨 아래를 살짝 누르면 다시 나옵니다</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={autoHideTabBar}
                    onChange={(e) => onAutoHideTabBarChange(e.target.checked)}
                    className="w-4 h-4 shrink-0"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* 음성 — 낭독 성우/발음 선택 (재생속도·재생/정지는 미니플레이어) */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">음성</div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700 space-y-4">
              {/* 한국어 낭독 성우 (8종) — 소진/장애 성우는 disable + 뱃지 */}
              <div>
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-2">한국어 낭독 성우</div>
                <div className="text-[10px] text-[var(--ink-faint)] dark:text-gray-500 mb-1">여성</div>
                <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                  {KOREAN_VOICE_ORDER.filter((kv) => koreanVoiceGender(kv) === "female").map(renderKoreanVoiceBtn)}
                </div>
                <div className="text-[10px] text-[var(--ink-faint)] dark:text-gray-500 mb-1">남성</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {KOREAN_VOICE_ORDER.filter((kv) => koreanVoiceGender(kv) === "male").map(renderKoreanVoiceBtn)}
                </div>
              </div>

              {/* 영문 낭독 — 성별 + 발음 */}
              <div>
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-1.5">영문 낭독</div>
                <div className="flex gap-2">
                  <div className="flex-1 flex bg-[var(--paper-2)] dark:bg-gray-700 rounded-lg p-1">
                    {(["male", "female"] as const).map((g) => (
                      <button
                        key={g}
                        onClick={() => tts.setVoice(g)}
                        aria-pressed={tts.voice === g}
                        className={`flex-1 py-1.5 text-xs rounded-md transition-all font-medium ${
                          tts.voice === g
                            ? "bg-[var(--amber)] text-white shadow-sm"
                            : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                        }`}
                      >
                        {g === "male" ? "남성" : "여성"}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 flex bg-[var(--paper-2)] dark:bg-gray-700 rounded-lg p-1">
                    {(["us", "gb"] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => tts.setEnglishAccent(a)}
                        aria-pressed={tts.englishAccent === a}
                        className={`flex-1 py-1.5 text-xs rounded-md transition-all font-medium ${
                          tts.englishAccent === a
                            ? "bg-[var(--amber)] text-white shadow-sm"
                            : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                        }`}
                      >
                        {a === "us" ? "미국식" : "영국식"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 재생 옵션 */}
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-sm text-[var(--ink)] dark:text-gray-100">자동 다음 장 진행</span>
                <input
                  type="checkbox"
                  checked={tts.autoNext}
                  onChange={(e) => tts.setAutoNext(e.target.checked)}
                  className="w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-sm text-[var(--ink)] dark:text-gray-100">절 번호 읽기</span>
                <input
                  type="checkbox"
                  checked={tts.readVerseNumber}
                  onChange={(e) => tts.setReadVerseNumber(e.target.checked)}
                  className="w-4 h-4"
                />
              </label>
            </div>
          </section>

          {/* 5. 도구 — 예배성경 / 성경카드 */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">도구</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  onClose();
                  onOpenWorship();
                }}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 hover:brightness-95"
              >
                <svg className="w-6 h-6 text-[var(--amber-deep)] dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                <span className="text-xs font-semibold text-[var(--ink)] dark:text-gray-100">예배성경</span>
              </button>
              <button
                onClick={() => {
                  if (!canCreateCard) return;
                  onClose();
                  onOpenCardBuilder();
                }}
                disabled={!canCreateCard}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 hover:brightness-95 ${
                  !canCreateCard ? "opacity-40 cursor-not-allowed" : ""
                }`}
              >
                <svg className="w-6 h-6 text-[var(--amber-deep)] dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
                </svg>
                <span className="text-xs font-semibold text-[var(--ink)] dark:text-gray-100">성경카드</span>
                {!canCreateCard && (
                  <span className="text-[9px] text-[var(--ink-faint)] dark:text-gray-500">절 선택 후 사용</span>
                )}
              </button>
            </div>
            {/* 앱으로 설치 — 자동 설치 팝업이 불규칙하므로 수동 설치 진입점 제공 */}
            <button
              onClick={async () => {
                if (isStandaloneMode()) {
                  window.alert("이미 앱으로 설치되어 실행 중입니다.");
                  return;
                }
                const r = await triggerInstall();
                if (r === "unavailable") {
                  if (isIOSDevice()) {
                    window.alert("iPhone/iPad: Safari 하단의 [공유] 버튼 → [홈 화면에 추가]를 눌러 설치하세요.");
                  } else {
                    window.alert(
                      "지금 바로 설치창을 열 수 없습니다.\n브라우저 메뉴(⋮)의 '앱 설치' 또는 '홈 화면에 추가'를 눌러 설치하세요.\n(페이지를 잠시 사용하면 설치 자격이 잡혀 자동 설치창이 뜨기도 합니다)",
                    );
                  }
                }
              }}
              className="w-full mt-2 flex items-center justify-center gap-2 p-3 rounded-xl bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 hover:brightness-95"
            >
              <svg className="w-5 h-5 text-[var(--amber-deep)] dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm font-semibold text-[var(--ink)] dark:text-gray-100">앱으로 설치</span>
            </button>
          </section>

          {/* 앱 정보 */}
          <section className="pb-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">앱 정보</div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-[var(--line)] dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-[var(--ink-soft)] dark:text-gray-400">빌드</span>
                <span className="text-xs font-mono text-[var(--ink)] dark:text-gray-200 truncate ml-2 max-w-[60%]">
                  {buildId.slice(0, 12)}
                </span>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onExit();
                }}
                className="w-full px-3 py-2.5 text-left text-sm text-[var(--bad)] hover:bg-[var(--bad-tint)] dark:hover:bg-red-950/20 border-t border-[var(--line)] dark:border-gray-700 transition-colors"
              >
                앱 종료
              </button>
            </div>
          </section>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { transform: translateY(102%); }
          to { transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
