/**
 * GET /api/voice-studio/held/audio?id=…&device=… — 보류 절 음원 듣기 (관리자 세션).
 *
 * 판단의 마지막 단계는 결국 **듣는 것**이다. 원문·ASR 만으로는 애매한 경우가 있어
 * 관리자 화면에서 바로 재생할 수 있어야 한다.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/voiceStudio/auth";
import { studioGetBytes, studioList } from "@/lib/voiceStudio/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELD = "voice-studio/held/";

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const device = url.searchParams.get("device") || "";
  if (!/^[0-9a-f]{40}$/.test(id)) {
    return NextResponse.json({ error: "id 가 올바르지 않습니다" }, { status: 400 });
  }

  let mp3 = device && /^[0-9a-f]{1,32}$/.test(device)
    ? await studioGetBytes(`${HELD}${device}/${id}.mp3`)
    : null;
  if (!mp3) {
    const hit = (await studioList(HELD)).find((k) => k.key.endsWith(`/${id}.mp3`));
    if (hit) mp3 = await studioGetBytes(hit.key);
  }
  if (!mp3) return NextResponse.json({ error: "음원을 찾을 수 없습니다" }, { status: 404 });

  return new NextResponse(new Uint8Array(mp3), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
