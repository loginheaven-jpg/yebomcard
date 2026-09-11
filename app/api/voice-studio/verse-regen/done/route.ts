/**
 * POST /api/voice-studio/verse-regen/done — 맡은 음원 다시 만들기 요청의 결과를 알린다 (기기 토큰).
 *
 *   done — 새로 만들어 올렸다(기존 음원을 덮어씀)
 *   held — 받아쓰기 불합격 등으로 보류됐다 → 관리자 화면 '보류 절 검수'에서 판단한다
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { getRegenRequest, putRegenRequest } from "@/lib/voiceStudio/verseRegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  let body: { id?: string; status?: string; detail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const status = body.status === "held" ? "held" : body.status === "done" ? "done" : null;
  if (!body.id || !status) {
    return NextResponse.json({ error: "id / status 가 올바르지 않습니다" }, { status: 400 });
  }
  const rec = await getRegenRequest(body.id);
  if (!rec) return NextResponse.json({ error: "요청을 찾지 못했습니다" }, { status: 404 });
  // 그 사이 관리자가 같은 절을 다시 요청했으면('대기'로 되돌아감) 덮어쓰지 않는다 — 새 요청이 처리돼야 한다
  if (rec.status === "pending") return NextResponse.json({ ok: true, ignored: "다시 요청됨" });

  await putRegenRequest({
    ...rec,
    status,
    doneAt: new Date().toISOString(),
    detail: (body.detail || "").slice(0, 200),
  });
  return NextResponse.json({ ok: true });
}
