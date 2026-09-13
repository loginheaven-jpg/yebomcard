/**
 * GET /api/voice-studio/progress?voiceKey=f4 — **성경 전체 중 몇 절을 만들었나**, 책별로.
 *
 * 왜 따로 두는가
 *   `fleet` 의 '남은 절' 은 지금 각 PC 에 **걸린 작업** 기준이라, 아직 작업조차 걸리지 않은 책은
 *   세지 않는다. 새 성우로 처음부터 만들 때 정작 궁금한 것은 "성경 전체 중 얼마나 왔나" 다.
 *
 * 왜 누를 때만 재는가 (2026-09-13 지휘부 지시)
 *   본문 3만 절을 읽어 정제하고 sha1 을 떠서 보관소 목록과 맞춰야 해서 가볍지 않다.
 *   **다만 이 셈은 서버가 한다 — 생성 PC 의 GPU 는 전혀 건드리지 않으므로 작업 속도와 무관하다.**
 *   그래도 몇 초가 걸리므로 실시간으로 계속 다시 재지 않고, 부를 때 그 시점 스냅샷을 만들어
 *   CACHE_MS 동안 돌려 쓴다. 응답의 `at` 이 언제 잰 값인지 말해 준다.
 *
 * 셈법
 *   음원 파일 이름이 곧 **정제 본문의 sha1** 이다(공유 캐시 키). 그래서 절 하나하나를 물을 필요 없이,
 *   보관소의 해시 집합과 본문에서 뜬 해시를 맞추면 된다. 본문이 같은 절은 파일도 하나다 —
 *   책별 '만든 절' 은 그 책에서 해시가 보관소에 있는 절 수이므로, 절 수로 세면 사람이 기대하는 값이 된다.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioList } from "@/lib/voiceStudio/r2";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { BOOKS } from "@/lib/books";
import { cleanForTts, TTS_CACHE_VERSION, PREGENERATED_VOICE_KEYS } from "@/lib/tts/verseText";
import { isLegacyFile, keyHash } from "@/lib/voiceStudio/legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 낭독 대상 역본 — 사전 생성은 새번역만 한다 */
const VERSION = "rnksv";
/** 한 번 잰 값을 이만큼 돌려 쓴다. 그 사이 다시 부르면 같은 스냅샷이 온다 */
const CACHE_MS = 60_000;
/** Supabase 한 번에 가져오는 행 수 — 기본 상한(1000)에 걸리지 않게 직접 나눠 읽는다 */
const PAGE = 2000;

interface BookRow {
  code: string;
  name: string;
  testament: "old" | "new";
  order: number;
  total: number;
  done: number;
  legacy: number;
}
interface Snapshot {
  voiceKey: string;
  version: string;
  at: string;
  tookMs: number;
  total: number;
  done: number;
  legacy: number;
  books: BookRow[];
}

const cache = new Map<string, { at: number; snap: Snapshot }>();

async function build(voiceKey: string): Promise<Snapshot> {
  const t0 = Date.now();

  // 1) 보관소에 있는 해시 — 구방식(다시 만들어야 할 것)도 따로 센다
  const prefix = `tts/${TTS_CACHE_VERSION}/ko/${voiceKey}/`;
  const have = new Set<string>();
  const legacyHashes = new Set<string>();
  for (const k of await studioList(prefix)) {
    const h = keyHash(k.key);
    if (!/^[0-9a-f]{40}$/.test(h)) continue;
    have.add(h);
    if (isLegacyFile(voiceKey, h, k.lastModified)) legacyHashes.add(h);
  }

  // 2) 본문을 훑으며 책별로 센다
  const rows = new Map<string, BookRow>();
  for (const b of BOOKS) {
    rows.set(b.code, {
      code: b.code,
      name: b.nameKr,
      testament: b.testament,
      order: b.order,
      total: 0,
      done: 0,
      legacy: 0,
    });
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("bible_verses")
      .select("book_code, text")
      .eq("version", VERSION)
      .order("book_code")
      .order("chapter")
      .order("verse")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const v of data as { book_code: string; text: string }[]) {
      const r = rows.get(v.book_code);
      if (!r) continue;
      r.total += 1;
      const h = crypto.createHash("sha1").update(cleanForTts(v.text || "")).digest("hex");
      if (have.has(h)) {
        r.done += 1;
        if (legacyHashes.has(h)) r.legacy += 1;
      }
    }
    if (data.length < PAGE) break;
  }

  const books = [...rows.values()].filter((r) => r.total > 0).sort((a, b) => a.order - b.order);
  return {
    voiceKey,
    version: VERSION,
    at: new Date().toISOString(),
    tookMs: Date.now() - t0,
    total: books.reduce((s, r) => s + r.total, 0),
    done: books.reduce((s, r) => s + r.done, 0),
    legacy: books.reduce((s, r) => s + r.legacy, 0),
    books,
  };
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    const dev = await requireDevice(req);
    if (!dev.ok) return dev.res;
  }

  const url = new URL(req.url);
  const voiceKey = (url.searchParams.get("voiceKey") || PREGENERATED_VOICE_KEYS[0]).trim();
  if (!(PREGENERATED_VOICE_KEYS as readonly string[]).includes(voiceKey)) {
    return NextResponse.json({ error: `알 수 없는 성우 슬롯: '${voiceKey}'` }, { status: 400 });
  }

  const fresh = url.searchParams.get("fresh") === "1";
  const hit = cache.get(voiceKey);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json({ ...hit.snap, cached: true });
  }

  try {
    const snap = await build(voiceKey);
    cache.set(voiceKey, { at: Date.now(), snap });
    return NextResponse.json({ ...snap, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: `진도를 재지 못했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
