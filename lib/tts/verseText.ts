/**
 * 낭독 본문 정제 + 공유 캐시 키 — 서버/스튜디오 공통 규칙.
 *
 * 이 규칙이 어긋나면 키가 달라져 **조용히 캐시 미스**가 난다(에러가 안 난다).
 * 로컬 스튜디오(voice/engine.py 의 NOTE_RE / cache_key)와 문자 단위로 같아야 하므로
 * 정의를 여기 한 곳에만 둔다.
 */

import crypto from "crypto";

/** 편집자 주석 "(주: …)" — 절 끝에 오므로 그 지점부터 끝까지 제거 */
const NOTE_RE = /\s*\(\s*주\s*[:：][\s\S]*$/;

/** 공유 캐시 키 버전 — 성우↔엔진 매핑을 바꾸면 올려서 일괄 무효화 */
export const TTS_CACHE_VERSION = "v1";

/**
 * 화면엔 두되 낭독에서만 제외할 것을 걷어낸다.
 * "( 셀라 )" 같은 본문 괄호는 보존한다.
 * 전부 걷어내 빈 문자열이 되면 원문을 그대로 쓴다.
 */
export function cleanForTts(text: string): string {
  return text.replace(NOTE_RE, "").trim() || text;
}

/** tts/{ver}/{ko|en}/{성우}/{sha1(정제본문)}.mp3 */
export function ttsCacheKey(cleanedText: string, voiceKey: string, lang: "ko" | "en" = "ko"): string {
  const hash = crypto.createHash("sha1").update(cleanedText).digest("hex");
  return `tts/${TTS_CACHE_VERSION}/${lang}/${voiceKey}/${hash}.mp3`;
}

/** 로컬 스튜디오가 사전 생성한 음원을 올릴 수 있는 성우 슬롯 */
export const PREGENERATED_VOICE_KEYS = ["f4"] as const;
