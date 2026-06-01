/**
 * Cloud TTS 클라이언트 — /api/tts 호출 + AbortController
 *
 * 절 단위 fetch → Blob 반환. 캐시 책임은 호출자(useVerseTTS)에 위임.
 */

export type TTSVoice = "female" | "male";

export interface CloudTtsParams {
  text: string;
  voice: TTSVoice;
  speed: number;
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
    }),
    signal: p.signal,
  });
  if (!res.ok) {
    throw new Error(`TTS_ERROR_${res.status}`);
  }
  const voiceUsed = res.headers.get("X-TTS-Voice") || "";
  const blob = await res.blob();
  return { blob, voiceUsed };
}
