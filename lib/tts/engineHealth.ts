/**
 * TTS 엔진 헬스(서킷 브레이커) — 서버 전용 in-memory 상태.
 *
 * ElevenLabs·Supertone 는 크레딧 소진(401/402/403/429)·장애(timeout) 시 매 절마다 실패
 * 왕복을 반복하면 지연이 커진다. 실패를 감지하면 해당 엔진을 일정 시간(쿨다운) "down" 으로
 * 표시하고, 그 동안은 1순위 시도를 건너뛰어 곧장 폴백(GCP)으로 간다. 쿨다운 후 자동 재시도.
 *
 * Vercel 서버리스는 인스턴스별 메모리라 콜드스타트 시 리셋되지만, 연속 낭독의 절 요청은 같은
 * 웜 인스턴스에 몰리므로 실효적. /api/tts/health 의 사전 점검도 이 상태를 함께 갱신한다.
 */

const downUntil: Record<string, number> = {};
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // 10분

function now(): number {
  return Date.now();
}

export function markEngineDown(engine: string, cooldownMs: number = DEFAULT_COOLDOWN_MS): void {
  downUntil[engine] = now() + cooldownMs;
}

export function clearEngineDown(engine: string): void {
  delete downUntil[engine];
}

export function isEngineDown(engine: string): boolean {
  return (downUntil[engine] ?? 0) > now();
}
