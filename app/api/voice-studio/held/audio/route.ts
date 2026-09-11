/**
 * GET  /api/voice-studio/held/audio?id=…&device=… — 보류 절 음원 듣기 (관리자 세션).
 * POST /api/voice-studio/held/audio — 생성 PC 가 보류 절 음원 하나를 올린다 (기기 토큰).
 *
 * 판단의 마지막 단계는 결국 **듣는 것**이다. 원문·ASR 만으로는 애매한 경우가 있어
 * 관리자 화면에서 바로 재생할 수 있어야 한다.
 *
 * 음원을 목록 보고(held POST)와 따로 받는 이유: 목록에 전부 실으면 보류 스무 개 남짓에서
 * 요청이 서버 한도(4.5MB)를 넘어 보고 전체가 거절됐다. 목록은 가볍게, 음원은 없는 것만 한 건씩.
 */

import { NextResponse } from "next/server";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioGetBytes, studioGetJson, studioList, studioPutBytes, studioPutJson } from "@/lib/voiceStudio/r2";
import { heldId } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELD = "voice-studio/held/";
const MAX_MP3_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  let body: { voiceKey?: string; text?: string; mp3Base64?: string; stamp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const voiceKey = (body.voiceKey || "").trim();
  const text = body.text || "";
  if (!voiceKey || !text.trim() || !body.mp3Base64) {
    return NextResponse.json({ error: "voiceKey / text / mp3Base64 가 필요합니다" }, { status: 400 });
  }
  const mp3 = Buffer.from(body.mp3Base64, "base64");
  if (mp3.length === 0 || mp3.length > MAX_MP3_BYTES) {
    return NextResponse.json({ error: `크기 이상 (${mp3.length} bytes)` }, { status: 400 });
  }
  // id 는 목록 보고와 같은 규칙으로 서버가 정한다 — 그래야 목록 항목과 음원이 짝지어진다
  const id = heldId(voiceKey, text);
  const ok = await studioPutBytes(`${HELD}${gate.claims.id}/${id}.mp3`, mp3, "audio/mpeg");
  if (!ok) return NextResponse.json({ error: "R2 저장 실패" }, { status: 500 });
  // 음원이 실제로 올라간 뒤에만 표지를 적는다 — 목록 보고(held POST)가 이것과 비교해 바뀐 음원을 다시 받는다.
  // PC 는 음원을 한 건씩 차례로 올리므로 읽고-고쳐-쓰기가 겹치지 않는다.
  if (typeof body.stamp === "string" && body.stamp) {
    const key = `${HELD}${gate.claims.id}/stamps.json`;
    const stamps = (await studioGetJson<Record<string, string>>(key)) || {};
    stamps[id] = body.stamp.slice(0, 64);
    await studioPutJson(key, stamps);
  }
  return NextResponse.json({ ok: true, id });
}

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
