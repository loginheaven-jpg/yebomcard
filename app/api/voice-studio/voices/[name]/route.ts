/**
 * GET /api/voice-studio/voices/{이름} — 참조음 + 메타를 함께 내려준다 (기기 토큰).
 *
 * 새 PC 는 이걸 받아 voices/{이름}/ 에 그대로 쓴다. 참조 클립을 다시 자르지
 * 않으므로 PC 가 늘어도 음색이 흔들리지 않는다.
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { studioGetBytes, studioGetJson } from "@/lib/voiceStudio/r2";
import type { VoiceMeta } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "voice-studio/voices/";

export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  const { name: raw } = await ctx.params;
  const name = decodeURIComponent(raw || "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return NextResponse.json({ error: "보이스 이름이 올바르지 않습니다" }, { status: 400 });
  }

  const meta = await studioGetJson<VoiceMeta>(`${PREFIX}${name}/meta.json`);
  const wav = await studioGetBytes(`${PREFIX}${name}/ref.wav`);
  if (!meta || !wav) {
    return NextResponse.json({ error: `보이스 '${name}' 를 찾을 수 없습니다` }, { status: 404 });
  }

  return NextResponse.json(
    { meta, refWavBase64: wav.toString("base64") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
