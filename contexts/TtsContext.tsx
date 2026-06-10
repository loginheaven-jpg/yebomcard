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
  type TTSAccent,
} from "@/lib/tts/cloudTtsClient";
import { isEnglishVersion } from "@/lib/versions";
import {
  getCachedAudio,
  putCachedAudio,
  makeCacheKey,
} from "@/lib/tts/ttsCache";
import {
  WebSpeechController,
  isWebSpeechSupported,
} from "@/lib/tts/webSpeechClient";
import { lookupChapterAudio } from "@/lib/bibleAudio";

export type TtsStatus = "idle" | "loading" | "speaking" | "paused";
export type TtsSpeed = 0.85 | 1.0 | 1.15 | 1.5 | 1.75 | 2.0;
export const TTS_SPEEDS: TtsSpeed[] = [0.85, 1.0, 1.15, 1.5, 1.75, 2.0];

export interface TtsTrack {
  text: string;
  /** 화면 표시용 ref (예: "시 121:5") */
  ref: string;
  /** 캐시·식별용 */
  version: string;
  bookCode: string;
  bookName: string;
  chapter: number;
  /** 절 번호. 0 = 장 시작 announcement, -1 = 장 통째 음원 (mp3Url 사용), 1+ = 절. */
  verse: number;
  /** Supabase 적재된 장 단위 음원 URL. 있으면 TTS 합성 대신 이 URL 직접 재생. */
  mp3Url?: string;
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
      const announceText = isEnglishVersion(t.version)
        ? `${t.bookName} chapter ${t.chapter}`
        : `${t.bookName} ${t.chapter}장`;
      out.push({
        text: announceText,
        ref: announceText,
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

/**
 * 절 단위 트랙 배열을 받아 — 동일 (version, book, chapter) 인지 확인하고
 * bible_audio 매핑이 있으면 [announcement, 장 통째 mp3 트랙] 로 압축.
 * 매핑 없거나 트랙이 여러 장 섞여있으면 절 단위 + announcement 주입으로 폴백.
 */
async function transformWithChapterAudio(
  tracks: TtsTrack[],
): Promise<TtsTrack[]> {
  if (tracks.length === 0) return tracks;
  const first = tracks[0];
  const allSameChapter = tracks.every(
    (t) =>
      t.version === first.version &&
      t.bookCode === first.bookCode &&
      t.chapter === first.chapter,
  );
  if (!allSameChapter) {
    return injectChapterAnnouncements(tracks);
  }
  const url = await lookupChapterAudio(first.version, first.bookCode, first.chapter);
  if (!url) {
    return injectChapterAnnouncements(tracks);
  }
  // 음원에 책명·장 안내가 포함되어 있으므로 별도 announcement 트랙 생략 — 장 통째 mp3 한 트랙만
  return [
    {
      text: "",
      ref: `${first.bookName} ${first.chapter}장`,
      version: first.version,
      bookCode: first.bookCode,
      bookName: first.bookName,
      chapter: first.chapter,
      verse: -1,
      mp3Url: url,
    },
  ];
}

export type LoadNextChapterFn = () => Promise<TtsTrack[] | null>;

interface StartParams {
  tracks: TtsTrack[];
  startIndex?: number;
  loadNextChapter?: LoadNextChapterFn;
}

/** 현재 재생 중인 음원의 엔진 식별 */
export type TtsEngine = "real" | "chirp" | "neural2" | "wavenet" | "webspeech" | "unknown";

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
  /** 영문 발음 — 영문 역본 TTS 시에만 적용 ("us"|"gb") */
  englishAccent: TTSAccent;
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
  setEnglishAccent: (a: TTSAccent) => void;
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
  englishAccent: "yebom_tts_english_accent",
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
  const [englishAccent, setEnglishAccentState] = useState<TTSAccent>("us");
  const englishAccentRef = useRef<TTSAccent>("us");

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
    const acc = readStorage<TTSAccent>(LS.englishAccent, "us", (s) =>
      s === "gb" ? "gb" : "us",
    );
    setEnglishAccentState(acc);
    englishAccentRef.current = acc;
  }, []);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    speedRef.current = speed;
    // 장 단위 mp3 재생 중이면 즉시 playbackRate 반영 (TTS 합성 모드는 다음 절부터 적용됨)
    if (audioRef.current && currentTrack?.mp3Url) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, currentTrack?.mp3Url]);
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
  const setEnglishAccent = useCallback((a: TTSAccent) => {
    setEnglishAccentState(a);
    englishAccentRef.current = a;
    writeStorage(LS.englishAccent, a);
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
              const augmented = await transformWithChapterAudio(nextTracks);
              if (playGenRef.current !== gen) return;
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

      // 장 단위 사람 녹음 음원 — TTS 합성 우회, mp3Url 직접 재생
      if (track.mp3Url) {
        setEngine("real");
        setEngineVoice("쉬운성경(통독성경)");
        setIsWebSpeechFallback(false);
        const audio = new Audio(track.mp3Url);
        audio.playbackRate = speedRef.current;
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
        return;
      }

      const v = voiceRef.current;
      const sp = speedRef.current;
      const isAnnouncement = track.verse === 0;
      const isEng = isEnglishVersion(track.version);
      const cacheKey = makeCacheKey({
        version: track.version,
        bookCode: track.bookCode,
        chapter: track.chapter,
        verse: track.verse,
        voice: v,
        speed: sp,
        accent: isEng ? englishAccentRef.current : "ko",
      });

      const playableText =
        !isAnnouncement && readVerseNumberRef.current
          ? (isEng
              ? `Verse ${track.verse}. ${track.text}`
              : `${track.verse}절. ${track.text}`)
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
            lang: isEng ? "en" : "ko",
            accent: englishAccentRef.current,
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
    async (p: StartParams) => {
      if (!p.tracks || p.tracks.length === 0) return;
      loadNextChapterRef.current = p.loadNextChapter ?? null;
      setIsWebSpeechFallback(false);
      // 즉시 loading 표시 — bible_audio lookup 대기 중에도 미니 플레이어 노출
      setStatus("loading");
      statusRef.current = "loading";

      // 장 단위 음원이 있으면 [announcement, mp3 통째] 큐로 압축, 없으면 절 단위 + announcement
      const augmented = await transformWithChapterAudio(p.tracks);
      queueRef.current = augmented;
      setQueueLength(augmented.length);

      // 장 단위 mp3 모드: startIndex 와 무관하게 announcement 부터 (mp3 는 장 내부 seek 불가)
      // 절 단위 모드: startIndex > 0 이면 그 절 위치를 augmented 에서 찾아 announcement 스킵
      let startIdx = 0;
      const isChapterAudioMode = augmented.some((t) => t.mp3Url);
      if (!isChapterAudioMode && p.startIndex && p.startIndex > 0) {
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
      englishAccent,
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
      setEnglishAccent,
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
      englishAccent,
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
      setEnglishAccent,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTts(): TtsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTts must be used within TtsProvider");
  return v;
}
