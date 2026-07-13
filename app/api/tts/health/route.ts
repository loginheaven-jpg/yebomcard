/**
 * TTS 엔진 헬스 — 클라이언트가 선택 리스트에서 소진/장애 성우를 disable·뱃지 처리하도록.
 *
 * ElevenLabs: /v1/user/subscription 의 character_count/limit 로 잔여 판단.
 * Supertone: /v1/credits 의 balance 로 잔여 판단.
 * GCP(Chirp/Neural2/WaveNet): 크레딧 개념 없음 → 항상 ok.
 *
 * 라이브 점검은 5분 캐시. 사전 점검 결과로 서킷 브레이커도 갱신해 synth 경로의 첫 왕복도 아낀다.
 * 런타임 실패로 브레이커가 내려간 경우도 최종 병합해 반영.
 */

import { NextResponse } from "next/server";
import { isEngineDown, markEngineDown, clearEngineDown } from "@/lib/tts/engineHealth";
import { r2CacheEnabled, probeR2Write } from "@/lib/tts/r2Cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EL_API_KEY = process.env.ELEVENLABS_API_KEY || process.env["11LABS"] || "";
const SUPERTONE_API_KEY = process.env.SUPERTONE_API_KEY || "";

type EngineStatus = { ok: boolean; reason?: string; remaining?: number };
type R2Status = { enabled: boolean; writable: boolean };
let cache: { at: number; el: EngineStatus; sup: EngineStatus; r2: R2Status } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function checkElevenLabs(): Promise<EngineStatus> {
  if (!EL_API_KEY) return { ok: false, reason: "nokey" };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": EL_API_KEY },
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "auth" };
    if (!r.ok) return { ok: false, reason: "error" };
    const j = await r.json();
    const remaining = (j.character_limit ?? 0) - (j.character_count ?? 0);
    return remaining > 0 ? { ok: true, remaining } : { ok: false, reason: "quota", remaining: 0 };
  } catch {
    return { ok: false, reason: "error" };
  }
}

async function checkSupertone(): Promise<EngineStatus> {
  if (!SUPERTONE_API_KEY) return { ok: false, reason: "nokey" };
  try {
    const r = await fetch("https://supertoneapi.com/v1/credits", {
      headers: { "x-sup-api-key": SUPERTONE_API_KEY },
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "auth" };
    if (!r.ok) return { ok: false, reason: "error" };
    const j = await r.json();
    const balance = typeof j.balance === "number" ? j.balance : 0;
    return balance > 0 ? { ok: true, remaining: balance } : { ok: false, reason: "quota", remaining: 0 };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function GET() {
  const nowMs = Date.now();
  if (!cache || nowMs - cache.at > TTL_MS) {
    const [el, sup, r2Writable] = await Promise.all([
      checkElevenLabs(),
      checkSupertone(),
      probeR2Write(), // 공유 캐시 쓰기 권한 실검증(작은 마커 PUT)
    ]);
    cache = { at: nowMs, el, sup, r2: { enabled: r2CacheEnabled(), writable: r2Writable } };
    // 사전 점검 결과로 브레이커도 갱신(같은 웜 인스턴스면 synth 경로가 첫 실패 왕복도 아낌)
    if (el.ok) clearEngineDown("elevenlabs");
    else markEngineDown("elevenlabs");
    if (sup.ok) clearEngineDown("supertone");
    else markEngineDown("supertone");
  }
  // 런타임 브레이커 상태를 최종 병합(라이브는 ok 여도 최근 실패로 down 이면 down 으로 표시)
  const elOk = cache.el.ok && !isEngineDown("elevenlabs");
  const supOk = cache.sup.ok && !isEngineDown("supertone");
  return NextResponse.json(
    {
      engines: {
        elevenlabs: { ok: elOk, reason: elOk ? undefined : cache.el.reason ?? "down" },
        supertone: { ok: supOk, reason: supOk ? undefined : cache.sup.reason ?? "down" },
        gcp: { ok: true },
      },
      // 공유 캐시 상태 — enabled=R2 자격 존재, writable=실제 쓰기 성공. 둘 다 true 여야 비용 절감 작동.
      r2: cache.r2,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
