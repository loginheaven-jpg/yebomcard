/**
 * 절 음원 다시 만들기 요청 — 앱에서 관리자가 절을 골라 누르거나, 새번역 본문을 고쳐 저장하면 생긴다.
 *
 * 흐름
 *   관리자(앱) → POST /api/voice-studio/verse-regen          요청 기록(절마다 한 건)
 *   생성 PC   → POST /api/voice-studio/verse-regen/claim    먼저 가져가는 PC 가 맡는다(10분마다 확인)
 *   생성 PC   → POST /api/voice-studio/upload (requestId)   맡은 요청의 절은 새 방식 파일이라도 덮어쓴다
 *   생성 PC   → POST /api/voice-studio/verse-regen/done     완료, 또는 보류(받아쓰기 불합격 → 보류 절 검수)
 *
 * 왜 필요한가
 *   본문을 고치면 음원 열쇠(본문 해시)가 바뀌어 그 절은 대신 읽는 목소리로 넘어간다. 들어 보다가 잘못 만들어진
 *   절을 발견해도 한 절만 다시 만들 방법이 없었다(2026-09-11 롬 3:10·3:13, 욥 39:8).
 *
 * 저장: voice-studio/verse-regen/{voiceKey}/{book}.{chapter}.{verse}.json
 *   절마다 한 파일 — 같은 절을 다시 요청하면 '대기'로 되돌려 다시 만들게 한다.
 */
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { studioGetJson, studioList, studioPutJson } from "./r2";

export const REGEN_PREFIX = "voice-studio/verse-regen/";
/** 맡은 뒤 이만큼 지나도 완료 보고가 없으면 그 PC 가 멈춘 것으로 보고 다른 PC 가 다시 가져갈 수 있다 */
export const CLAIM_TTL_MS = 3 * 60 * 60 * 1000;
export const MAX_VERSES_PER_REQUEST = 50;

export type RegenStatus = "pending" | "claimed" | "done" | "held";

export interface VerseRegenRequest {
  /** "{voiceKey}/{book}.{chapter}.{verse}" */
  id: string;
  voiceKey: string;
  version: string;
  bookCode: string;
  bookName: string;
  chapter: number;
  verse: number;
  /** "로마서 3:10" */
  ref: string;
  testament: string;
  /** "관리자 요청" | "본문 수정" */
  reason: string;
  by: string;
  at: string;
  status: RegenStatus;
  claimedBy?: string;
  claimedAt?: string;
  doneAt?: string;
  detail?: string;
}

export function regenObjectKey(id: string): string {
  return `${REGEN_PREFIX}${id}.json`;
}

const ID_RE = /^[a-z0-9]+\/[a-z0-9]+\.\d+\.\d+$/;

export async function getRegenRequest(id: string): Promise<VerseRegenRequest | null> {
  if (!ID_RE.test(id)) return null;
  return studioGetJson<VerseRegenRequest>(regenObjectKey(id));
}

export async function putRegenRequest(r: VerseRegenRequest): Promise<boolean> {
  return studioPutJson(regenObjectKey(r.id), r);
}

/** 요청을 만든다 — 지금 DB 에 있는 절만. 같은 절이 이미 있으면 '대기'로 되돌린다. */
export async function createRegenRequests(
  voiceKey: string,
  version: string,
  verses: { bookCode: string; chapter: number; verse: number }[],
  reason: string,
  by: string,
): Promise<VerseRegenRequest[]> {
  const out: VerseRegenRequest[] = [];
  const now = new Date().toISOString();
  for (const v of verses.slice(0, MAX_VERSES_PER_REQUEST)) {
    const bookCode = String(v.bookCode || "").toLowerCase();
    const chapter = Number(v.chapter);
    const verse = Number(v.verse);
    if (!/^[a-z0-9]+$/.test(bookCode) || !Number.isInteger(chapter) || !Number.isInteger(verse)) continue;
    const { data } = await supabaseAdmin
      .from("bible_verses")
      .select("book_name, testament")
      .eq("version", version)
      .eq("book_code", bookCode)
      .eq("chapter", chapter)
      .eq("verse", verse)
      .maybeSingle();
    if (!data) continue;
    const bookName = String(data.book_name || bookCode);
    const rec: VerseRegenRequest = {
      id: `${voiceKey}/${bookCode}.${chapter}.${verse}`,
      voiceKey,
      version,
      bookCode,
      bookName,
      chapter,
      verse,
      ref: `${bookName} ${chapter}:${verse}`,
      testament: String(data.testament || ""),
      reason,
      by,
      at: now,
      status: "pending",
    };
    if (await putRegenRequest(rec)) out.push(rec);
  }
  return out;
}

export async function listRegenRequests(voiceKey: string): Promise<VerseRegenRequest[]> {
  const keys = await studioList(`${REGEN_PREFIX}${voiceKey}/`);
  const recs = await Promise.all(
    keys.filter((k) => k.key.endsWith(".json")).map((k) => studioGetJson<VerseRegenRequest>(k.key)),
  );
  return recs.filter((r): r is VerseRegenRequest => !!r && !!r.id);
}
