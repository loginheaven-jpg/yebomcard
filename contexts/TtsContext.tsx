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
export type TtsSpeed = 0.7 | 0.85 | 1.0 | 1.15 | 1.5 | 1.75 | 2.0;
export const TTS_SPEEDS: TtsSpeed[] = [0.7, 0.85, 1.0, 1.15, 1.5, 1.75, 2.0];

/**
 * 한국어 AI 성우 8종 — 성우별 엔진은 app/api/tts/route.ts 의 KOREAN_VOICE_CONFIG 참조.
 *   m1 천사장(ElevenLabs) · m2 Charon(GCP Chirp) · m3 Watson·m4 Garret·m5 Daddy(Supertone)
 *   f1 김단아(ElevenLabs) · f2 Aoede(GCP Chirp) · f3 Cindy(Supertone)
 */
export type KoreanVoice = "m1" | "m2" | "m3" | "m4" | "m5" | "f1" | "f2" | "f3" | "f4";
export const KOREAN_VOICES: KoreanVoice[] = ["m1", "m2", "m3", "m4", "m5", "f1", "f2", "f3", "f4"];
export const KOREAN_VOICE_LABELS: Record<KoreanVoice, string> = {
  m1: "천사장",
  m2: "활력",
  m3: "감미",
  m4: "품격",
  m5: "할부지",
  f1: "김단아",
  f2: "생생",
  f3: "지성",
  // 커스텀 클론 보이스 — 사전 생성분만 존재하므로 현재 범위를 라벨에 밝힌다.
  // 범위가 늘면 접미사를 갱신/제거할 것.
  f4: "영희(욥기)",
};
/** 선택 목록 표시 순서 — 여성(생생·지성·김단아) 먼저, 남성(활력·감미·품격·천사장·할부지) */
export const KOREAN_VOICE_ORDER: KoreanVoice[] = ["f2", "f3", "f1", "f4", "m2", "m3", "m4", "m1", "m5"];
/** 성우별 1순위 엔진 — route.ts KOREAN_VOICE_CONFIG 와 일치. chirp 는 GCP 라 항상 가용 */
export const KOREAN_VOICE_ENGINE: Record<KoreanVoice, "eleven" | "chirp" | "supertone"> = {
  m1: "eleven",
  m2: "chirp",
  m3: "supertone",
  m4: "supertone",
  m5: "supertone",
  f1: "eleven",
  f2: "chirp",
  f3: "supertone",
  // f4(영희)는 라이브 엔진이 없는 **사전 생성 전용** 보이스다.
  // R2 공유 캐시에 있으면 그 음원이 나가고, 없으면 Chirp 로 폴백된다.
  // 엔진을 chirp 로 두어야 헬스체크(크레딧)로 비활성화되지 않는다.
  f4: "chirp",
};
export function koreanVoiceGender(kv: KoreanVoice): "male" | "female" {
  return kv.startsWith("m") ? "male" : "female";
}

type EngineHealth = { ok: boolean; reason?: string };
export interface TtsHealth {
  elevenlabs: EngineHealth;
  supertone: EngineHealth;
}
const DEFAULT_HEALTH: TtsHealth = { elevenlabs: { ok: true }, supertone: { ok: true } };

/** 성우가 소진/장애로 사실상 폴백 재생될지 + 뱃지 라벨. chirp(GCP)는 항상 정상. */
export function koreanVoiceStatusFrom(
  kv: KoreanVoice,
  health: TtsHealth,
): { down: boolean; reasonLabel: string } {
  const eng = KOREAN_VOICE_ENGINE[kv];
  if (eng === "chirp") return { down: false, reasonLabel: "" };
  const s = eng === "eleven" ? health.elevenlabs : health.supertone;
  if (s.ok) return { down: false, reasonLabel: "" };
  const reasonLabel =
    s.reason === "quota"
      ? "소진"
      : s.reason === "auth"
        ? "키오류"
        : s.reason === "nokey"
          ? "미설정"
          : "지연";
  return { down: true, reasonLabel };
}

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
  /** true면 장 mp3 압축을 건너뛰고 절 단위로 재생 (전체화면 1절 모드 — 절마다 currentTrack 갱신 → 화면 동기화) */
  perVerse?: boolean;
}

/** 현재 재생 중인 음원의 엔진 식별 */
export type TtsEngine = "real" | "eleven" | "supertone" | "chirp" | "neural2" | "wavenet" | "webspeech" | "unknown";

interface TtsContextValue {
  status: TtsStatus;
  currentIndex: number;
  currentTrack: TtsTrack | null;
  queueLength: number;
  voice: TTSVoice;
  /** 한국어 AI 성우 (m1/m2/f1/f2) */
  koreanVoice: KoreanVoice;
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
  /** 엔진 헬스(크레딧 소진/장애) — 성우 disable·뱃지용. koreanVoiceStatusFrom 과 함께 사용 */
  ttsHealth: TtsHealth;
  start: (p: StartParams) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  jumpTo: (index: number) => void;
  setVoice: (v: TTSVoice) => void;
  setKoreanVoice: (v: KoreanVoice) => void;
  setSpeed: (s: TtsSpeed) => void;
  setAutoNext: (b: boolean) => void;
  setReadVerseNumber: (b: boolean) => void;
  setEnglishAccent: (a: TTSAccent) => void;
}

function classifyEngine(voiceName: string): TtsEngine {
  if (!voiceName) return "unknown";
  if (voiceName.startsWith("el:")) return "eleven"; // ElevenLabs (X-TTS-Voice: el:<voiceId>)
  if (voiceName.startsWith("sup:")) return "supertone"; // Supertone (X-TTS-Voice: sup:<voiceId>)
  if (voiceName.includes("Chirp")) return "chirp";
  if (voiceName.includes("Neural2")) return "neural2";
  if (voiceName.includes("Wavenet")) return "wavenet";
  return "unknown";
}

const Ctx = createContext<TtsContextValue | null>(null);

const LS = {
  voice: "yebom_tts_voice",
  koreanVoice: "yebom_tts_korean_voice",
  speedAi: "yebom_tts_speed_ai",
  speedRecKo: "yebom_tts_speed_recko",
  speedRecEn: "yebom_tts_speed_recen",
  autoNext: "yebom_tts_auto_next",
  readVerseNumber: "yebom_tts_read_verse_number",
  englishAccent: "yebom_tts_english_accent",
} as const;

/** 재생 유형 — ai(TTS 합성) / recko(녹음·한글) / recen(녹음·영문) */
type SpeedType = "ai" | "recko" | "recen";
const SPEED_LS: Record<SpeedType, string> = {
  ai: LS.speedAi,
  recko: LS.speedRecKo,
  recen: LS.speedRecEn,
};
// 유형별 기본 속도: AI 1.0 / 녹음·한글 1.15 / 녹음·영문 0.85
const SPEED_DEFAULT: Record<SpeedType, TtsSpeed> = { ai: 1.0, recko: 1.15, recen: 0.85 };

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

/** 유형별 저장 속도 읽기 (없으면 유형 기본값). 사용자가 바꾼 값이 유지됨(유형별 기억) */
function readSpeedForType(t: SpeedType): TtsSpeed {
  return readStorage<TtsSpeed>(SPEED_LS[t], SPEED_DEFAULT[t], (s) => {
    const n = parseFloat(s);
    return (TTS_SPEEDS as number[]).includes(n) ? (n as TtsSpeed) : SPEED_DEFAULT[t];
  });
}

export function TtsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [queueLength, setQueueLength] = useState(0);
  const [voice, setVoiceState] = useState<TTSVoice>("male");
  const [koreanVoice, setKoreanVoiceState] = useState<KoreanVoice>("m1");
  const [speed, setSpeedState] = useState<TtsSpeed>(1.0);
  const [autoNext, setAutoNextState] = useState(true);
  const [readVerseNumber, setReadVerseNumberState] = useState(false);
  const [isWebSpeechFallback, setIsWebSpeechFallback] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<TtsTrack | null>(null);
  const [engine, setEngine] = useState<TtsEngine>("unknown");
  const [engineVoice, setEngineVoice] = useState("");
  const [englishAccent, setEnglishAccentState] = useState<TTSAccent>("gb");
  const englishAccentRef = useRef<TTSAccent>("gb");
  const [ttsHealth, setTtsHealth] = useState<TtsHealth>(DEFAULT_HEALTH);

  const queueRef = useRef<TtsTrack[]>([]);
  const indexRef = useRef(-1);
  const statusRef = useRef<TtsStatus>("idle");
  const voiceRef = useRef<TTSVoice>("male");
  const koreanVoiceRef = useRef<KoreanVoice>("m1");
  const speedRef = useRef<TtsSpeed>(1.0);
  const speedTypeRef = useRef<SpeedType>("ai");
  const autoNextRef = useRef(true);
  const readVerseNumberRef = useRef(false);
  const loadNextChapterRef = useRef<LoadNextChapterFn | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const webSpeechRef = useRef<WebSpeechController | null>(null);
  const playGenRef = useRef(0);
  const playIndexRef = useRef<(i: number) => void>(() => {});

  useEffect(() => {
    // localStorage 초기 복원 — SSR 시 default → mount 후 보정 (hydration mismatch 회피)
    setVoiceState(
      readStorage<TTSVoice>(LS.voice, "male", (s) =>
        s === "female" ? "female" : "male",
      ),
    );
    // 기본 성우: 저장값 없으면 홀수날 생생(f2)/짝수날 활력(m2) — 둘 다 GCP Chirp 라 항상 가용
    const dayDefault: KoreanVoice = new Date().getDate() % 2 === 1 ? "f2" : "m2";
    const kv = readStorage<KoreanVoice>(LS.koreanVoice, dayDefault, (s) =>
      (KOREAN_VOICES as string[]).includes(s) ? (s as KoreanVoice) : dayDefault,
    );
    setKoreanVoiceState(kv);
    koreanVoiceRef.current = kv;
    // 속도는 재생 시작 시 유형별로 로드(SPEED_DEFAULT/유형별 기억) — 단일 전역 속도 복원 없음
    setAutoNextState(readStorage<boolean>(LS.autoNext, true, (s) => s === "1"));
    setReadVerseNumberState(
      readStorage<boolean>(LS.readVerseNumber, false, (s) => s === "1"),
    );
    const acc = readStorage<TTSAccent>(LS.englishAccent, "gb", (s) =>
      s === "us" ? "us" : "gb",
    );
    setEnglishAccentState(acc);
    englishAccentRef.current = acc;
  }, []);

  // 엔진 헬스(크레딧 소진/장애) 조회 — 소진 성우 disable·뱃지용. 마운트 + 5분 주기 + 재생 시작 시.
  const refreshHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/tts/health");
      if (!r.ok) return;
      const j = await r.json();
      const e = j?.engines ?? {};
      setTtsHealth({
        elevenlabs: { ok: e.elevenlabs?.ok !== false, reason: e.elevenlabs?.reason },
        supertone: { ok: e.supertone?.ok !== false, reason: e.supertone?.reason },
      });
    } catch {
      /* 헬스 조회 실패는 무시 — 기본(정상)으로 둠 */
    }
  }, []);
  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    koreanVoiceRef.current = koreanVoice;
  }, [koreanVoice]);
  useEffect(() => {
    speedRef.current = speed;
    // 녹음/합성 모두 playbackRate 로 즉시 배속 반영 (합성은 항상 1.0x 로 만들고 재생 속도만 조절 → 비용 절감)
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
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
  const setKoreanVoice = useCallback((v: KoreanVoice) => {
    setKoreanVoiceState(v);
    koreanVoiceRef.current = v;
    writeStorage(LS.koreanVoice, v);
  }, []);
  const setSpeed = useCallback((s: TtsSpeed) => {
    setSpeedState(s);
    speedRef.current = s;
    // 현재 재생 유형의 속도로 저장 → 그 유형의 새 기본값으로 유지
    writeStorage(SPEED_LS[speedTypeRef.current], String(s));
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

  // 다음 절 미리 합성(프리페치) — 현재 절 재생 중 백그라운드로 합성·캐시해 절 사이 무음 간격 제거.
  // 재생 큐/오디오는 건드리지 않고 IndexedDB 캐시만 채운다(다음 playIndex 가 캐시 적중).
  const prefetchIndex = useCallback(async (idx: number) => {
    const tracks = queueRef.current;
    if (idx < 0 || idx >= tracks.length) return;
    const track = tracks[idx];
    if (track.mp3Url) return; // 녹음 음원(장 통째)은 프리페치 대상 아님
    const isEng = isEnglishVersion(track.version);
    const kv = koreanVoiceRef.current;
    const v: TTSVoice = isEng ? voiceRef.current : kv.startsWith("m") ? "male" : "female";
    const sp = speedRef.current;
    const isAnnouncement = track.verse === 0;
    const cacheKey = makeCacheKey({
      version: track.version,
      bookCode: track.bookCode,
      chapter: track.chapter,
      verse: track.verse,
      voice: v,
      speed: sp,
      accent: isEng ? englishAccentRef.current : "ko",
      koreanVoice: isEng ? undefined : kv,
    });
    try {
      const cached = await getCachedAudio(cacheKey);
      if (cached) return; // 이미 캐시됨 → 프리페치 불필요
    } catch {
      /* 캐시 조회 실패 시 그냥 프리페치 진행 */
    }
    const playableText =
      !isAnnouncement && readVerseNumberRef.current
        ? isEng
          ? `Verse ${track.verse}. ${track.text}`
          : `${track.verse}절. ${track.text}`
        : track.text;
    prefetchAbortRef.current?.abort(); // 항상 1건만 진행
    const ctrl = new AbortController();
    prefetchAbortRef.current = ctrl;
    try {
      const result = await fetchCloudTtsAudio({
        text: playableText,
        voice: v,
        speed: 1, // 합성은 항상 1.0x (프리페치) — 재생 시 playbackRate 로 배속
        lang: isEng ? "en" : "ko",
        accent: englishAccentRef.current,
        koreanVoice: isEng ? undefined : kv,
        signal: ctrl.signal,
      });
      void putCachedAudio(cacheKey, result.blob, result.voiceUsed);
    } catch {
      /* 프리페치 실패/취소는 무시 — 실제 재생 시 정상 경로로 재시도 */
    }
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

      const isEng = isEnglishVersion(track.version);
      const kv = koreanVoiceRef.current;
      // 영문은 voice(male/female), 한국어는 koreanVoice 의 성별로 voice 슬롯 결정(GCP 폴백 성별용)
      const v: TTSVoice = isEng ? voiceRef.current : (kv.startsWith("m") ? "male" : "female");
      const sp = speedRef.current;
      const isAnnouncement = track.verse === 0;
      const cacheKey = makeCacheKey({
        version: track.version,
        bookCode: track.bookCode,
        chapter: track.chapter,
        verse: track.verse,
        voice: v,
        speed: sp,
        accent: isEng ? englishAccentRef.current : "ko",
        koreanVoice: isEng ? undefined : kv,
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
            speed: 1, // 합성은 항상 1.0x — 재생 속도는 playbackRate 로(캐시/비용 절감)
            lang: isEng ? "en" : "ko",
            accent: englishAccentRef.current,
            koreanVoice: isEng ? undefined : kv,
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
      audio.playbackRate = speedRef.current; // 합성음은 1.0x 로 만들어졌으므로 재생 속도는 여기서
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
        // 재생 시작과 동시에 다음 절 미리 합성 → 절 사이 무음 간격 제거
        void prefetchIndex(idx + 1);
      } catch {
        if (playGenRef.current !== gen) return;
        cleanupAudio();
        setStatus("idle");
        statusRef.current = "idle";
      }
    },
    [cleanupAudio, prefetchIndex],
  );

  useEffect(() => {
    playIndexRef.current = playIndex;
  }, [playIndex]);

  const start = useCallback(
    async (p: StartParams) => {
      if (!p.tracks || p.tracks.length === 0) return;
      loadNextChapterRef.current = p.loadNextChapter ?? null;
      void refreshHealth(); // 재생 시작 시 엔진 상태 갱신(소진 성우 즉시 반영)
      setIsWebSpeechFallback(false);
      // 새 재생 세션: 직전 재생(녹음 등) 엔진 배지 잔상 제거 — 트랙 해석 후 다시 채움.
      // (녹음 음원은 mp3Url 즉시 "real" 로 재설정되므로 깜빡임 없음)
      setEngine("unknown");
      setEngineVoice("");
      // 즉시 loading 표시 — bible_audio lookup 대기 중에도 미니 플레이어 노출
      setStatus("loading");
      statusRef.current = "loading";

      // 장 단위 음원이 있으면 [announcement, mp3 통째] 큐로 압축, 없으면 절 단위 + announcement.
      // perVerse(전체화면 1절 모드)면 압축 없이 절 단위 그대로 — 절마다 currentTrack 갱신돼 화면이 따라감.
      const augmented = p.perVerse ? p.tracks : await transformWithChapterAudio(p.tracks);
      queueRef.current = augmented;
      setQueueLength(augmented.length);

      // 유형별 기본 속도 적용(유형별 기억값 우선): AI 1.0 / 녹음·한글 1.15 / 녹음·영문 0.85
      const recorded = augmented.some((t) => t.mp3Url);
      const stype: SpeedType = !recorded
        ? "ai"
        : isEnglishVersion(p.tracks[0].version)
          ? "recen"
          : "recko";
      speedTypeRef.current = stype;
      const tsp = readSpeedForType(stype);
      speedRef.current = tsp;
      setSpeedState(tsp);

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
    [playIndex, refreshHealth],
  );

  const stop = useCallback(() => {
    playGenRef.current++;
    cleanupAudio();
    prefetchAbortRef.current?.abort();
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
      // 언마운트 시 진행 중인 fetch/audio/프리페치 모두 abort. ref 쓰기만 하므로 안전.
      playGenRef.current++;
      cleanupAudio();
      prefetchAbortRef.current?.abort();
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
      koreanVoice,
      speed,
      autoNext,
      readVerseNumber,
      isWebSpeechFallback,
      englishAccent,
      engine,
      engineVoice,
      ttsHealth,
      start,
      stop,
      pause,
      resume,
      jumpTo,
      setVoice,
      setKoreanVoice,
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
      koreanVoice,
      speed,
      autoNext,
      readVerseNumber,
      isWebSpeechFallback,
      englishAccent,
      engine,
      engineVoice,
      ttsHealth,
      start,
      stop,
      pause,
      resume,
      jumpTo,
      setVoice,
      setKoreanVoice,
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
