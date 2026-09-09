/**
 * GET /api/voice-studio/cache-index?voiceKey=f4 — 이미 만들어진 절의 목록 (기기 토큰).
 *
 * 생성 PC 가 책 하나를 시작할 때 한 번 물어보고, 이미 있는 절은 건너뛴다.
 * PC 를 몇 대로 늘리든 같은 절을 두 번 만들지 않게 하는 장치다.
 *
 * 왜 "있는지 하나씩 묻기"가 아니라 "목록 통째로" 인가
 *   절마다 물으면 왕복이 수만 번이라 느리다. 공유 캐시 키가 본문 sha1 이므로
 *   존재하는 키 목록만 받아오면 로컬에서 대조할 수 있다 — 왕복 한 번이면 끝난다.
 *
 * 응답은 해시를 줄바꿈으로 이은 평문이다(JSON 배열보다 가볍고 파싱이 싸다).
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { studioList } from "@/lib/voiceStudio/r2";
import { TTS_CACHE_VERSION, PREGENERATED_VOICE_KEYS } from "@/lib/tts/verseText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  const voiceKey = (new URL(req.url).searchParams.get("voiceKey") || "").trim();
  if (!(PREGENERATED_VOICE_KEYS as readonly string[]).includes(voiceKey)) {
    return NextResponse.json(
      { error: `알 수 없는 성우 슬롯: '${voiceKey}'` },
      { status: 400 },
    );
  }

  const prefix = `tts/${TTS_CACHE_VERSION}/ko/${voiceKey}/`;
  const keys = await studioList(prefix);
  const hashes = keys
    .map((k) => k.key.slice(prefix.length).replace(/\.mp3$/, ""))
    .filter((h) => /^[0-9a-f]{40}$/.test(h));

  return new NextResponse(hashes.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Count": String(hashes.length),
    },
  });
}
