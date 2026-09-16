/**
 * 생성 PC 현황 — 한 곳에 모아 어디서든 본다.
 *
 *   POST : 생성 PC 가 자기 상태를 보고한다(기기 토큰). 10초마다.
 *   GET  : 전체 현황을 본다. 관리자 세션 **또는 기기 토큰** — 기기 토큰도 읽게 두는 것은
 *          작업 PC 의 명령줄 도구(`voice/fleet_cli.py`)로 조회할 수 있어야 하기 때문이다.
 *          쓰는 것은 자기 자신뿐이라 다른 PC 의 상태를 망가뜨릴 수는 없다.
 *
 * 응답에 총계(total)를 함께 담는다 — PC 목록을 받아 클라이언트가 더하면 화면마다 같은 셈을
 * 되풀이하게 되고, 명령줄 도구에서도 쓰기 불편하다.
 */

import { NextResponse } from "next/server";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioR2Enabled } from "@/lib/voiceStudio/r2";
import {
  attentionOf,
  isStale,
  listLeases,
  listPcs,
  putPc,
  type FleetPc,
  type FleetBookProgress,
  type ReworkKind,
} from "@/lib/voiceStudio/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BOOKS = 80;

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

export async function POST(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }

  const books: FleetBookProgress[] = Array.isArray(body.books)
    ? (body.books as Record<string, unknown>[]).slice(0, MAX_BOOKS).map((b) => ({
        book: str(b.book, 40),
        total: num(b.total),
        done: num(b.done),
        held: num(b.held),
        uploaded: num(b.uploaded),
      }))
    : [];

  // 다시 만들 후보 — PC 가 보낸 것을 그대로 믿지 않고 모양과 개수를 맞춰 받는다
  const rework: Record<string, ReworkKind> = {};
  const rawRework = body.rework;
  if (rawRework && typeof rawRework === "object") {
    for (const [kind, v] of Object.entries(rawRework as Record<string, unknown>).slice(0, 8)) {
      const o = (v || {}) as Record<string, unknown>;
      rework[kind.slice(0, 32)] = {
        count: num(o.count),
        label: str(o.label, 60),
        items: (Array.isArray(o.items) ? o.items : []).slice(0, 50).map((x) => {
          const i = (x || {}) as Record<string, unknown>;
          return {
            ref: str(i.ref, 40),
            why: str(i.why, 60),
            code: str(i.code, 8),
            chapter: num(i.chapter),
            verse: num(i.verse),
          };
        }),
      };
    }
  }

  const pc: FleetPc = {
    // 토큰 id 는 **서버가 정한다** — PC 가 보낸 값을 믿으면 남의 자리를 덮어쓸 수 있다
    tokenId: gate.claims.id,
    label: str(body.label, 60) || str(body.host, 60) || gate.claims.id.slice(0, 8),
    host: str(body.host, 60),
    gpu: str(body.gpu, 80),
    codeVersion: str(body.codeVersion, 40),
    voice: str(body.voice, 40),
    voiceKey: str(body.voiceKey, 8),
    running: !!body.running,
    note: str(body.note, 200),
    jobId: str(body.jobId, 40) || null,
    jobTitle: str(body.jobTitle, 120),
    batch: num(body.batch),
    versesPerHour: num(body.versesPerHour),
    queued: num(body.queued),
    errorJobs: num(body.errorJobs),
    rework,
    pending: num(body.pending),
    okTotal: num(body.okTotal),
    heldTotal: num(body.heldTotal),
    uploadedTotal: num(body.uploadedTotal),
    books,
    polite: !!body.polite,
    leases: Array.isArray(body.leases)
      ? (body.leases as unknown[]).slice(0, MAX_BOOKS).map((b) => str(b, 40))
      : [],
    lastError: str(body.lastError, 300),
    at: new Date().toISOString(),
  };

  const ok = await putPc(pc);
  if (!ok) return NextResponse.json({ error: "보관소에 쓰지 못했습니다" }, { status: 502 });
  return NextResponse.json({ ok: true, tokenId: pc.tokenId });
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    const dev = await requireDevice(req);
    if (!dev.ok) return dev.res;
  }
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  const now = Date.now();
  const pcs = await listPcs();
  const leases = await listLeases();

  const live = pcs.filter((p) => !isStale(p, now));
  const total = {
    pcs: pcs.length,
    livePcs: live.length,
    running: live.filter((p) => p.running).length,
    pending: live.reduce((s, p) => s + p.pending, 0),
    ok: pcs.reduce((s, p) => s + p.okTotal, 0),
    held: pcs.reduce((s, p) => s + p.heldTotal, 0),
    uploaded: pcs.reduce((s, p) => s + p.uploadedTotal, 0),
    versesPerHour: live.reduce((s, p) => s + p.versesPerHour, 0),
    booksDone: leases.filter((l) => l.state === "done").length,
    booksTaken: leases.filter((l) => l.state === "taken" && l.tokenId).length,
  };

  return NextResponse.json({
    now: new Date(now).toISOString(),
    attention: attentionOf(pcs, total.held, now),
    total,
    pcs: pcs.map((p) => ({ ...p, stale: isStale(p, now) })),
    leases,
  });
}
