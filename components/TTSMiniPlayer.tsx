"use client";

/**
 * TTS 미니 플레이어 — 컨트롤: 재생/일시정지 · 속도 · 성우 · ✕.
 * 성우 선택은 한국어 AI TTS 일 때만 노출(속도 우측). 소진/장애 성우는 disable + 뱃지.
 * 자동다음장/절번호/영문 발음 등 나머지 설정은 설정 시트로 이관됨.
 * 기본 위치: 화면 우상단(읽기 버튼 근처). dockBottom=true(전체화면): footer 위 하단 중앙.
 * status === "idle" 이면 렌더하지 않음.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useTts,
  TTS_SPEEDS,
  KOREAN_VOICE_LABELS,
  KOREAN_VOICE_ORDER,
  koreanVoiceGender,
  koreanVoiceStatusFrom,
  type TtsSpeed,
  type KoreanVoice,
} from "@/contexts/TtsContext";
import { isEnglishVersion } from "@/lib/versions";

export default function TTSMiniPlayer({ dockBottom = false }: { dockBottom?: boolean }) {
  const tts = useTts();
  const [speedOpen, setSpeedOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isEng = useMemo(
    () => isEnglishVersion(tts.currentTrack?.version ?? ""),
    [tts.currentTrack?.version],
  );

  useEffect(() => {
    if (!speedOpen && !voiceOpen) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
        setVoiceOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [speedOpen, voiceOpen]);

  if (tts.status === "idle") return null;

  const isPlaying = tts.status === "speaking";
  const isLoading = tts.status === "loading";
  const isPaused = tts.status === "paused";
  // 녹음(사람) 음원·WebSpeech 폴백 시엔 성우 선택 무의미
  const isAudioMode = tts.engine === "real" || !!tts.currentTrack?.mp3Url;
  const showVoicePicker = !isEng && !isAudioMode && tts.engine !== "webspeech";

  const popoverPos = dockBottom ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="TTS 미니 플레이어"
      className={dockBottom ? "fixed left-1/2 -translate-x-1/2 z-50" : "fixed z-50"}
      style={
        dockBottom
          ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)" }
          : { top: "calc(env(safe-area-inset-top, 0px) + 10px)", right: "12px" }
      }
    >
      <div className="rounded-full border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 shadow-lg backdrop-blur px-2 py-1.5 flex items-center gap-1.5">
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
            <svg width="14" height="14" viewBox="0 0 16 16" className="animate-spin" aria-hidden>
              <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="2" fill="none" strokeDasharray="28" strokeDashoffset="8" />
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

        {/* 속도 */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setSpeedOpen((v) => !v);
              setVoiceOpen(false);
            }}
            aria-label="재생 속도 선택"
            aria-expanded={speedOpen}
            className="px-2.5 py-1.5 text-[12px] font-mono font-bold text-gray-700 dark:text-gray-200 rounded-md border border-gray-200 dark:border-gray-700 hover:text-[var(--amber)] hover:border-[var(--amber)] dark:hover:text-amber-400 dark:hover:border-amber-400 transition-colors"
          >
            {tts.speed === 1.0 ? "1x" : `${tts.speed}x`}
          </button>
          {speedOpen && (
            <div className={`absolute right-0 ${popoverPos} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[60px]`}>
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

        {/* 성우 선택 (한국어 AI TTS 일 때만) */}
        {showVoicePicker && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setVoiceOpen((v) => !v);
                setSpeedOpen(false);
              }}
              aria-label="성우 선택"
              aria-expanded={voiceOpen}
              className="px-2.5 py-1.5 text-[12px] font-bold text-gray-700 dark:text-gray-200 rounded-md border border-gray-200 dark:border-gray-700 hover:text-[var(--amber)] hover:border-[var(--amber)] dark:hover:text-amber-400 dark:hover:border-amber-400 transition-colors whitespace-nowrap"
            >
              {KOREAN_VOICE_LABELS[tts.koreanVoice]}
            </button>
            {voiceOpen && (
              <div className={`absolute right-0 ${popoverPos} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[132px] max-h-[60vh] overflow-y-auto`}>
                {KOREAN_VOICE_ORDER.map((kv, i) => {
                  const prev = KOREAN_VOICE_ORDER[i - 1];
                  const genderBreak = prev && koreanVoiceGender(prev) !== koreanVoiceGender(kv);
                  const gender = koreanVoiceGender(kv) === "male" ? "남" : "여";
                  const st = koreanVoiceStatusFrom(kv, tts.ttsHealth);
                  const selected = tts.koreanVoice === kv;
                  return (
                    <div key={kv}>
                      {genderBreak && <div className="my-1 border-t border-gray-100 dark:border-gray-700" />}
                      <button
                        type="button"
                        disabled={st.down}
                        onClick={() => {
                          if (st.down) return;
                          tts.setKoreanVoice(kv as KoreanVoice);
                          setVoiceOpen(false);
                        }}
                        className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-colors ${
                          st.down
                            ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                            : selected
                              ? "bg-[var(--amber)] text-white"
                              : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                      >
                        <span className="flex-1 text-left whitespace-nowrap">{KOREAN_VOICE_LABELS[kv]}</span>
                        <span className={`text-[9px] font-semibold px-1 rounded ${selected && !st.down ? "bg-white/25 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
                          {gender}
                        </span>
                        {st.down && (
                          <span className="text-[9px] font-semibold px-1 rounded bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
                            {st.reasonLabel}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 종료 */}
        <button
          type="button"
          onClick={() => tts.stop()}
          aria-label="듣기 종료"
          title="듣기 종료"
          className="shrink-0 w-7 h-7 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center justify-center"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
