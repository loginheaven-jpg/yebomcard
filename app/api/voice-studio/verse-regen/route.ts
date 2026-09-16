/**
 * POST /api/voice-studio/verse-regen — 관리자가 고른 절의 음원 다시 만들기를 요청한다 (관리자 세션).
 * GET  /api/voice-studio/verse-regen — 요청 목록 (관리자 세션, 최신 먼저).
 *
 * 흐름·저장 구조는 lib/voiceStudio/verseRegen.ts 참조. 생성 PC 가 10분 안에 가져가 새로 만든다.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/voiceStudio/auth";
import { PREGENERATED_VOICE_KEYS } from "@/lib/tts/verseText";
import { createRegenRequests, listRegenRequests, MAX_VERSES_PER_REQUEST } from "@/lib/voiceStudio/verseRegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사전 생성 음원을 만드는 역본 — 새번역 하나다
const VERSION = "rnksv";

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  let body: {
    verses?: { bookCode?: string; chapter?: number; verse?: number }[];
    voiceKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const verses = (body.verses || []).map((v) => ({
    bookCode: String(v.bookCode || ""),
    chapter: Number(v.chapter),
    verse: Number(v.verse),
  }));
  // 성우 칸을 받는다 — 새 성우를 붙일 때 이 경로가 f4 에 못박혀 있으면 그 성우는 다시 만들 수가 없다
  const voiceKey = (body.voiceKey || PREGENERATED_VOICE_KEYS[0]).trim();
  if (!(PREGENERATED_VOICE_KEYS as readonly string[]).includes(voiceKey)) {
    return NextResponse.json({ error: `알 수 없는 성우 슬롯: '${voiceKey}'` }, { status: 400 });
  }
  if (verses.length === 0) return NextResponse.json({ error: "절을 고르세요" }, { status: 400 });
  if (verses.length > MAX_VERSES_PER_REQUEST) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_VERSES_PER_REQUEST}절까지` }, { status: 400 });
  }

  const created = await createRegenRequests(voiceKey, VERSION, verses, "관리자 요청", gate.session.email || "관리자");
  return NextResponse.json({ ok: true, created: created.length, refs: created.map((r) => r.ref) });
}

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  // 성우를 지정하지 않으면 첫 칸 — 지금은 사전 생성 성우가 하나뿐이라 그대로다
  const voiceKey = (new URL(req.url).searchParams.get("voiceKey") || PREGENERATED_VOICE_KEYS[0]).trim();
  const items = (await listRegenRequests(voiceKey))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    .slice(0, 200);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
