/**
 * POST /api/voice-studio/held/action — 보류 절에 대한 판단 실행 (관리자 세션).
 *
 *   use     : 들어보니 멀쩡하다 → 서버가 보관 중인 음원을 그대로 공유 캐시에 넣는다.
 *             **생성 PC 가 관여하지 않는다** — 그 PC 가 꺼져 있어도 즉시 반영된다.
 *   regen   : 진짜 오류다 → 재생성 요청을 남긴다. 해당 PC 가 가져가 다시 만든다.
 *   discard : 그냥 비워 둔다 → 그 절은 Chirp(여) 폴백으로 읽힌다.
 *
 * 판단이 필요한 이유는 held/route.ts 의 설명 참조 — 오탐과 진짜 오류를
 * 기계가 가르지 못한다(자모 비교는 오탐을 걷지만 어순 오류도 통과시킨다).
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/voiceStudio/auth";
import { studioGetBytes, studioPutJson, studioDelete, studioList } from "@/lib/voiceStudio/r2";
import { putR2Audio, getR2Audio } from "@/lib/tts/r2Cache";
import { cleanForTts, ttsCacheKey, PREGENERATED_VOICE_KEYS } from "@/lib/tts/verseText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELD = "voice-studio/held/";
const ACTIONS = "voice-studio/held-actions/";

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  let body: { id?: string; action?: string; voiceKey?: string; text?: string; device?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const { id, device } = body;
  const action = body.action;
  if (!id || !action || !["use", "regen", "discard"].includes(action)) {
    return NextResponse.json({ error: "id / action 이 올바르지 않습니다" }, { status: 400 });
  }

  if (action === "use") {
    const voiceKey = (body.voiceKey || "").trim();
    const text = body.text || "";
    if (!(PREGENERATED_VOICE_KEYS as readonly string[]).includes(voiceKey) || !text) {
      return NextResponse.json({ error: "voiceKey / text 가 필요합니다" }, { status: 400 });
    }
    // 음원은 보고한 PC 폴더 아래 있다 — device 를 모르면 찾아본다
    let mp3 = device ? await studioGetBytes(`${HELD}${device}/${id}.mp3`) : null;
    if (!mp3) {
      const hit = (await studioList(HELD)).find((k) => k.key.endsWith(`/${id}.mp3`));
      if (hit) mp3 = await studioGetBytes(hit.key);
    }
    if (!mp3) {
      return NextResponse.json(
        { error: "보관된 음원을 찾지 못했습니다 (재생성을 요청하세요)" },
        { status: 404 },
      );
    }
    const key = ttsCacheKey(cleanForTts(text), voiceKey, "ko");
    if (!(await getR2Audio(key))) {
      await putR2Audio(key, mp3, `voice:${voiceKey}`);
    }
  }

  const record = { id, action, by: gate.session.email || "관리자", at: new Date().toISOString() };
  const ok = await studioPutJson(`${ACTIONS}${id}.json`, record);
  if (!ok) return NextResponse.json({ error: "R2 저장 실패" }, { status: 500 });

  return NextResponse.json({ ok: true, action: record });
}

/** 판단 취소 — 다시 검수 대기로 되돌린다 */
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 가 필요합니다" }, { status: 400 });
  await studioDelete(`${ACTIONS}${id}.json`);
  return NextResponse.json({ ok: true });
}
