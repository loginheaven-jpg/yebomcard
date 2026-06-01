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

export async function fetchCloudTtsAudio(p: CloudTtsParams): Promise<Blob> {
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
  return res.blob();
}
