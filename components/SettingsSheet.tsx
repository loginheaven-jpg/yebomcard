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

import { useEffect, useRef } from "react";
import { useFont, FONTS } from "@/contexts/FontContext";
import { useTts, TTS_SPEEDS, type TtsSpeed } from "@/contexts/TtsContext";

interface Props {
  onClose: () => void;
  // 계정
  userName?: string;
  isLoggedIn: boolean;
  onLogin: () => void;
  onLogout: () => void;
  // 관리자
  adminMode: boolean;
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
  bulkEditMode,
  onToggleBulkEdit,
  onOpenHymn,
  onOpenWorship,
  onOpenCardBuilder,
  canCreateCard,
  onOpenFullscreen,
  canOpenFullscreen,
  onExit,
}: Props) {
  const { fontSize, setFontSize, fontKey, setFontKey, theme, setTheme } = useFont();
  const tts = useTts();
  const sheetRef = useRef<HTMLDivElement>(null);

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
          animation: "slideUp 0.28s cubic-bezier(.2,.7,.2,1)",
        }}
      >
        {/* 그립 + 헤더 */}
        <div className="pt-2 pb-1 flex flex-col items-center shrink-0 border-b border-[var(--line)] dark:border-gray-700">
          <div className="w-[38px] h-1 bg-gray-300 dark:bg-gray-600 rounded-full" aria-hidden />
          <div className="w-full flex items-center justify-between px-5 py-2">
            <h2 className="text-base font-bold text-[var(--ink)] dark:text-gray-100">설정</h2>
            <button
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
          {/* 1. 찬송가 (큰 카드) */}
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
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">화면 설정</div>
            <div className="space-y-3">
              {/* 테마 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700">
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-1.5">화면 테마</div>
                <div className="flex bg-[var(--paper-2)] dark:bg-gray-700 rounded-lg p-1">
                  <button
                    onClick={() => setTheme("light")}
                    className={`flex-1 py-1.5 text-sm rounded-md transition-all font-medium ${
                      theme === "light"
                        ? "bg-white dark:bg-gray-800 text-[var(--ink)] dark:text-gray-100 shadow-sm"
                        : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                    }`}
                  >
                    밝게
                  </button>
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex-1 py-1.5 text-sm rounded-md transition-all font-medium ${
                      theme === "dark"
                        ? "bg-gray-800 text-white shadow-sm"
                        : "text-[var(--ink-soft)] dark:text-gray-400 hover:bg-white/50"
                    }`}
                  >
                    어둡게
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-[var(--ink-faint)] dark:text-gray-500">
                  시스템 추종은 Phase 3 에서 추가됩니다
                </p>
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
            </div>
          </section>

          {/* 3. 읽기 모드 */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">읽기 모드</div>
            <button
              onClick={() => {
                if (!canOpenFullscreen) return;
                onClose();
                onOpenFullscreen();
              }}
              disabled={!canOpenFullscreen}
              className={`w-full flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-gray-800 border border-[var(--line)] dark:border-gray-700 hover:brightness-95 transition-all ${
                !canOpenFullscreen ? "opacity-40 cursor-not-allowed" : ""
              }`}
            >
              <span className="w-9 h-9 rounded-lg bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--amber-deep)] dark:text-amber-400 flex items-center justify-center">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              </span>
              <span className="flex-1 text-left">
                <span className="block text-sm font-semibold text-[var(--ink)] dark:text-gray-100">전체화면 (1절씩 보기)</span>
                <span className="block text-[11px] text-[var(--ink-soft)] dark:text-gray-400">큰 글자로 한 절씩 — 빔프로젝터·집중 독서</span>
              </span>
              <svg className="w-4 h-4 text-[var(--ink-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            <p className="mt-1.5 px-1 text-[10px] text-[var(--ink-faint)] dark:text-gray-500">
              본문 영역을 길게 누르면 빠르게 진입할 수 있습니다 (Phase 3)
            </p>
          </section>

          {/* 4. 음성 — TTS 미니플레이어와 동기 */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-soft)] dark:text-gray-400 mb-2 px-1">음성</div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-[var(--line)] dark:border-gray-700 space-y-3">
              <div>
                <div className="text-xs text-[var(--ink-soft)] dark:text-gray-400 mb-1.5">재생 속도</div>
                <div className="grid grid-cols-5 gap-1">
                  {TTS_SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => tts.setSpeed(s as TtsSpeed)}
                      className={`py-1.5 text-[11px] font-mono font-bold rounded-md transition-colors ${
                        tts.speed === s
                          ? "bg-[var(--amber)] text-white"
                          : "bg-[var(--paper-2)] dark:bg-gray-700 text-[var(--ink-soft)] dark:text-gray-300 hover:brightness-95"
                      }`}
                    >
                      {s === 1.0 ? "1x" : `${s}x`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ink)] dark:text-gray-100">합성 음성</span>
                <button
                  onClick={() => tts.setVoice(tts.voice === "female" ? "male" : "female")}
                  className="px-3 py-1 text-xs font-bold rounded-full border border-[var(--line)] dark:border-gray-600 text-[var(--ink-soft)] dark:text-gray-200 hover:border-[var(--amber)] hover:text-[var(--amber)]"
                  title="녹음 음원 모드일 때는 무시됩니다"
                >
                  {tts.voice === "female" ? "여성" : "남성"}
                </button>
              </div>
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
          </section>

          {/* 6. 계정 */}
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

          {/* 7. 앱 정보 */}
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
