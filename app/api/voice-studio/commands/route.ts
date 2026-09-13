/**
 * 생성 PC 에 보내는 지시 — 한 줄로 걸고, PC 가 10초 안에 가져간다.
 *
 *   POST   : 명령을 건다(관리자 세션 또는 기기 토큰). 기기 토큰도 열어 두는 것은
 *            작업 PC 의 명령줄 도구(`voice/fleet_cli.py`)에서 지시하기 위해서다.
 *   GET    : 내게 온 미처리 명령을 가져간다(기기 토큰) — `?mine=1`.
 *            관리자·기기 토큰은 `?all=1` 로 전체 목록(화면 표시용)을 본다.
 *   PATCH  : 처리 결과를 적는다(기기 토큰). 관리자는 `cancel` 로 취소한다.
 *
 * 왜 PC 가 가져가는 방식인가
 *   생성 PC 는 집·사무실 안에 있어 서버가 먼저 연결할 수 없다. 보류 절 재생성 요청
 *   (`verse-regen`)과 같은 방식이다 — PC 가 주기적으로 물어보고 가져간다.
 *
 * 같은 명령을 두 번 처리하지 않게
 *   PC 는 자기 id 를 takenBy 에 올리고, 그 뒤 자기가 올린 명령만 처리한다. target 이 "*" 인
 *   명령은 여러 대가 각자 한 번씩 집는다(takenBy 에 쌓인다).
 */

import { NextResponse } from "next/server";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioR2Enabled } from "@/lib/voiceStudio/r2";
import {
  CLAIM_WINDOW_MS,
  commandId,
  listCommands,
  pruneCommands,
  putCommand,
  type CommandOp,
  type FleetCommand,
} from "@/lib/voiceStudio/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPS: CommandOp[] = [
  "queue_books",
  "queue_replace",
  "stop",
  "resume",
  "set_batch",
  "delete_job",
  "regen_refs",
  "restart",
];

export async function POST(req: Request) {
  const admin = await requireAdmin();
  let by = "";
  if (admin.ok) by = admin.session.email || "관리자";
  else {
    const dev = await requireDevice(req);
    if (!dev.ok) return dev.res;
    by = `pc:${dev.claims.id.slice(0, 8)}`;
  }
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }

  const op = body.op as CommandOp;
  if (!OPS.includes(op)) {
    return NextResponse.json({ error: `모르는 명령입니다: ${String(body.op)}` }, { status: 400 });
  }
  const target = typeof body.target === "string" && body.target ? body.target.slice(0, 64) : "*";
  const args =
    body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};

  const cmd: FleetCommand = {
    id: commandId(),
    target,
    op,
    args,
    by,
    createdAt: new Date().toISOString(),
    status: "pending",
    takenBy: [],
    doneBy: [],
    result: "",
  };
  const ok = await putCommand(cmd);
  if (!ok) return NextResponse.json({ error: "보관소에 쓰지 못했습니다" }, { status: 502 });
  return NextResponse.json({ ok: true, id: cmd.id });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";

  let myId = "";
  if (mine) {
    const dev = await requireDevice(req);
    if (!dev.ok) return dev.res;
    myId = dev.claims.id;
  } else {
    const admin = await requireAdmin();
    if (!admin.ok) {
      const dev = await requireDevice(req);
      if (!dev.ok) return dev.res;
    }
  }
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  const all = await pruneCommands(await listCommands());
  if (!mine) return NextResponse.json({ commands: all });

  // 내게 온 미처리 명령을 집어 간다 — 집었다는 표시를 먼저 남긴다(두 번 처리 방지).
  //
  // 두 번 처리하지 않게 막는 것은 **takenBy** 다(PC 마다 한 번). status 로 막지 않는다 —
  // 모든 PC 대상("*") 명령은 먼저 끝낸 한 대가 status 를 done 으로 바꾸면 나머지가 영영
  // 못 집는다(2026-09-14: 두 대에 건 '다시 켜기' 가 한 대에서만 돌았다).
  const now = Date.now();
  const taken: FleetCommand[] = [];
  for (const c of all) {
    if (c.status === "cancelled") continue;
    if (c.target === "*" ? false : c.status !== "pending") continue;
    if (c.target !== "*" && c.target !== myId) continue;
    if (c.takenBy.includes(myId)) continue;
    // 묵은 지시는 집지 않는다 — 며칠 뒤 켜진 PC 가 옛 '멈춤' 을 뒤늦게 실행하면 안 된다
    const age = now - Date.parse(c.createdAt);
    if (!Number.isFinite(age) || age > CLAIM_WINDOW_MS) continue;
    c.takenBy = [...c.takenBy, myId];
    if (await putCommand(c)) taken.push(c);
  }
  return NextResponse.json({ commands: taken });
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  let myId = "";
  if (!admin.ok) {
    const dev = await requireDevice(req);
    if (!dev.ok) return dev.res;
    myId = dev.claims.id;
  }
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = body.status as FleetCommand["status"];
  if (!id || !["done", "failed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "id 와 status 가 필요합니다" }, { status: 400 });
  }
  if (status === "cancelled" && !admin.ok) {
    return NextResponse.json({ error: "취소는 관리자만 할 수 있습니다" }, { status: 403 });
  }

  const all = await listCommands();
  const cmd = all.find((c) => c.id === id);
  if (!cmd) return NextResponse.json({ error: "그 명령이 없습니다" }, { status: 404 });

  // 모든 PC 대상 명령은 한 대가 끝냈다고 통째로 끝난 것이 아니다 — 몇 대가 받을지 서버는 모른다.
  // 그래서 status 는 pending 그대로 두고(취소만 예외) 보고한 PC 를 doneBy 에 쌓는다.
  // 다시 집히는 것은 takenBy 가 막고, 묵은 명령은 CLAIM_WINDOW_MS 가 막는다.
  if (cmd.target !== "*" || status === "cancelled") cmd.status = status;
  if (myId && !cmd.doneBy.includes(myId)) cmd.doneBy = [...(cmd.doneBy || []), myId];
  cmd.doneAt = new Date().toISOString();
  const who = myId ? myId.slice(0, 8) : "관리자";
  const detail = typeof body.result === "string" ? body.result.slice(0, 300) : "";
  cmd.result = [cmd.result, `${who}: ${detail || status}`].filter(Boolean).join(" · ").slice(0, 600);
  const ok = await putCommand(cmd);
  if (!ok) return NextResponse.json({ error: "보관소에 쓰지 못했습니다" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
