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
import { verseGapMs, type VerseGap } from "@/lib/tts/verseGap";
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
 * 한국어 AI 성우 — 성우별 엔진은 app/api/tts/route.ts 의 KOREAN_VOICE_CONFIG 참조.
 *   m1 천사장(ElevenLabs) · m2 쾌활(GCP Chirp) · m3 Watson·m4 Garret·m5 Daddy(Supertone)
 *   f1 김단아(ElevenLabs) · f2 생생(GCP Chirp) · f3 Cindy(Supertone) · f4 영희(사전 생성)
 */
export type KoreanVoice = "m1" | "m2" | "m3" | "m4" | "m5" | "f1" | "f2" | "f3" | "f4";
export const KOREAN_VOICES: KoreanVoice[] = ["m1", "m2", "m3", "m4", "m5", "f1", "f2", "f3", "f4"];
export const KOREAN_VOICE_LABELS: Record<KoreanVoice, string> = {
  m1: "천사장",
  m2: "쾌활",   // 예전 '활력'(2026-09-11 이름 바꿈)
  m3: "감미",
  m4: "품격",
  m5: "할부지",
  f1: "김단아",
  f2: "생생",
  f3: "지성",
  // 커스텀 클론 보이스 — 사전 생성분만 존재하므로 현재 범위를 라벨에 밝힌다.
  // 범위가 늘면 접미사를 갱신/제거할 것.
  f4: "영희",
};
/**
 * 선택 목록에서 뺀 성우 — Supertone 네 성우(지성 f3·감미 m3·품격 m4·할부지 m5). 2026-09-11 사용자 결정으로 새번역 목록을
 * 영희·생생·김단아 │ 쾌활·천사장 으로 정리했다(Supertone 은 이날 오류라 대신 읽기로만 나오던 상태). 서버 엔진 설정은 남긴다.
 * 저장값이 이 넷이면 고른 적이 없는 것으로 보고 기본 성우로 돌린다.
 * 생생(f2)·쾌활(m2, 예전 '활력')은 2026-09-10 에 띄어쓰기가 어색해 뺐다가, 쉼표마다 쉬게 한 뒤(route.ts koChirpMarkup) 되살렸다.
 */
export const RETIRED_KOREAN_VOICES: readonly KoreanVoice[] = ["f3", "m3", "m4", "m5"];
/** 기본 성우 — 영희. 새번역은 사전 생성 음원, 음원이 없는 절은 서버가 김단아(f1)로 대신 읽는다 */
export const DEFAULT_KOREAN_VOICE: KoreanVoice = "f4";

/**
 * 녹음 음원이 있는 한국어 역본(개역·통독) — 성우 목록이 따로다: 생생 · 쾌활 · 성우(사람 녹음, 장 통째).
 * 새번역 목록(KOREAN_VOICE_ORDER)과 따로 기억한다. 기본은 지금까지처럼 성우(녹음).
 * '성우'를 골랐어도 녹음이 없는 장과 전체화면(절마다 화면을 맞춰야 해 장 통째 녹음을 못 씀)은 생생이 읽는다.
 */
export const RECORDED_KOREAN_VERSIONS: readonly string[] = ["nkrv", "easy"];
export type RecordedVoice = "f2" | "m2" | "rec";
export const RECORDED_VOICE_ORDER: RecordedVoice[] = ["f2", "m2", "rec"];
export const RECORDED_VOICE_LABELS: Record<RecordedVoice, string> = { f2: "생생", m2: "쾌활", rec: "성우" };
export const DEFAULT_RECORDED_VOICE: RecordedVoice = "rec";
export function isRecordedKoreanVersion(version: string): boolean {
  return RECORDED_KOREAN_VERSIONS.includes(version);
}
/** 이 역본을 절 단위로 읽을 한국어 AI 성우 — 녹음 역본은 그쪽 선택('성우'면 생생), 나머지는 새번역 선택 */
function aiVoiceFor(version: string, koreanVoice: KoreanVoice, recordedVoice: RecordedVoice): KoreanVoice {
  if (!isRecordedKoreanVersion(version)) return koreanVoice;
  return recordedVoice === "rec" ? "f2" : recordedVoice;
}
/** 장 통째 녹음으로 읽을까 — 영문(WEB 녹음)은 늘 찾아보고, 한국어는 녹음 역본에서 '성우'를 골랐을 때만 */
function wantsRecording(version: string, recordedVoice: RecordedVoice): boolean {
  if (isEnglishVersion(version)) return true;
  return isRecordedKoreanVersion(version) && recordedVoice === "rec";
}

/**
 * 사전 생성 전용 성우 — 서버 lib/tts/verseText.ts 의 PREGENERATED_VOICE_KEYS 와 같게 둔다
 * (그 모듈은 서버 전용 crypto 를 불러 여기서 가져올 수 없다).
 */
const PREGENERATED_KOREAN_VOICES: readonly KoreanVoice[] = ["f4"];

/**
 * 대신 읽기에 쓰이는 성우의 음원 표지(서버 X-TTS-Voice) — route.ts KOREAN_STAND_INS 의 성우들.
 * 영희는 사전 생성 음원("voice:f4"), 김단아는 ElevenLabs("el:" + route.ts KOREAN_VOICE_CONFIG.f1.elevenId).
 */
const STAND_IN_TAGS: Partial<Record<KoreanVoice, string>> = {
  f4: "voice:f4",
  f1: "el:vDA1h0ZXkQiojUReMmR9",
};

/**
 * 고른 성우가 아닌 목소리가 **대신 읽은** 음원인가. 서버는 고른 성우로 못 읽으면 영희 → 김단아 → GCP(Chirp…)
 * 순으로 대신 읽는다. 기기 캐시 키에는 본문도 실제 목소리도 없어서(절 번호·고른 성우만) 이런 음원을 저장하면,
 * 나중에 고른 성우의 음원이 생기거나 엔진이 돌아와도 그 기기는 대신 읽은 음원을 계속 튼다
 * (2026-09-11 롬 3:10·3:13 — 영희를 골랐는데 김단아가 계속 나옴). 저장하지 않고, 이미 저장된 것도 무시한다.
 */
function isStandInAudio(kv: KoreanVoice | undefined, voiceUsed: string): boolean {
  if (!kv) return false;
  // 사전 생성 성우는 자기 파일("voice:f4")만 제 음원이다
  if (PREGENERATED_KOREAN_VOICES.includes(kv)) return !voiceUsed.startsWith(`voice:${kv}`);
  // GCP — 생생·쾌활(Chirp 가 자기 엔진)의 Chirp 음원만 제 음원. 다른 성우의 Chirp·Neural2·WaveNet 은 대신 읽은 것
  if (voiceUsed.startsWith("ko-KR-")) return !(KOREAN_VOICE_ENGINE[kv] === "chirp" && voiceUsed.includes("Chirp3"));
  return Object.entries(STAND_IN_TAGS).some(([v, tag]) => v !== kv && voiceUsed.startsWith(tag));
}

/** 받은 음원을 기억한다 — 대신 읽기 음원은 이 세션 메모리에만(절 사이 끊김 방지), 나머지는 기기 캐시에 */
function rememberAudio(
  volatile: Map<string, { blob: Blob; voiceUsed: string }>,
  key: string,
  kv: KoreanVoice | undefined,
  blob: Blob,
  voiceUsed: string,
) {
  if (isStandInAudio(kv, voiceUsed)) {
    volatile.set(key, { blob, voiceUsed });
    if (volatile.size > 30) volatile.delete(volatile.keys().next().value as string);
    return;
  }
  void putCachedAudio(key, blob, voiceUsed);
}
/** 새번역 성우 목록 표시 순서 — 여성(영희·생생·김단아) │ 남성(쾌활·천사장) */
export const KOREAN_VOICE_ORDER: KoreanVoice[] = ["f4", "f2", "f1", "m2", "m1"];
/**
 * 기기 캐시 키의 성우 칸 — 생생·쾌활(Chirp)은 쉼표 쉼(2026-09-11) 전 음원이 기기에 남아 있을 수 있어 칸 이름을 바꿨다
 * (서버 공유 캐시도 같은 이유로 "-p" 칸 — route.ts koVoiceCacheSlot)
 */
function cacheVoiceSlot(kv: KoreanVoice): string {
  return KOREAN_VOICE_ENGINE[kv] === "chirp" ? `${kv}-p` : kv;
}
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
  f4: "eleven",   // 사전 생성 음원. 아직 없는 절은 김단아(f1)가 대신 읽는다
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
  /** 새번역(녹음 없는 한국어 역본) 성우 */
  koreanVoice: KoreanVoice;
  /** 개역·통독(녹음 있는 한국어 역본) 성우 — 생생·쾌활·성우(녹음) */
  recordedVoice: RecordedVoice;
  speed: TtsSpeed;
  autoNext: boolean;
  readVerseNumber: boolean;
  /** 절과 절 사이의 쉼 — 절 끝이 급하게 맺히는 것을 막는다 */
  verseGap: VerseGap;
  isWebSpeechFallback: boolean;
  /** 영문 발음 — 영문 역본 TTS 시에만 적용 ("us"|"gb") */
  englishAccent: TTSAccent;
  /** 마지막으로 재생된 트랙의 엔진 (UI 표시용) */
  engine: TtsEngine;
  /** 서버가 실제 사용한 voice 이름 (예: ko-KR-Chirp3-HD-Aoede) */
  engineVoice: string;
  /** 엔진 헬스(크레딧 소진/장애) — 성우 disable·뱃지용. koreanVoiceStatusFrom 과 함께 사용 */
  ttsHealth: TtsHealth;
  /**
   * 재생 시작. 절 단위로 재생하면 true — `startIndex` 가 적용된다.
   * 장 통째 녹음 음원이면 false — mp3 안에서 절 위치로 갈 수 없어 장 처음부터 재생한다.
   */
  start: (p: StartParams) => Promise<boolean>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  jumpTo: (index: number) => void;
  setVoice: (v: TTSVoice) => void;
  setKoreanVoice: (v: KoreanVoice) => void;
  /** 개역·통독 성우. 녹음 ↔ AI 가 바뀌면 지금 장을 새 방식으로 처음부터 다시 읽는다 */
  setRecordedVoice: (v: RecordedVoice) => void;
  /**
   * 역본이 바뀌었을 때 기본 성우를 맞춘다. **사용자가 직접 고른 적이 있으면 아무것도 안 한다.**
   * 새번역은 영희(f4) 사전 생성 음원이 쌓이고 있어 그것을 기본으로 쓴다.
   */
  applyVersionDefault: (version: string) => void;
  setSpeed: (s: TtsSpeed) => void;
  setAutoNext: (b: boolean) => void;
  setReadVerseNumber: (b: boolean) => void;
  setVerseGap: (g: VerseGap) => void;
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
  recordedVoice: "yebom_tts_recorded_voice",
  /** 성우 목록 개편 표시 — 값이 VOICE_LINEUP 과 다르면 한 번 옛 저장값을 정리한다 */
  voiceLineup: "yebom_tts_voice_lineup",
  speedAi: "yebom_tts_speed_ai",
  speedRecKo: "yebom_tts_speed_recko",
  speedRecEn: "yebom_tts_speed_recen",
  autoNext: "yebom_tts_auto_next",
  readVerseNumber: "yebom_tts_read_verse_number",
  englishAccent: "yebom_tts_english_accent",
  verseGap: "yebom_tts_verse_gap",
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

function removeStorage(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}

/** 성우 목록 개편 차수 — 2026-09-11: 생생·쾌활 되살림, Supertone 성우 뺌 */
const VOICE_LINEUP = "2026-09-11";

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
  const [recordedVoice, setRecordedVoiceState] = useState<RecordedVoice>(DEFAULT_RECORDED_VOICE);
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
  /** 사용자가 성우를 직접 고른 적이 있는가 — 있으면 역본 기본값이 덮지 않는다 */
  const voicePickedRef = useRef(false);
  const recordedVoiceRef = useRef<RecordedVoice>(DEFAULT_RECORDED_VOICE);
  /** 지금 큐의 절 단위 트랙(장 통째 녹음으로 줄이기 전) — 녹음 ↔ AI 를 바꿀 때 지금 장을 다시 시작하려고 */
  const sourceTracksRef = useRef<TtsTrack[]>([]);
  /** 지금 재생이 전체화면(절 단위 고정)인가 */
  const perVerseRef = useRef(false);
  const speedRef = useRef<TtsSpeed>(1.0);
  const speedTypeRef = useRef<SpeedType>("ai");
  const autoNextRef = useRef(true);
  const readVerseNumberRef = useRef(false);
  const [verseGap, setVerseGapState] = useState<VerseGap>("normal");
  const verseGapRef = useRef<VerseGap>("normal");
  /** 절 사이 쉼 타이머 — 정지·일시정지 때 반드시 걷어내야 한다 */
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadNextChapterRef = useRef<LoadNextChapterFn | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  /** 대신 읽기 음원(영희 음원이 아직 없던 절) — 기기에 저장하지 않고 이 세션에만 둔다 */
  const volatileAudioRef = useRef(new Map<string, { blob: Blob; voiceUsed: string }>());
  const webSpeechRef = useRef<WebSpeechController | null>(null);
  const playGenRef = useRef(0);
  const playIndexRef = useRef<(i: number) => void>(() => {});
  const startRef = useRef<(p: StartParams) => Promise<boolean>>(async () => false);

  useEffect(() => {
    // localStorage 초기 복원 — SSR 시 default → mount 후 보정 (hydration mismatch 회피)
    setVoiceState(
      readStorage<TTSVoice>(LS.voice, "male", (s) =>
        s === "female" ? "female" : "male",
      ),
    );
    // 성우 목록 개편(2026-09-11) — 한 번만: 생생·활력(9/10 에 뺐다가 되살림)이나 Supertone 성우를 골라 둔 옛 저장값은
    // 지운다. 9/10 부터 영희로 듣던 분이 갑자기 옛 선택으로 돌아가지 않게 한다. 이후에 고르는 값은 그대로 기억한다.
    if (readStorage<string>(LS.voiceLineup, "", (x) => x) !== VOICE_LINEUP) {
      const old = readStorage<string | null>(LS.koreanVoice, null, (x) => x);
      if (old !== null && (["f2", "m2", ...RETIRED_KOREAN_VOICES] as string[]).includes(old)) {
        removeStorage(LS.koreanVoice);
      }
      writeStorage(LS.voiceLineup, VOICE_LINEUP);
    }
    const rv = readStorage<RecordedVoice>(LS.recordedVoice, DEFAULT_RECORDED_VOICE, (x) =>
      (RECORDED_VOICE_ORDER as string[]).includes(x) ? (x as RecordedVoice) : DEFAULT_RECORDED_VOICE,
    );
    setRecordedVoiceState(rv);
    recordedVoiceRef.current = rv;
    // 저장값이 있다 = 사용자가 직접 골랐다. 역본 기본값이 이를 덮지 않는다.
    // 단 목록에서 뺀 성우(Supertone 넷)나 모르는 값이면 고른 적이 없는 것으로 보고 기본 성우(영희)로 간다.
    const stored = readStorage<string | null>(LS.koreanVoice, null, (x) => x);
    const usable =
      stored !== null &&
      (KOREAN_VOICES as string[]).includes(stored) &&
      !(RETIRED_KOREAN_VOICES as readonly string[]).includes(stored);
    voicePickedRef.current = usable;
    const kv: KoreanVoice = usable ? (stored as KoreanVoice) : DEFAULT_KOREAN_VOICE;
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
    const vg = readStorage<VerseGap>(LS.verseGap, "normal", (v) =>
      v === "short" || v === "long" ? v : "normal",
    );
    setVerseGapState(vg);
    verseGapRef.current = vg;
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
    // 절 사이 쉼 중에 멈췄을 수 있다 — 걷어내지 않으면 멈춘 뒤에 다음 절이 튀어나온다
    if (gapTimerRef.current) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
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

  /**
   * 절 하나가 끝나면 쉼을 주고 다음 절로 넘어간다.
   *
   * 곧바로 넘기면 절 끝 글자가 급하게 맺힌다 — 음원 꼬리에 무음이 거의 없기 때문이다
   * (lib/tts/verseGap.ts 설명 참조). 쉼 길이는 문장이 끝났는지에 따라 다르고,
   * 설정에서 짧게/보통/길게로 고를 수 있다.
   */
  const advanceAfterGap = useCallback((text: string, gen: number) => {
    const next = () => {
      gapTimerRef.current = null;
      if (playGenRef.current !== gen) return;
      if (statusRef.current !== "speaking") return;
      playIndexRef.current(indexRef.current + 1);
    };
    const ms = verseGapMs(text || "", verseGapRef.current, speedRef.current);
    if (ms <= 0) return next();
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = setTimeout(next, ms);
  }, []);

  const setVoice = useCallback((v: TTSVoice) => {
    setVoiceState(v);
    writeStorage(LS.voice, v);
  }, []);
  const setKoreanVoice = useCallback((v: KoreanVoice) => {
    setKoreanVoiceState(v);
    koreanVoiceRef.current = v;
    writeStorage(LS.koreanVoice, v);
    voicePickedRef.current = true;   // 이후로는 역본 기본값이 덮지 않는다
  }, []);
  const setRecordedVoice = useCallback((v: RecordedVoice) => {
    const before = recordedVoiceRef.current;
    setRecordedVoiceState(v);
    recordedVoiceRef.current = v;
    writeStorage(LS.recordedVoice, v);
    // 녹음 ↔ AI 가 바뀌면 지금 장을 새 방식으로 다시 시작한다 — 장 통째 녹음은 절 위치로 갈 수 없어 장 처음부터.
    // AI 끼리(생생 ↔ 쾌활)는 새번역처럼 다음 절부터 바뀐다. 전체화면은 늘 절 단위라 다시 시작할 일이 없다.
    const head = queueRef.current[0];
    if (statusRef.current === "idle" || perVerseRef.current || !head || !isRecordedKoreanVersion(head.version)) return;
    if ((before === "rec") === (v === "rec")) return;
    const src = sourceTracksRef.current;
    if (src.length > 0) void startRef.current({ tracks: src, loadNextChapter: loadNextChapterRef.current ?? undefined });
  }, []);

  // 역본별 기본 성우 — 지금은 모든 역본이 영희(f4)다. 새번역은 사전 생성 음원이 쌓여 있고,
  // 아직 없는 절과 다른 역본은 서버가 김단아(f1)로 대신 읽는다.
  // 역본마다 달리 둘 때를 위해 자리는 남긴다(예전엔 새번역 외 역본이 그날의 Chirp 성우였다).
  // 사용자가 플레이어나 설정에서 한 번이라도 성우를 고르면 그 선택이 우선한다.
  const applyVersionDefault = useCallback(() => {
    if (voicePickedRef.current) return;
    const want: KoreanVoice = DEFAULT_KOREAN_VOICE;
    if (koreanVoiceRef.current === want) return;
    setKoreanVoiceState(want);
    koreanVoiceRef.current = want;   // 저장하지 않는다 — 기본값이지 선택이 아니다
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
  const setVerseGap = useCallback((g: VerseGap) => {
    setVerseGapState(g);
    verseGapRef.current = g;
    writeStorage(LS.verseGap, g);
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
    const kv = aiVoiceFor(track.version, koreanVoiceRef.current, recordedVoiceRef.current);
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
      koreanVoice: isEng ? undefined : cacheVoiceSlot(kv),
    });
    const kvKey = isEng ? undefined : kv;
    if (volatileAudioRef.current.has(cacheKey)) return; // 이번 세션에 대신 읽기 음원을 이미 받아 둠
    try {
      const cached = await getCachedAudio(cacheKey);
      if (cached && !isStandInAudio(kvKey, cached.voiceUsed)) return; // 이미 캐시됨 → 프리페치 불필요
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
      rememberAudio(volatileAudioRef.current, cacheKey, kvKey, result.blob, result.voiceUsed);
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
              const augmented = wantsRecording(nextTracks[0].version, recordedVoiceRef.current)
                ? await transformWithChapterAudio(nextTracks)
                : injectChapterAnnouncements(nextTracks);
              if (playGenRef.current !== gen) return;
              sourceTracksRef.current = nextTracks;
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
          advanceAfterGap(track.text, gen);
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
      const kv = aiVoiceFor(track.version, koreanVoiceRef.current, recordedVoiceRef.current);
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
        koreanVoice: isEng ? undefined : cacheVoiceSlot(kv),
      });

      const playableText =
        !isAnnouncement && readVerseNumberRef.current
          ? (isEng
              ? `Verse ${track.verse}. ${track.text}`
              : `${track.verse}절. ${track.text}`)
          : track.text;

      let blob: Blob | null = null;
      let resolvedVoice = "";
      const kvKey = isEng ? undefined : kv;
      try {
        const cached = await getCachedAudio(cacheKey);
        if (cached && !isStandInAudio(kvKey, cached.voiceUsed)) {
          blob = cached.blob;
          resolvedVoice = cached.voiceUsed;
        } else {
          // 대신 읽은 음원을 받았던 절 — 기기에 저장된 것은 무시하고(그 사이 고른 성우의 음원이 생겼거나
          // 엔진이 돌아왔을 수 있다), 이번 세션에 받아 둔 것만 쓴다
          const vol = volatileAudioRef.current.get(cacheKey);
          if (vol) {
            blob = vol.blob;
            resolvedVoice = vol.voiceUsed;
          }
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
          rememberAudio(volatileAudioRef.current, cacheKey, kvKey, blob, resolvedVoice);
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
        advanceAfterGap(track.text, gen);
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
    [cleanupAudio, prefetchIndex, advanceAfterGap],
  );

  useEffect(() => {
    playIndexRef.current = playIndex;
  }, [playIndex]);

  const start = useCallback(
    async (p: StartParams): Promise<boolean> => {
      if (!p.tracks || p.tracks.length === 0) return false;
      loadNextChapterRef.current = p.loadNextChapter ?? null;
      sourceTracksRef.current = p.tracks;
      perVerseRef.current = !!p.perVerse;
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
      // 개역·통독은 '성우(녹음)'를 골랐을 때만 녹음을 찾는다 — 생생·쾌활이면 절 단위 + 장 안내
      const augmented = p.perVerse
        ? p.tracks
        : wantsRecording(p.tracks[0].version, recordedVoiceRef.current)
          ? await transformWithChapterAudio(p.tracks)
          : injectChapterAnnouncements(p.tracks);
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
      return !isChapterAudioMode;
    },
    [playIndex, refreshHealth],
  );

  useEffect(() => {
    startRef.current = start;
  }, [start]);

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
      recordedVoice,
      speed,
      autoNext,
      readVerseNumber,
      verseGap,
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
      setRecordedVoice,
      applyVersionDefault,
      setSpeed,
      setAutoNext,
      setReadVerseNumber,
      setVerseGap,
      setEnglishAccent,
    }),
    [
      status,
      currentIndex,
      currentTrack,
      queueLength,
      voice,
      koreanVoice,
      recordedVoice,
      speed,
      autoNext,
      readVerseNumber,
      verseGap,
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
      setRecordedVoice,
      applyVersionDefault,
      setSpeed,
      setAutoNext,
      setReadVerseNumber,
      setVerseGap,
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
