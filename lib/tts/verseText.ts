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

/**
 * 구방식 음원 기준 시각 — 이 시각 **이전**에 올라온 사전 생성 음원은 교체 대상이다.
 *
 * f4(영희)는 2026-09-10 까지 음성 복제 기본값인 '본문 흘려 넣기' 모드로 만들어, 대상 본문의 끝 신호가
 * 참조 음성 한가운데에 찍힌 탓에 **절 끝 음절이 짧게 잘린 것이 많다**(실측 절 끝 중앙값 98ms,
 * 통째로 넣기 218ms). 새 방식으로 성경 전체를 마친 뒤 이 시각 이전 파일을 다시 만들어 덮어쓴다.
 * 값은 scripts/data/f4-legacy-streaming.json 의 snapshotAt 과 같다 — 그 목록이 감사 기록이다.
 */
export const LEGACY_BEFORE: Partial<Record<string, string>> = {
  f4: "2026-09-10T10:28:53.602Z",
};
