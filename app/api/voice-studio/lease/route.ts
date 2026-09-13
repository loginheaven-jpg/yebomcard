/**
 * 책 임대 — PC 여러 대가 같은 절을 두 번 만들지 않게 한다.
 *
 *   POST  : PC 가 "이 순서 중에 내가 가져가도 되는 책"을 묻고 빌린다(기기 토큰).
 *           반납(release)·완료(done) 보고도 같은 경로.
 *   GET   : 임대 현황을 본다(관리자 세션 또는 기기 토큰).
 *   PATCH : 사람이 배분을 고친다(관리자) — 고정(pin)·차단(block)·회수(release)·완료취소(reset).
 *
 * 진도표 순서는 **PC 가 보낸다**. 서버가 순서를 따로 갖고 있으면 `voice/plan.py` 와 두 벌이 되어
 * 어긋난다 — plan.py 는 어차피 서버에서 각 PC 로 내려보내는 파일이라(소스 동기화) 한 벌로 족하다.
 * 서버가 하는 일은 **겹치지 않게 나눠 주는 것**뿐이다.
 */

import { NextResponse } from "next/server";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioR2Enabled } from "@/lib/voiceStudio/r2";
import {
  leaseLive,
  listLeases,
  listPcs,
  putLease,
  type BookLease,
  type FleetPc,
} from "@/lib/voiceStudio/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BOOKS = 200;
const MAX_WANT = 8;

async function pcMap(): Promise<Map<string, FleetPc>> {
  return new Map((await listPcs()).map((p) => [p.tokenId, p]));
}

export async function POST(req: Request) {
  const dev = await requireDevice(req);
  if (!dev.ok) return dev.res;
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }

  const plan = typeof body.plan === "string" ? body.plan.slice(0, 40) : "기본";
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : "";
  const me = dev.claims.id;
  const all = await listLeases();
  const mine = new Map(all.filter((l) => l.plan === plan).map((l) => [l.book, l]));

  const stamp = new Date().toISOString();
  const changed: string[] = [];

  // 1) 반납·완료 보고를 먼저 반영한다 — 그래야 같은 요청에서 다음 책을 바로 받을 수 있다
  for (const [field, state] of [
    ["release", null],
    ["done", "done"],
  ] as const) {
    const names = Array.isArray(body[field]) ? (body[field] as unknown[]) : [];
    for (const raw of names.slice(0, MAX_BOOKS)) {
      const book = typeof raw === "string" ? raw.slice(0, 40) : "";
      const l = mine.get(book);
      if (!l || l.tokenId !== me || l.pinned) continue; // 남의 것·고정된 것은 건드리지 않는다
      if (state === "done") {
        l.state = "done";
      } else {
        l.tokenId = "";
        l.label = "";
        l.state = "taken";
      }
      l.at = stamp;
      await putLease(l);
      changed.push(book);
    }
  }

  // 2) 빌려 간다 — 보낸 순서대로, 아직 아무도 안 쥔 책부터
  const order = Array.isArray(body.books) ? (body.books as unknown[]).slice(0, MAX_BOOKS) : [];
  const want = Math.max(0, Math.min(MAX_WANT, Number(body.want) || 0));
  const pcs = await pcMap();
  const now = Date.now();
  const granted: string[] = [];
  const held: string[] = [];

  // 이미 쥐고 있는 책을 **먼저** 센다. want 는 '모두 합쳐 이만큼 쥐고 싶다' 는 뜻이라,
  // 순서대로 훑으며 세면 뒤쪽에 있는 내 책이 아직 안 세어져 매번 새 책을 더 받게 된다.
  for (const [book, l] of mine) {
    if (l.tokenId === me && l.state !== "done") held.push(book);
  }

  for (const raw of order) {
    const book = typeof raw === "string" ? raw.slice(0, 40) : "";
    if (!book) continue;
    const l = mine.get(book);
    if (l?.tokenId === me && l.state !== "done") continue; // 이미 내가 쥐고 있다
    if (held.length + granted.length >= want) continue;
    if (l && (l.state === "done" || l.blocked)) continue;
    if (l && l.tokenId && leaseLive(l, pcs, now)) continue; // 살아 있는 남의 임대
    const next: BookLease = {
      plan,
      book,
      tokenId: me,
      label,
      pinned: l?.pinned || false,
      blocked: false,
      state: "taken",
      at: stamp,
    };
    // 사람이 다른 PC 에 고정해 둔 책은 자동 배분이 가져가지 않는다
    if (l?.pinned && l.tokenId && l.tokenId !== me) continue;
    if (await putLease(next)) {
      mine.set(book, next);
      granted.push(book);
    }
  }

  return NextResponse.json({ ok: true, granted, held, released: changed });
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
  const pcs = await pcMap();
  const now = Date.now();
  // 회수·반납된 임대는 '주인 없는 빈 기록'으로 남는다 — 아무 뜻도 없으므로 목록에서 뺀다.
  // (기록 자체를 지우지 않는 것은, 같은 책을 다시 빌릴 때 그 자리에 덮어쓰면 그만이기 때문이다)
  const leases = (await listLeases()).filter(
    (l) => l.tokenId || l.pinned || l.blocked || l.state === "done",
  );
  return NextResponse.json({
    leases: leases.map((l) => ({
      ...l,
      live: leaseLive(l, pcs, now),
      pcLabel: pcs.get(l.tokenId)?.label || "",
    })),
  });
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.res;
  if (!studioR2Enabled()) {
    return NextResponse.json({ error: "서버 보관소가 설정되지 않았습니다" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }
  const plan = typeof body.plan === "string" ? body.plan.slice(0, 40) : "기본";
  const book = typeof body.book === "string" ? body.book.slice(0, 40) : "";
  const action = String(body.action || "");
  if (!book) return NextResponse.json({ error: "book 이 필요합니다" }, { status: 400 });

  const all = await listLeases();
  const l: BookLease = all.find((x) => x.plan === plan && x.book === book) || {
    plan,
    book,
    tokenId: "",
    label: "",
    pinned: false,
    blocked: false,
    state: "taken",
    at: new Date().toISOString(),
  };

  switch (action) {
    case "pin": {
      // 사람이 이 책을 특정 PC 에 맡긴다 — 자동 배분이 건드리지 않는다
      const to = typeof body.tokenId === "string" ? body.tokenId.slice(0, 64) : "";
      if (!to) return NextResponse.json({ error: "tokenId 가 필요합니다" }, { status: 400 });
      l.tokenId = to;
      l.label = typeof body.label === "string" ? body.label.slice(0, 60) : l.label;
      l.pinned = true;
      l.blocked = false;
      l.state = "taken";
      break;
    }
    case "unpin":
      l.pinned = false;
      break;
    case "block":
      l.blocked = true;
      l.tokenId = "";
      l.label = "";
      break;
    case "unblock":
      l.blocked = false;
      break;
    case "release":
      l.tokenId = "";
      l.label = "";
      l.pinned = false;
      l.state = "taken";
      break;
    case "reset":
      l.state = "taken";
      l.tokenId = "";
      l.label = "";
      break;
    default:
      return NextResponse.json({ error: `모르는 조치: ${action}` }, { status: 400 });
  }
  l.at = new Date().toISOString();
  const ok = await putLease(l);
  if (!ok) return NextResponse.json({ error: "보관소에 쓰지 못했습니다" }, { status: 502 });
  return NextResponse.json({ ok: true, lease: l });
}
