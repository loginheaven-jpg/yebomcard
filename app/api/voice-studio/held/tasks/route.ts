/**
 * GET /api/voice-studio/held/tasks — 이 PC 가 다시 만들어야 할 절 (기기 토큰).
 *
 * 관리자가 "재생성 요청"을 누르면 여기 나타난다. 생성 PC 는 작업 도중 주기적으로
 * 확인해 해당 절을 다시 만든다 — 관리자가 PC 앞에 갈 필요가 없다.
 *
 * 재생성에 성공하면 그 절은 그 PC 의 보류 목록에서 빠지고 자동 업로드된다.
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { studioList, studioGetJson } from "@/lib/voiceStudio/r2";
import type { HeldItem, HeldAction } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELD = "voice-studio/held/";
const ACTIONS = "voice-studio/held-actions/";

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  const device = gate.claims.id;
  const index = await studioGetJson<{ items?: HeldItem[] }>(`${HELD}${device}/index.json`);
  const mine = index?.items || [];
  if (mine.length === 0) return NextResponse.json({ regenerate: [] });

  const actionKeys = await studioList(ACTIONS);
  const wanted = new Set(
    actionKeys
      .map((k) => k.key.slice(ACTIONS.length).replace(/\.json$/, ""))
      .filter(Boolean),
  );

  const regenerate: { id: string; ref: string; text: string }[] = [];
  for (const it of mine) {
    if (!wanted.has(it.id)) continue;
    const a = await studioGetJson<HeldAction>(`${ACTIONS}${it.id}.json`);
    if (a?.action === "regen") regenerate.push({ id: it.id, ref: it.ref, text: it.text });
  }

  return NextResponse.json({ regenerate }, { headers: { "Cache-Control": "no-store" } });
}
