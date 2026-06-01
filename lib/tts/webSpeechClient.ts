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

// 플랫폼별 알려진 한국어 voice 이름 매핑 — Web Speech 폴백 시 사용
// 한국어 male voice 는 매우 제한적 (대부분 플랫폼은 female 만 제공) → 안내 메시지로 사용자에게 한계 노출
const KNOWN_FEMALE = ["Heami", "Yuna", "Sora", "한국의", "Korean Female"];
const KNOWN_MALE = ["InJoon", "Jangmi", "Sangwoo", "Korean Male"];

function pickKoreanVoice(prefer: TTSVoice): SpeechSynthesisVoice | null {
  const all = loadVoices();
  const ko = all.filter((v) => v.lang.startsWith("ko"));
  if (ko.length === 0) return null;

  const knownList = prefer === "male" ? KNOWN_MALE : KNOWN_FEMALE;
  for (const name of knownList) {
    const found = ko.find((v) => v.name.includes(name));
    if (found) return found;
  }
  const hint = prefer === "male" ? /male|man|남/i : /female|woman|여/i;
  const hinted = ko.find((v) => hint.test(v.name));
  if (hinted) return hinted;
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
