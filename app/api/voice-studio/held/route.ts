/**
 * 보류 절 중앙 검수 — 어느 PC 에서 만들었든 한 곳에서 듣고 판단한다.
 *
 *   POST : 생성 PC 가 자기 보류 목록을 보고한다 (기기 토큰).
 *          음원은 목록에 싣지 않는다 — 응답의 missingAudio 를 보고 PC 가 held/audio 로 한 건씩 올린다.
 *          (전부 실어 보내면 보류 스무 개 남짓에서 요청 한도 4.5MB 를 넘어 보고 전체가 거절됐다)
 *   GET  : 관리자가 전체 보류 목록을 본다 (관리자 세션)
 *
 * 왜 필요한가
 *   검수는 자동이지만 **판단은 자동화되지 않는다**. "욥이 대답하였다"가 71% 로
 *   떨어진 건 ASR 이 "요비"로 들은 오탐이고, 욥기 39:8 의 67% 는 어순이 뒤바뀐
 *   진짜 오류다. 소리(자모)로 비교하면 오탐은 걷히지만 39:8 도 88%로 통과해버려
 *   진짜 오류를 놓친다 — 그래서 마지막 판단은 사람이 듣고 해야 한다.
 *
 *   PC 가 여러 대가 되면 그 판단거리가 각 PC 의 jobs/*.json 안에 흩어져 아무도
 *   못 본다. 여기로 모아 한 화면에서 처리한다.
 *
 * 저장 구조 (동시 쓰기 충돌을 피하려고 쓰는 주체별로 파일을 나눈다)
 *   voice-studio/held/{토큰id}/index.json   ← 그 PC 만 쓴다
 *   voice-studio/held/{토큰id}/{항목id}.mp3 ← 들어보기용
 *   voice-studio/held-actions/{항목id}.json ← 관리자만 쓴다
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioList, studioGetJson, studioPutBytes, studioPutJson } from "@/lib/voiceStudio/r2";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getBookByName } from "@/lib/books";
import { cleanForTts } from "@/lib/tts/verseText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELD = "voice-studio/held/";
const ACTIONS = "voice-studio/held-actions/";
const MAX_MP3_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 500;

export interface HeldItem {
  /** 항목 id — 성우+본문으로 정해지므로 PC 가 달라도 같은 절은 같은 id */
  id: string;
  voiceKey: string;
  voice: string;
  /** "욥기 39:8" */
  ref: string;
  book: string;
  text: string;
  /** ASR 이 받아쓴 것 — 원문과 나란히 봐야 판단이 된다 */
  asr: string;
  ratio: number;
  reason: string;
  audioSec: number;
  tries: number;
  /** 보고한 PC (토큰 id) */
  device: string;
  reportedAt: string;
  /** 들어보기용 음원이 함께 올라왔는지 */
  hasAudio: boolean;
  /**
   * 생성 방식 — "ns1"(본문 통째로 넣기, 2026-09-10~). 비었거나 없으면 구방식 음원이다.
   * 구방식 음원을 '이대로 사용'하면 동결 시각 뒤에 올라가 새 방식 파일로 분류되고, 교체에서 빠진다.
   */
  method?: string;
}

export interface HeldAction {
  id: string;
  action: "use" | "regen" | "discard";
  by: string;
  at: string;
  /** regen 을 PC 가 처리했으면 true */
  done?: boolean;
}

// 구분자는 NUL(\0) — 성우 슬롯과 본문이 이어 붙어 다른 조합과 겹치지 않게. 예전엔 소스에 NUL 문자가
// 그대로 박혀 공백처럼 보였고, PC(server.py)가 공백으로 흉내 내다 짝이 안 맞았다(2026-09-11).
export function heldId(voiceKey: string, text: string): string {
  return crypto.createHash("sha1").update(`${voiceKey}\0${text}`, "utf8").digest("hex");
}

// ───────────────────────── 생성 PC → 서버 ─────────────────────────
export async function POST(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  let body: {
    voice?: string;
    voiceKey?: string;
    items?: {
      ref?: string;
      book?: string;
      text?: string;
      asr?: string;
      ratio?: number;
      reason?: string;
      audioSec?: number;
      tries?: number;
      mp3Base64?: string;
      method?: string;
      /** 보류 음원 파일의 표지(크기-수정시각). 서버가 받아 둔 표지와 다르면 음원을 다시 받는다 */
      stamp?: string;
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const voiceKey = (body.voiceKey || "").trim();
  const voice = (body.voice || "").trim();
  const items = body.items || [];
  if (!voiceKey || !voice) {
    return NextResponse.json({ error: "voice / voiceKey 가 필요합니다" }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_ITEMS}건` }, { status: 400 });
  }

  const device = gate.claims.id;
  const now = new Date().toISOString();
  const index: HeldItem[] = [];

  // 이 PC 폴더에 이미 올라와 있는 음원 — 목록 보고에 음원을 싣지 않아도 '들어보기'가 되게 한다
  const devPrefix = `${HELD}${device}/`;
  const haveAudio = new Set(
    (await studioList(devPrefix))
      .filter((k) => k.key.endsWith(".mp3"))
      .map((k) => k.key.slice(devPrefix.length, -".mp3".length)),
  );
  // 받아 둔 음원의 표지 — 같은 절(같은 id)을 다시 만들면 표지가 달라진다. 예전엔 id 만 보고 '있음'으로
  // 여겨, 다시 보류된 절의 **옛 음원**이 계속 재생되고 '이대로 사용'이 그것을 올릴 뻔했다(욥 39:8).
  const stamps = (await studioGetJson<Record<string, string>>(`${devPrefix}stamps.json`)) || {};

  // 음원이 없는 항목을 **보낸 목록의 위치**로도 알려 준다. PC 가 id 를 따로 계산해 짝을 맞추면
  // 규칙이 조금만 어긋나도 아무것도 안 올라간다 — 2026-09-11 실제로 그랬다.
  const missingAudioIndex: number[] = [];

  for (const [pos, it] of items.entries()) {
    if (!it.text?.trim() || !it.ref) continue;
    const id = heldId(voiceKey, it.text);
    // 표지를 보낸 PC 는 표지가 같을 때만 '있음'. 표지가 없는 옛 PC 코드는 예전처럼 id 만 본다.
    let hasAudio = haveAudio.has(id) && (!it.stamp || stamps[id] === it.stamp);

    // 옛 PC 코드는 음원을 목록에 실어 보낸다 — 계속 받는다
    if (it.mp3Base64) {
      const mp3 = Buffer.from(it.mp3Base64, "base64");
      if (mp3.length > 0 && mp3.length <= MAX_MP3_BYTES) {
        hasAudio = (await studioPutBytes(`${HELD}${device}/${id}.mp3`, mp3, "audio/mpeg")) || hasAudio;
      }
    }
    if (!hasAudio) missingAudioIndex.push(pos);

    index.push({
      id,
      voiceKey,
      voice,
      ref: it.ref,
      book: it.book || it.ref.split(" ")[0] || "",
      text: it.text,
      asr: it.asr || "",
      ratio: typeof it.ratio === "number" ? it.ratio : 0,
      reason: it.reason || "",
      audioSec: typeof it.audioSec === "number" ? it.audioSec : 0,
      tries: typeof it.tries === "number" ? it.tries : 0,
      device,
      reportedAt: now,
      hasAudio,
      method: typeof it.method === "string" ? it.method.slice(0, 16) : "",
    });
  }

  // 이 PC 의 목록을 통째로 갈아끼운다 — 재생성으로 해결된 절은 목록에서 빠져야 한다
  const ok = await studioPutJson(`${HELD}${device}/index.json`, { device, at: now, items: index });
  if (!ok) {
    return NextResponse.json({ error: "R2 저장 실패" }, { status: 500 });
  }
  // 서버에 음원이 없는 항목 — PC 가 held/audio 로 한 건씩 올린다 (위치로 짝을 맞춘다)
  const missingAudio = index.filter((i) => !i.hasAudio).map((i) => i.id);
  return NextResponse.json({ ok: true, reported: index.length, missingAudio, missingAudioIndex });
}

// ───────────────────────── 관리자 화면 ─────────────────────────

/**
 * 판단이 낡았는가 — 보류된 뒤에 본문이 바뀌었으면 그 판단은 더 이상 유효하지 않다.
 *
 * 2026-09-09 에 새번역 327절의 주석·소제목 잔재를 정정했다. 그 절들은 생성 PC 의 작업
 * 파일에 **정정 이전 본문**으로 남아 있어서, PC 가 보고를 갱신할 때마다 "주석 잔재 의심"
 * 보류가 되살아난다. 목록에서 지워도 다음 보고에 돌아온다 — PC 목록을 통째로 갈아끼우기
 * 때문이다(server.report_held).
 *
 * 그래서 **보여줄 때 거른다.** 지금 DB 본문과 다른 본문으로 내려진 판단은 감춘다.
 * 그 절은 정정된 본문으로 다시 만들어지므로 사람이 손댈 일이 없다.
 *
 * 본문이 그대로인 보류(진짜 ASR 오인식)는 그대로 남는다 — 그것이 사람이 할 일이다.
 */
async function dropStale(items: HeldItem[]): Promise<{ fresh: HeldItem[]; stale: number }> {
  // ref "출애굽기 3:22" → 책별로 묶어 장 단위로 한 번씩만 조회한다
  const want = new Map<string, { chapters: Set<number>; refs: Map<string, HeldItem[]> }>();
  const unparsed: HeldItem[] = [];
  for (const it of items) {
    const m = /^(.+)\s+(\d+):(\d+)$/.exec(it.ref || "");
    const book = m ? getBookByName(m[1].trim()) : undefined;
    if (!m || !book) {
      unparsed.push(it); // 해석 못 하면 감추지 않는다 — 감추는 쪽이 위험하다
      continue;
    }
    const e = want.get(book.code) || { chapters: new Set<number>(), refs: new Map() };
    e.chapters.add(Number(m[2]));
    const k = `${m[2]}:${m[3]}`;
    e.refs.set(k, [...(e.refs.get(k) || []), it]);
    want.set(book.code, e);
  }

  const norm = (t: string) => (t || "").replace(/\s+/g, "");
  const fresh: HeldItem[] = [...unparsed];
  let stale = 0;

  await Promise.all(
    [...want.entries()].map(async ([code, e]) => {
      const { data, error } = await supabaseAdmin
        .from("bible_verses")
        .select("chapter, verse, text")
        .eq("version", "rnksv")
        .eq("book_code", code)
        .in("chapter", [...e.chapters]);
      if (error || !data) {
        // 조회에 실패하면 감추지 않는다 — 조회 실패로 할 일이 사라지면 안 된다
        for (const list of e.refs.values()) fresh.push(...list);
        return;
      }
      const now = new Map(data.map((r) => [`${r.chapter}:${r.verse}`, r.text as string]));
      for (const [k, list] of e.refs) {
        const cur = now.get(k);
        for (const it of list) {
          // 생성기는 편집자 주석 "(주: …)" 을 뗀 본문을 들고 있다(engine.get_book_verses). DB 원문도
          // 똑같이 떼고 비교해야 한다 — 예전엔 원문 그대로 비교해서 **주석이 달린 절의 보류는 늘
          // '본문 바뀜'으로 감춰졌다**(2026-09-11, 신 19:6 등 8절).
          if (cur !== undefined && norm(cleanForTts(cur)) !== norm(it.text)) stale++;
          else fresh.push(it);
        }
      }
    }),
  );
  return { fresh, stale };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const keys = await studioList(HELD);
  const indexes = keys.filter((k) => k.key.endsWith("/index.json"));

  // 음원은 목록과 따로 올라온다(held/audio) — 들을 수 있는지는 실제 파일로 판단한다
  const audioKeys = new Set(
    keys.filter((k) => k.key.endsWith(".mp3")).map((k) => k.key.slice(HELD.length, -".mp3".length)),
  );
  const reported: HeldItem[] = [];
  for (const k of indexes) {
    const data = await studioGetJson<{ items?: HeldItem[] }>(k.key);
    for (const it of data?.items || []) {
      reported.push({ ...it, hasAudio: it.hasAudio || audioKeys.has(`${it.device}/${it.id}`) });
    }
  }
  // 본문이 바뀐 뒤에 남은 판단은 감춘다 (아래 dropStale 설명 참조)
  const { fresh: items, stale } = await dropStale(reported);

  const actionKeys = await studioList(ACTIONS);
  const actions: Record<string, HeldAction> = {};
  for (const k of actionKeys) {
    const a = await studioGetJson<HeldAction>(k.key);
    if (a?.id) actions[a.id] = a;
  }

  // 판단 안 된 것이 위로 — 이게 사람이 할 일이다
  items.sort((a, b) => {
    const ua = actions[a.id] ? 1 : 0;
    const ub = actions[b.id] ? 1 : 0;
    if (ua !== ub) return ua - ub;
    return a.ref.localeCompare(b.ref, "ko");
  });

  return NextResponse.json(
    {
      items,
      actions,
      pending: items.filter((i) => !actions[i.id]).length,
      /** 본문이 정정되어 더 볼 필요가 없어진 보류 수 */
      stale,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
