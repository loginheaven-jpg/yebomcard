/**
 * POST /api/voice-studio/verse-regen — 관리자가 고른 절의 음원 다시 만들기를 요청한다 (관리자 세션).
 * GET  /api/voice-studio/verse-regen — 요청 목록 (관리자 세션, 최신 먼저).
 *
 * 흐름·저장 구조는 lib/voiceStudio/verseRegen.ts 참조. 생성 PC 가 10분 안에 가져가 새로 만든다.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/voiceStudio/auth";
import { createRegenRequests, listRegenRequests, MAX_VERSES_PER_REQUEST } from "@/lib/voiceStudio/verseRegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사전 생성 음원이 있는 성우·역본 — 지금은 영희(f4) 새번역뿐
const VOICE_KEY = "f4";
const VERSION = "rnksv";

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  let body: { verses?: { bookCode?: string; chapter?: number; verse?: number }[] };
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
  if (verses.length === 0) return NextResponse.json({ error: "절을 고르세요" }, { status: 400 });
  if (verses.length > MAX_VERSES_PER_REQUEST) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_VERSES_PER_REQUEST}절까지` }, { status: 400 });
  }

  const created = await createRegenRequests(VOICE_KEY, VERSION, verses, "관리자 요청", gate.session.email || "관리자");
  return NextResponse.json({ ok: true, created: created.length, refs: created.map((r) => r.ref) });
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const items = (await listRegenRequests(VOICE_KEY))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    .slice(0, 200);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
