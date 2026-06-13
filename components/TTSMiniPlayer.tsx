"use client";

/**
 * TTS 미니 플레이어 — 재생 중에 화면 하단 고정.
 * 컨트롤: ▶/⏸ · 현재 ref + 진행 · 속도 팝오버 · 음성 토글 · ⋮ 더보기 · ✕
 * status === "idle" 이면 렌더하지 않음.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTts, TTS_SPEEDS, KOREAN_VOICE_LABELS, type TtsSpeed, type KoreanVoice } from "@/contexts/TtsContext";
import { isEnglishVersion } from "@/lib/versions";

export default function TTSMiniPlayer() {
  const tts = useTts();
  const isEng = useMemo(
    () => isEnglishVersion(tts.currentTrack?.version ?? ""),
    [tts.currentTrack?.version],
  );
  const [speedOpen, setSpeedOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!speedOpen && !moreOpen && !voiceOpen) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
        setMoreOpen(false);
        setVoiceOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [speedOpen, moreOpen, voiceOpen]);

  if (tts.status === "idle") return null;

  const isPlaying = tts.status === "speaking";
  const isLoading = tts.status === "loading";
  const isPaused = tts.status === "paused";
  const total = tts.queueLength;
  const idx = tts.currentIndex;
  const progress = total > 0 ? ((idx + 1) / total) * 100 : 0;
  const refLabel = tts.currentTrack?.ref ?? "";
  // 음원(사람 녹음) 모드 — 단일 성우 + 장 통째 1트랙 → voice 토글·절 번호 읽기 무의미
  const isAudioMode = tts.engine === "real" || !!tts.currentTrack?.mp3Url;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="TTS 미니 플레이어"
      className="fixed left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-2xl"
      style={{
        /* Phase 2a — BottomTabBar(약 60px) 위로 lift */
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)",
      }}
    >
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg backdrop-blur px-2.5 py-2 flex items-center gap-1.5">
        {/* 재생/일시정지 */}
        <button
          type="button"
          onClick={() => {
            if (isPlaying) tts.pause();
            else if (isPaused) tts.resume();
          }}
          disabled={isLoading}
          aria-label={isPlaying ? "일시정지" : isPaused ? "재생" : "준비 중"}
          className="shrink-0 w-9 h-9 rounded-full bg-[var(--amber)] text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform disabled:opacity-60"
        >
          {isLoading ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              className="animate-spin"
              aria-hidden
            >
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="white"
                strokeWidth="2"
                fill="none"
                strokeDasharray="28"
                strokeDashoffset="8"
              />
            </svg>
          ) : isPlaying ? (
            <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
              <rect x="0" y="0" width="4" height="14" rx="1" fill="white" />
              <rect x="8" y="0" width="4" height="14" rx="1" fill="white" />
            </svg>
          ) : (
            <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
              <polygon points="1,0 12,7 1,14" fill="white" />
            </svg>
          )}
        </button>

        {/* ref + progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">
              {refLabel || "—"}
            </span>
            {total > 0 && (
              <span className="text-[10px] text-gray-400 shrink-0">
                {idx + 1}/{total}
              </span>
            )}
          </div>
          <div className="mt-1 h-[3px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-[var(--amber)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 엔진 라벨 — 녹음/AI/Web 구별 (non-clickable). AI 합성은 로딩 중에도 "AI" 표시 */}
        {(() => {
          const isReal = isAudioMode; // 녹음 음원(mp3Url) — 그 외(ElevenLabs·Chirp·Neural2 등)는 AI
          const isWeb = tts.engine === "webspeech";
          const label = isReal ? "녹음" : isWeb ? "Web" : "AI";
          const bg = isReal
            ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
            : isWeb
              ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
          const border = tts.isWebSpeechFallback
            ? "border border-dashed border-amber-500 dark:border-amber-400"
            : "";
          return (
            <span
              className={`text-[9px] font-bold uppercase tracking-wider shrink-0 px-1 py-0.5 rounded ${bg} ${border}`}
              title={tts.engineVoice || (isReal ? "녹음 음원" : "AI 합성")}
            >
              {label}
            </span>
          );
        })()}

        {/* 속도 */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setSpeedOpen((v) => !v);
              setMoreOpen(false);
              setVoiceOpen(false);
            }}
            aria-label="재생 속도 선택"
            aria-expanded={speedOpen}
            className="px-3 py-1.5 text-[12px] font-mono font-bold text-gray-700 dark:text-gray-200 rounded-md border border-gray-200 dark:border-gray-700 hover:text-[var(--amber)] hover:border-[var(--amber)] dark:hover:text-amber-400 dark:hover:border-amber-400 transition-colors"
          >
            {tts.speed === 1.0 ? "1x" : `${tts.speed}x`}
          </button>
          {speedOpen && (
            <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[60px]">
              {TTS_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    tts.setSpeed(s as TtsSpeed);
                    setSpeedOpen(false);
                  }}
                  className={`block w-full text-center px-3 py-1.5 text-xs font-mono font-bold transition-colors ${
                    tts.speed === s
                      ? "bg-[var(--amber)] text-white"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {s === 1.0 ? "1x" : `${s}x`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 발음 토글 (single) — 영문 + AI 합성 시만. 탭 → 즉시 다른 발음으로 전환 */}
        {isEng && !isAudioMode && tts.engine !== "webspeech" && (
          <button
            type="button"
            onClick={() => tts.setEnglishAccent(tts.englishAccent === "us" ? "gb" : "us")}
            aria-label={`발음: ${tts.englishAccent === "us" ? "미국식" : "영국식"}, 전환`}
            title={`현재: ${tts.englishAccent === "us" ? "미국식 (en-US)" : "영국식 (en-GB)"} — 탭하여 전환`}
            className="shrink-0 px-3 py-1.5 text-[11px] font-bold text-[var(--amber-deep)] dark:text-amber-400 bg-[var(--amber-tint)] dark:bg-amber-950/30 rounded-md border border-[var(--amber)]/40 hover:bg-[var(--amber)]/15 active:scale-95 transition-all"
          >
            {tts.englishAccent === "us" ? "미국식" : "영국식"}
          </button>
        )}
        {/* 영문 음성(남/녀) 토글 — 영문 AI 합성 시만 */}
        {isEng && !isAudioMode && tts.engine !== "webspeech" && (
          <button
            type="button"
            onClick={() => tts.setVoice(tts.voice === "female" ? "male" : "female")}
            aria-label={`음성: ${tts.voice === "female" ? "여성" : "남성"}, 전환`}
            title={`현재: ${tts.voice === "female" ? "여성" : "남성"} — 탭하여 전환`}
            className="shrink-0 px-3 py-1.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 rounded-md border border-gray-200 dark:border-gray-700 hover:border-[var(--amber)] hover:text-[var(--amber)] dark:hover:text-amber-400 active:scale-95 transition-all"
          >
            {tts.voice === "female" ? "여" : "남"}
          </button>
        )}
        {/* 한국어 성우(4종) 선택 — 한국어 AI 합성 시만. 팝오버: 남성1·남성2·여성1·여성2 */}
        {!isEng && !isAudioMode && tts.engine !== "webspeech" && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setVoiceOpen((v) => !v);
                setSpeedOpen(false);
                setMoreOpen(false);
              }}
              aria-label="성우 선택"
              aria-expanded={voiceOpen}
              className="px-3 py-1.5 text-[11px] font-bold text-gray-700 dark:text-gray-200 rounded-md border border-gray-200 dark:border-gray-700 hover:text-[var(--amber)] hover:border-[var(--amber)] dark:hover:text-amber-400 dark:hover:border-amber-400 transition-colors"
            >
              {KOREAN_VOICE_LABELS[tts.koreanVoice]}
            </button>
            {voiceOpen && (
              <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[84px]">
                {(["m1", "m2", "f1", "f2"] as KoreanVoice[]).map((kv) => (
                  <button
                    key={kv}
                    type="button"
                    onClick={() => {
                      tts.setKoreanVoice(kv);
                      setVoiceOpen(false);
                    }}
                    className={`block w-full text-center px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
                      tts.koreanVoice === kv
                        ? "bg-[var(--amber)] text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    {KOREAN_VOICE_LABELS[kv]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 더보기 */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setMoreOpen((v) => !v);
              setSpeedOpen(false);
              setVoiceOpen(false);
            }}
            aria-label="설정"
            aria-expanded={moreOpen}
            className="w-7 h-7 rounded-full text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <circle cx="3" cy="7" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="11" cy="7" r="1.2" />
            </svg>
          </button>
          {moreOpen && (
            <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 min-w-[180px]">
              <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                <input
                  type="checkbox"
                  checked={tts.autoNext}
                  onChange={(e) => tts.setAutoNext(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span className="text-xs text-gray-700 dark:text-gray-200">
                  자동 다음 장
                </span>
              </label>
              {!isAudioMode && (
                <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                  <input
                    type="checkbox"
                    checked={tts.readVerseNumber}
                    onChange={(e) => tts.setReadVerseNumber(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-200">
                    절 번호 읽기
                  </span>
                </label>
              )}
              <button
                type="button"
                onClick={() => {
                  if (tts.queueLength > 0) tts.jumpTo(0);
                  setMoreOpen(false);
                }}
                className="block w-full text-left px-2 py-1.5 mt-1 text-xs text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700"
              >
                처음부터 다시 듣기
              </button>
              {tts.isWebSpeechFallback && (
                <p className="px-2 mt-1 text-[10px] text-amber-700 dark:text-amber-400 leading-tight">
                  Cloud TTS 실패 — 브라우저 기본 음성으로 재생 중
                </p>
              )}
            </div>
          )}
        </div>

        {/* 종료 */}
        <button
          type="button"
          onClick={() => tts.stop()}
          aria-label="듣기 종료"
          title="듣기 종료"
          className="shrink-0 w-7 h-7 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center justify-center"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M2 2 L10 10 M10 2 L2 10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
