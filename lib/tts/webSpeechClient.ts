/**
 * Web Speech API 폴백 — GCP TTS 실패 시 (env 미설정 / 네트워크 오류) 즉시 대체 재생.
 *
 * 절 단위 utterance. 한국어 voice 우선순위: Google 한국어 > 시스템 한국어 > 기본.
 * 모든 콜백은 한 번만 fire — duplicate fire 방지 가드 포함.
 */

import type { TTSVoice } from "./cloudTtsClient";

export interface WebSpeechParams {
  text: string;
  voice: TTSVoice;
  speed: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function loadVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

function pickKoreanVoice(prefer: TTSVoice): SpeechSynthesisVoice | null {
  const all = loadVoices();
  const ko = all.filter((v) => v.lang.startsWith("ko"));
  if (ko.length === 0) return null;
  // 이름에 female/male 힌트가 있으면 우선
  const hint = prefer === "male" ? /male|man|남/i : /female|woman|여/i;
  const hinted = ko.find((v) => hint.test(v.name));
  if (hinted) return hinted;
  // Google 한국어 우선
  const google = ko.find((v) => v.name.includes("Google"));
  return google || ko[0];
}

export function isWebSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

export class WebSpeechController {
  private current: SpeechSynthesisUtterance | null = null;
  private endFired = false;

  speak(p: WebSpeechParams): void {
    if (!isWebSpeechSupported()) {
      p.onError?.();
      return;
    }
    this.stop();
    this.endFired = false;
    const u = new SpeechSynthesisUtterance(p.text);
    const voice = pickKoreanVoice(p.voice);
    if (voice) u.voice = voice;
    u.lang = "ko-KR";
    u.rate = p.speed;
    u.pitch = 1.0;
    u.onstart = () => p.onStart?.();
    u.onend = () => {
      if (this.endFired) return;
      this.endFired = true;
      p.onEnd?.();
    };
    u.onerror = () => {
      if (this.endFired) return;
      this.endFired = true;
      p.onError?.();
    };
    this.current = u;
    window.speechSynthesis.speak(u);
  }

  pause(): void {
    if (typeof window !== "undefined") window.speechSynthesis.pause();
  }

  resume(): void {
    if (typeof window !== "undefined") window.speechSynthesis.resume();
  }

  stop(): void {
    if (typeof window === "undefined") return;
    this.endFired = true;
    this.current = null;
    window.speechSynthesis.cancel();
  }
}
