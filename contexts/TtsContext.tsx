"use client";

/**
 * TTS 컨텍스트 — 절 단위 순차 재생, 절별 IndexedDB 캐시, Cloud → Web Speech 폴백.
 *
 * 호출 흐름:
 *   start({ tracks, startIndex, loadNextChapter? })
 *     → playIndex(0)
 *        → 캐시 hit: blob URL → <audio>.play()
 *        → 캐시 miss: /api/tts → blob → IndexedDB put → blob URL → play
 *        → cloud fetch 실패: WebSpeechController.speak (폴백)
 *     → onended → playIndex(i+1)
 *     → 큐 종료 + autoNext: loadNextChapter() → 새 큐 start
 *
 * 설정(voice/speed/autoNext/readVerseNumber)은 localStorage 영속.
 * 설정 변경은 "다음 절부터 적용" (현재 재생 중인 절은 끝까지).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchCloudTtsAudio,
  type TTSVoice,
} from "@/lib/tts/cloudTtsClient";
import {
  getCachedAudio,
  putCachedAudio,
  makeCacheKey,
} from "@/lib/tts/ttsCache";
import {
  WebSpeechController,
  isWebSpeechSupported,
} from "@/lib/tts/webSpeechClient";

export type TtsStatus = "idle" | "loading" | "speaking" | "paused";
export type TtsSpeed = 0.85 | 1.0 | 1.2 | 1.5;
export const TTS_SPEEDS: TtsSpeed[] = [0.85, 1.0, 1.2, 1.5];

export interface TtsTrack {
  text: string;
  /** 화면 표시용 ref (예: "시 121:5") */
  ref: string;
  /** 캐시·식별용 */
  version: string;
  bookCode: string;
  bookName: string;
  chapter: number;
  /** 절 번호. 0 = 장 시작 announcement (예: "예레미야 33장"). 절은 1부터 시작. */
  verse: number;
}

/** 큐 앞·중간(장 경계)에 "책명 N장" announcement 트랙 삽입 */
function injectChapterAnnouncements(tracks: TtsTrack[]): TtsTrack[] {
  if (tracks.length === 0) return tracks;
  const out: TtsTrack[] = [];
  let prevKey = "";
  for (const t of tracks) {
    if (t.verse === 0) {
      out.push(t);
      prevKey = `${t.bookCode}-${t.chapter}`;
      continue;
    }
    const key = `${t.bookCode}-${t.chapter}`;
    if (key !== prevKey) {
      out.push({
        text: `${t.bookName} ${t.chapter}장`,
        ref: `${t.bookName} ${t.chapter}장`,
        version: t.version,
        bookCode: t.bookCode,
        bookName: t.bookName,
        chapter: t.chapter,
        verse: 0,
      });
      prevKey = key;
    }
    out.push(t);
  }
  return out;
}

export type LoadNextChapterFn = () => Promise<TtsTrack[] | null>;

interface StartParams {
  tracks: TtsTrack[];
  startIndex?: number;
  loadNextChapter?: LoadNextChapterFn;
}

/** 현재 재생 중인 음원의 엔진 식별 */
export type TtsEngine = "chirp" | "neural2" | "wavenet" | "webspeech" | "unknown";

interface TtsContextValue {
  status: TtsStatus;
  currentIndex: number;
  currentTrack: TtsTrack | null;
  queueLength: number;
  voice: TTSVoice;
  speed: TtsSpeed;
  autoNext: boolean;
  readVerseNumber: boolean;
  isWebSpeechFallback: boolean;
  /** 마지막으로 재생된 트랙의 엔진 (UI 표시용) */
  engine: TtsEngine;
  /** 서버가 실제 사용한 voice 이름 (예: ko-KR-Chirp3-HD-Aoede) */
  engineVoice: string;
  start: (p: StartParams) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  jumpTo: (index: number) => void;
  setVoice: (v: TTSVoice) => void;
  setSpeed: (s: TtsSpeed) => void;
  setAutoNext: (b: boolean) => void;
  setReadVerseNumber: (b: boolean) => void;
}

function classifyEngine(voiceName: string): TtsEngine {
  if (!voiceName) return "unknown";
  if (voiceName.includes("Chirp")) return "chirp";
  if (voiceName.includes("Neural2")) return "neural2";
  if (voiceName.includes("Wavenet")) return "wavenet";
  return "unknown";
}

const Ctx = createContext<TtsContextValue | null>(null);

const LS = {
  voice: "yebom_tts_voice",
  speed: "yebom_tts_speed",
  autoNext: "yebom_tts_auto_next",
  readVerseNumber: "yebom_tts_read_verse_number",
} as const;

function readStorage<T>(key: string, fallback: T, parse: (s: string) => T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function TtsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [queueLength, setQueueLength] = useState(0);
  const [voice, setVoiceState] = useState<TTSVoice>("female");
  const [speed, setSpeedState] = useState<TtsSpeed>(1.0);
  const [autoNext, setAutoNextState] = useState(true);
  const [readVerseNumber, setReadVerseNumberState] = useState(false);
  const [isWebSpeechFallback, setIsWebSpeechFallback] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<TtsTrack | null>(null);
  const [engine, setEngine] = useState<TtsEngine>("unknown");
  const [engineVoice, setEngineVoice] = useState("");

  const queueRef = useRef<TtsTrack[]>([]);
  const indexRef = useRef(-1);
  const statusRef = useRef<TtsStatus>("idle");
  const voiceRef = useRef<TTSVoice>("female");
  const speedRef = useRef<TtsSpeed>(1.0);
  const autoNextRef = useRef(true);
  const readVerseNumberRef = useRef(false);
  const loadNextChapterRef = useRef<LoadNextChapterFn | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const webSpeechRef = useRef<WebSpeechController | null>(null);
  const playGenRef = useRef(0);
  const playIndexRef = useRef<(i: number) => void>(() => {});

  useEffect(() => {
    // localStorage 초기 복원 — SSR 시 default → mount 후 보정 (hydration mismatch 회피)
    setVoiceState(
      readStorage<TTSVoice>(LS.voice, "female", (s) =>
        s === "male" ? "male" : "female",
      ),
    );
    setSpeedState(
      readStorage<TtsSpeed>(LS.speed, 1.0, (s) => {
        const n = parseFloat(s);
        return (TTS_SPEEDS as number[]).includes(n) ? (n as TtsSpeed) : 1.0;
      }),
    );
    setAutoNextState(readStorage<boolean>(LS.autoNext, true, (s) => s === "1"));
    setReadVerseNumberState(
      readStorage<boolean>(LS.readVerseNumber, false, (s) => s === "1"),
    );
  }, []);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    autoNextRef.current = autoNext;
  }, [autoNext]);
  useEffect(() => {
    readVerseNumberRef.current = readVerseNumber;
  }, [readVerseNumber]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    webSpeechRef.current?.stop();
  }, []);

  const setVoice = useCallback((v: TTSVoice) => {
    setVoiceState(v);
    writeStorage(LS.voice, v);
  }, []);
  const setSpeed = useCallback((s: TtsSpeed) => {
    setSpeedState(s);
    writeStorage(LS.speed, String(s));
  }, []);
  const setAutoNext = useCallback((b: boolean) => {
    setAutoNextState(b);
    writeStorage(LS.autoNext, b ? "1" : "0");
  }, []);
  const setReadVerseNumber = useCallback((b: boolean) => {
    setReadVerseNumberState(b);
    writeStorage(LS.readVerseNumber, b ? "1" : "0");
  }, []);

  const playIndex = useCallback(
    async (idx: number) => {
      const gen = ++playGenRef.current;
      const tracks = queueRef.current;
      if (idx < 0 || idx >= tracks.length) {
        if (autoNextRef.current && loadNextChapterRef.current) {
          const nextLoader = loadNextChapterRef.current;
          setStatus("loading");
          statusRef.current = "loading";
          try {
            const nextTracks = await nextLoader();
            if (playGenRef.current !== gen) return;
            if (nextTracks && nextTracks.length > 0) {
              const augmented = injectChapterAnnouncements(nextTracks);
              queueRef.current = augmented;
              setQueueLength(augmented.length);
              indexRef.current = -1;
              playIndexRef.current(0);
              return;
            }
          } catch {
            /* 다음 장 로드 실패: 정지 */
          }
        }
        cleanupAudio();
        setStatus("idle");
        statusRef.current = "idle";
        setCurrentIndex(-1);
        setCurrentTrack(null);
        indexRef.current = -1;
        return;
      }

      indexRef.current = idx;
      const track = tracks[idx];
      setCurrentIndex(idx);
      setCurrentTrack(track);
      setStatus("loading");
      statusRef.current = "loading";

      cleanupAudio();

      const v = voiceRef.current;
      const sp = speedRef.current;
      const cacheKey = makeCacheKey({
        version: track.version,
        bookCode: track.bookCode,
        chapter: track.chapter,
        verse: track.verse,
        voice: v,
        speed: sp,
      });

      const isAnnouncement = track.verse === 0;
      const playableText =
        !isAnnouncement && readVerseNumberRef.current
          ? `${track.verse}절. ${track.text}`
          : track.text;

      let blob: Blob | null = null;
      let resolvedVoice = "";
      try {
        const cached = await getCachedAudio(cacheKey);
        if (cached) {
          blob = cached.blob;
          resolvedVoice = cached.voiceUsed;
        }
      } catch {
        blob = null;
      }
      if (playGenRef.current !== gen) return;

      if (!blob) {
        try {
          const ctrl = new AbortController();
          abortRef.current = ctrl;
          const result = await fetchCloudTtsAudio({
            text: playableText,
            voice: v,
            speed: sp,
            signal: ctrl.signal,
          });
          if (playGenRef.current !== gen) return;
          blob = result.blob;
          resolvedVoice = result.voiceUsed;
          void putCachedAudio(cacheKey, blob, resolvedVoice);
        } catch (err) {
          if (playGenRef.current !== gen) return;
          console.warn(
            `[TTS] Cloud fetch 실패 → Web Speech 폴백 (track: ${track.bookName} ${track.chapter}:${track.verse}, voice: ${v})`,
            err,
          );
          if (isWebSpeechSupported()) {
            setIsWebSpeechFallback(true);
            setEngine("webspeech");
            setEngineVoice("Web Speech");
            if (!webSpeechRef.current) {
              webSpeechRef.current = new WebSpeechController();
            }
            setStatus("speaking");
            statusRef.current = "speaking";
            webSpeechRef.current.speak({
              text: playableText,
              voice: v,
              speed: sp,
              onEnd: () => {
                if (playGenRef.current !== gen) return;
                if (statusRef.current !== "speaking") return;
                playIndexRef.current(indexRef.current + 1);
              },
              onError: () => {
                if (playGenRef.current !== gen) return;
                cleanupAudio();
                setStatus("idle");
                statusRef.current = "idle";
              },
            });
            return;
          }
          cleanupAudio();
          setStatus("idle");
          statusRef.current = "idle";
          return;
        }
      }

      setEngine(classifyEngine(resolvedVoice));
      setEngineVoice(resolvedVoice);

      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (playGenRef.current !== gen) return;
        if (statusRef.current !== "speaking") return;
        playIndexRef.current(indexRef.current + 1);
      };
      audio.onerror = () => {
        if (playGenRef.current !== gen) return;
        cleanupAudio();
        setStatus("idle");
        statusRef.current = "idle";
      };
      try {
        await audio.play();
        if (playGenRef.current !== gen) return;
        setStatus("speaking");
        statusRef.current = "speaking";
      } catch {
        if (playGenRef.current !== gen) return;
        cleanupAudio();
        setStatus("idle");
        statusRef.current = "idle";
      }
    },
    [cleanupAudio],
  );

  useEffect(() => {
    playIndexRef.current = playIndex;
  }, [playIndex]);

  const start = useCallback(
    (p: StartParams) => {
      if (!p.tracks || p.tracks.length === 0) return;
      const augmented = injectChapterAnnouncements(p.tracks);
      queueRef.current = augmented;
      setQueueLength(augmented.length);
      loadNextChapterRef.current = p.loadNextChapter ?? null;
      setIsWebSpeechFallback(false);

      // startIndex 매핑: 0/미지정 → announcement 부터(index 0).
      // 0보다 크면 원본 인덱스의 절을 augmented 큐에서 찾아 그 위치부터 재생 (announcement 스킵).
      let startIdx = 0;
      if (p.startIndex && p.startIndex > 0) {
        const target = p.tracks[Math.min(p.startIndex, p.tracks.length - 1)];
        const found = augmented.findIndex(
          (t) =>
            t.bookCode === target.bookCode &&
            t.chapter === target.chapter &&
            t.verse === target.verse,
        );
        startIdx = found >= 0 ? found : 0;
      }
      playIndex(startIdx);
    },
    [playIndex],
  );

  const stop = useCallback(() => {
    playGenRef.current++;
    cleanupAudio();
    queueRef.current = [];
    indexRef.current = -1;
    loadNextChapterRef.current = null;
    setQueueLength(0);
    setStatus("idle");
    statusRef.current = "idle";
    setCurrentIndex(-1);
    setCurrentTrack(null);
  }, [cleanupAudio]);

  const pause = useCallback(() => {
    if (statusRef.current !== "speaking") return;
    if (audioRef.current) {
      audioRef.current.pause();
    } else {
      webSpeechRef.current?.pause();
    }
    setStatus("paused");
    statusRef.current = "paused";
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    } else {
      webSpeechRef.current?.resume();
    }
    setStatus("speaking");
    statusRef.current = "speaking";
  }, []);

  const jumpTo = useCallback(
    (idx: number) => {
      const len = queueRef.current.length;
      if (idx < 0 || idx >= len) return;
      playIndex(idx);
    },
    [playIndex],
  );

  useEffect(() => {
    return () => {
      // 언마운트 시 진행 중인 fetch/audio 모두 abort. ref 쓰기만 하므로 안전.
      playGenRef.current++;
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<TtsContextValue>(
    () => ({
      status,
      currentIndex,
      currentTrack,
      queueLength,
      voice,
      speed,
      autoNext,
      readVerseNumber,
      isWebSpeechFallback,
      engine,
      engineVoice,
      start,
      stop,
      pause,
      resume,
      jumpTo,
      setVoice,
      setSpeed,
      setAutoNext,
      setReadVerseNumber,
    }),
    [
      status,
      currentIndex,
      currentTrack,
      queueLength,
      voice,
      speed,
      autoNext,
      readVerseNumber,
      isWebSpeechFallback,
      engine,
      engineVoice,
      start,
      stop,
      pause,
      resume,
      jumpTo,
      setVoice,
      setSpeed,
      setAutoNext,
      setReadVerseNumber,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTts(): TtsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTts must be used within TtsProvider");
  return v;
}
