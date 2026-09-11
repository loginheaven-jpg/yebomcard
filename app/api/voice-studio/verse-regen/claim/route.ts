/**
 * POST /api/voice-studio/verse-regen/claim — 생성 PC 가 대기 중인 음원 다시 만들기 요청을 맡는다 (기기 토큰).
 *
 * 먼저 가져가는 PC 가 맡는다. 맡은 뒤 CLAIM_TTL 이 지나도 완료 보고가 없으면 다른 PC 가 다시 가져갈 수 있다.
 * 두 PC 가 같은 요청을 동시에 가져가도 사고는 아니다 — 둘 다 새로 만들어 덮어쓸 뿐이다.
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { CLAIM_TTL_MS, listRegenRequests, putRegenRequest } from "@/lib/voiceStudio/verseRegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CLAIM = 20;

export async function POST(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  let body: { voiceKey?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* 빈 본문이면 기본 성우 */
  }
  const voiceKey = (body.voiceKey || "f4").trim();
  const now = Date.now();
  const open = (await listRegenRequests(voiceKey))
    .filter(
      (r) =>
        r.status === "pending" ||
        (r.status === "claimed" && now - Date.parse(r.claimedAt || "") > CLAIM_TTL_MS),
    )
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""))
    .slice(0, MAX_CLAIM);

  const claimed: { id: string; version: string; bookCode: string; chapter: number; verse: number; ref: string }[] = [];
  for (const r of open) {
    const ok = await putRegenRequest({
      ...r,
      status: "claimed",
      claimedBy: gate.claims.id,
      claimedAt: new Date().toISOString(),
    });
    if (ok) claimed.push({ id: r.id, version: r.version, bookCode: r.bookCode, chapter: r.chapter, verse: r.verse, ref: r.ref });
  }
  return NextResponse.json({ claimed }, { headers: { "Cache-Control": "no-store" } });
}
