/**
 * Cloud TTS 클라이언트 — /api/tts 호출 + AbortController
 *
 * 절 단위 fetch → Blob 반환. 캐시 책임은 호출자(useVerseTTS)에 위임.
 */

export type TTSVoice = "female" | "male";
export type TTSLang = "ko" | "en";
export type TTSAccent = "us" | "gb";

export interface CloudTtsParams {
  text: string;
  voice: TTSVoice;
  speed: number;
  /** 언어 분기 — 기본 "ko". 영문 역본(KJV/NIrV/GNT/WEB) 호출 시 "en" 전달 */
  lang?: TTSLang;
  /** 영문 발음 — 기본 "us". lang="ko" 시 무시됨. */
  accent?: TTSAccent;
  /** 한국어 성우 선택 — m1~m5/f1~f3 (lang="ko" 시). 엔진 매핑은 /api/tts KOREAN_VOICE_CONFIG */
  koreanVoice?: string;
  signal?: AbortSignal;
}

export interface CloudTtsResult {
  blob: Blob;
  /** 서버가 실제 사용한 GCP voice 이름 (X-TTS-Voice 헤더). 비어있을 수 있음 */
  voiceUsed: string;
}

export async function fetchCloudTtsAudio(p: CloudTtsParams): Promise<CloudTtsResult> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: p.text,
      voice: p.voice,
      speed: p.speed,
      lang: p.lang ?? "ko",
      accent: p.accent ?? "us",
      koreanVoice: p.koreanVoice,
    }),
    signal: p.signal,
  });
  if (!res.ok) {
    // 진단용: 에러 본문 전체 로깅 (env/quota/voice 문제 원인 파악)
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      /* ignore */
    }
    console.error(
      `[TTS] /api/tts ${res.status} ${res.statusText}\nbody: ${bodyText.slice(0, 500)}`,
    );
    throw new Error(`TTS_ERROR_${res.status}`);
  }
  const voiceUsed = res.headers.get("X-TTS-Voice") || "";
  const blob = await res.blob();
  return { blob, voiceUsed };
}
