"use client";

/**
 * TTS 미니 플레이어 — 컨트롤: 재생/일시정지 · 속도 · 성우 · ✕.
 * 성우 선택은 한국어일 때 노출(속도 우측) — 새번역은 AI 성우, 개역·통독은 생생·쾌활·성우(녹음).
 * 소진/장애 성우는 disable + 뱃지.
 * 자동다음장/절번호/영문 발음 등 나머지 설정은 설정 시트로 이관됨.
 * 기본 위치: 화면 우상단(읽기 버튼 근처). dockBottom=true(전체화면): footer 위 하단 중앙.
 * inline=true(본문 화면): 상단 바 아래 한 줄. 순서가 다르다 — 진행 · 속도 · 성우 · 재생/일시정지 · 접기.
 *   진행 막대가 붙고 ✕(종료) 자리가 접기(▾)가 된다 —
 *   본문 화면에서 읽기를 끝내는 길은 상단 정지 아이콘 하나뿐이다. 접어도 소리는 계속 난다.
 *   인라인이 떠 있는 동안 떠다니는 미니 플레이어는 스스로 물러난다(둘이 겹치지 않게).
 * status === "idle" 이면 렌더하지 않음.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useTts,
  TTS_SPEEDS,
  KOREAN_VOICE_LABELS,
  KOREAN_VOICE_ORDER,
  RECORDED_VOICE_LABELS,
  RECORDED_VOICE_ORDER,
  isRecordedKoreanVersion,
  koreanVoiceGender,
  koreanVoiceStatusFrom,
  type TtsSpeed,
} from "@/contexts/TtsContext";
import { isEnglishVersion } from "@/lib/versions";

/** 0:42 꼴 — 진행 시간은 장 통째 녹음일 때만 쓴다 */
function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TTSMiniPlayer({
  dockBottom = false,
  inline = false,
  onCollapse,
}: {
  dockBottom?: boolean;
  /** 본문 화면 상단 바 아래 한 줄 변형 */
  inline?: boolean;
  /** 인라인일 때 접기 버튼이 부를 함수 */
  onCollapse?: () => void;
}) {
  const tts = useTts();
  const [speedOpen, setSpeedOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 인라인이 떠 있으면 떠다니는 쪽은 물러난다
  const { registerInlinePlayer, subscribeAudio } = tts;
  useEffect(() => (inline ? registerInlinePlayer() : undefined), [inline, registerInlinePlayer]);

  // 진행도는 컨텍스트를 거치지 않는다 — 이 컴포넌트만 오디오를 구독해 다시 그린다(본문은 건드리지 않는다)
  // 그리기용 상태와 조작용 ref 를 함께 둔다 — 탐색은 엘리먼트를 직접 고치므로 상태로 만지면 안 된다
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  useEffect(
    () =>
      inline
        ? subscribeAudio((a) => {
            audioElRef.current = a;
            setAudioEl(a);
            if (!a) {
              // 절이 끝나 엘리먼트가 걷힌 순간 — 표시도 함께 0 으로(effect 안에서 상태를 만지지 않는다)
              setPos(0);
              setDur(0);
            }
          })
        : undefined,
    [inline, subscribeAudio],
  );
  useEffect(() => {
    if (!audioEl) return;
    const onTime = () => setPos(audioEl.currentTime || 0);
    const onMeta = () => setDur(Number.isFinite(audioEl.duration) ? audioEl.duration : 0);
    onTime();
    onMeta();
    audioEl.addEventListener("timeupdate", onTime);
    audioEl.addEventListener("loadedmetadata", onMeta);
    audioEl.addEventListener("durationchange", onMeta);
    return () => {
      audioEl.removeEventListener("timeupdate", onTime);
      audioEl.removeEventListener("loadedmetadata", onMeta);
      audioEl.removeEventListener("durationchange", onMeta);
    };
  }, [audioEl]);

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
  if (!inline && tts.inlinePlayerActive) return null;

  const isPlaying = tts.status === "speaking";
  const isLoading = tts.status === "loading";
  const isPaused = tts.status === "paused";
  // 개역·통독은 녹음 재생 중에도 성우를 고를 수 있다(성우 = 녹음, 생생·쾌활 = AI).
  // 그 밖(새번역 등)은 녹음(사람) 음원·WebSpeech 폴백 때 성우 선택이 무의미하다
  const isAudioMode = tts.engine === "real" || !!tts.currentTrack?.mp3Url;
  const recGroup = !isEng && isRecordedKoreanVersion(tts.currentTrack?.version ?? "");
  const showVoicePicker = !isEng && tts.engine !== "webspeech" && (recGroup || !isAudioMode);
  const voiceLabel = recGroup ? RECORDED_VOICE_LABELS[tts.recordedVoice] : KOREAN_VOICE_LABELS[tts.koreanVoice];
  const voiceOptions = recGroup
    ? RECORDED_VOICE_ORDER.map((rv) => ({
        key: rv,
        label: RECORDED_VOICE_LABELS[rv],
        badge: rv === "rec" ? "녹음" : rv.startsWith("m") ? "남" : "여",
        selected: tts.recordedVoice === rv,
        down: false,
        reasonLabel: "",
        pick: () => tts.setRecordedVoice(rv),
      }))
    : KOREAN_VOICE_ORDER.map((kv) => {
        const st = koreanVoiceStatusFrom(kv, tts.ttsHealth);
        return {
          key: kv,
          label: KOREAN_VOICE_LABELS[kv],
          badge: koreanVoiceGender(kv) === "male" ? "남" : "여",
          selected: tts.koreanVoice === kv,
          down: st.down,
          reasonLabel: st.reasonLabel,
          pick: () => tts.setKoreanVoice(kv),
        };
      });

  const popoverPos = dockBottom ? "bottom-full mb-2" : "top-full mt-2";

  // 장 통째 녹음(개역·통독)은 시간으로, 절 단위 낭독(새번역 등)은 절로 센다 — 단위가 다르다.
  // 절 모드에 시간을 보이면 '한 절 안의 시간'이라 엉뚱하다.
  const isChapterAudio = !!tts.currentTrack?.mp3Url;
  const verseNo = tts.currentTrack?.verse ?? 0;
  const progressPct = isChapterAudio
    ? dur > 0
      ? Math.min(100, (pos / dur) * 100)
      : 0
    : tts.queueLength > 0
      ? Math.min(100, ((tts.currentIndex + 1) / tts.queueLength) * 100)
      : 0;
  const seek = (e: React.MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    if (isChapterAudio) {
      const el = audioElRef.current;
      if (el && dur > 0) el.currentTime = ratio * dur;
    } else if (tts.queueLength > 0) {
      tts.jumpTo(Math.round(ratio * (tts.queueLength - 1)));
    }
  };

  /**
   * 재생/일시정지 버튼. 놓이는 자리가 다르다 —
   *  · 떠 있는 플레이어: 맨 왼쪽(여느 플레이어와 같은 관습)
   *  · 본문 인라인: **성우 칩 오른쪽**. 바로 위의 읽기·⋮ 와 같은 쪽에 모여 엄지 하나로 닿는다
   *    (2026-09-12 지휘부 지시 — 왼쪽에 홀로 있는 것이 어색하다)
   */
  const playPauseBtn = (
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
  );

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="TTS 미니 플레이어"
      className={
        inline
          ? "w-full mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 pt-1.5 pb-1"
          : dockBottom
            ? "fixed left-1/2 -translate-x-1/2 z-50"
            : "fixed z-50"
      }
      style={
        inline
          ? undefined
          : dockBottom
            ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)" }
            : { top: "calc(env(safe-area-inset-top, 0px) + 10px)", right: "12px" }
      }
    >
      <div
        className={
          inline
            ? "flex items-center gap-1.5"
            : "rounded-full border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 shadow-lg backdrop-blur px-2 py-1.5 flex items-center gap-1.5"
        }
      >
        {!inline && playPauseBtn}

        {inline && (
          <div className="min-w-0 flex-1 text-[13.5px] leading-tight font-semibold text-gray-900 dark:text-gray-100 tabular-nums whitespace-nowrap">
            {isChapterAudio ? (
              <>
                {mmss(pos)}
                <span className="mx-1 font-normal text-gray-400 dark:text-gray-500">/</span>
                <span className="font-medium text-gray-400 dark:text-gray-500">{mmss(dur)}</span>
              </>
            ) : verseNo > 0 ? (
              <>
                {verseNo}
                <span className="ml-0.5 font-medium text-gray-400 dark:text-gray-500">절</span>
              </>
            ) : (
              <span className="font-medium text-gray-400 dark:text-gray-500">시작</span>
            )}
          </div>
        )}

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
              {voiceLabel}
            </button>
            {voiceOpen && (
              <div className={`absolute right-0 ${popoverPos} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[132px] max-h-[60vh] overflow-y-auto`}>
                {voiceOptions.map((o, i) => {
                  const prev = voiceOptions[i - 1];
                  const groupBreak = prev && prev.badge !== o.badge;
                  const st = o;
                  const selected = o.selected;
                  const gender = o.badge;
                  return (
                    <div key={o.key}>
                      {groupBreak && <div className="my-1 border-t border-gray-100 dark:border-gray-700" />}
                      <button
                        type="button"
                        disabled={st.down}
                        onClick={() => {
                          if (st.down) return;
                          o.pick();
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
                        <span className="flex-1 text-left whitespace-nowrap">{o.label}</span>
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

        {inline && playPauseBtn}

        {inline ? (
          /* 줄만 접는다 — 소리는 계속 난다. 끝내는 것은 상단 정지 아이콘 하나뿐.
             재생 버튼과 붙어 있으면 잘못 누르므로 한 칸 띄우고 조금 작게 둔다 */
          <button
            type="button"
            onClick={onCollapse}
            aria-label="플레이어 접기"
            title="플레이어 접기"
            className="shrink-0 ml-1 w-7 h-7 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 5 L7 9 L11 5" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          /* 종료 */
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
        )}
      </div>

      {inline && (
        <button
          type="button"
          onClick={seek}
          aria-label={isChapterAudio ? "재생 위치 이동" : "절 이동"}
          className="mt-1 w-full h-3 flex items-center"
        >
          <span className="relative block w-full h-1 rounded-full bg-gray-200 dark:bg-gray-700">
            <span
              className="absolute left-0 top-0 bottom-0 rounded-full bg-[var(--amber)] transition-[width] duration-150"
              style={{ width: `${progressPct}%` }}
            />
          </span>
        </button>
      )}
    </div>
  );
}
