/**
 * GET /api/voice-studio/config — 설치된 PC 가 시작할 때 받아가는 설정.
 *
 * 여기서 내려주는 것 덕분에 로컬 PC 에 `.env.local` 을 복사할 필요가 없다.
 * 성경 본문 조회에 쓰는 Supabase 키는 **공개 anon 키**(이미 브라우저 번들에 들어 있다)라
 * 기기 토큰 뒤에 두는 것으로 충분하다. R2·ElevenLabs 같은 진짜 비밀키는
 * 절대 내려보내지 않는다 — 업로드는 서버를 거치게 해서 로컬에 키가 남지 않게 한다.
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { TTS_CACHE_VERSION, PREGENERATED_VOICE_KEYS } from "@/lib/tts/verseText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  return NextResponse.json(
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      ttsCacheVersion: TTS_CACHE_VERSION,
      voiceKeys: PREGENERATED_VOICE_KEYS,
      issuedTo: gate.claims.sub,
      tokenId: gate.claims.id,
      tokenExpires: new Date(gate.claims.exp * 1000).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
