/**
 * 성경 질문 — 네 목록 편집 (super_admin 전용)
 *
 * docs/BIBLE_QA_DOCTRINE.md §B-11 (지휘부 2026-09-18): 자주 바뀌는 네 가지는 DB 에 두고 관리자 화면에서 고친다 —
 *   heresy(이단 목록) · housechurch(가정교회 자료) · crisis(위기 상담 창구) · lifestudy(삶공부 과정 이름).
 * 총회 결의가 더해지거나 번호가 바뀔 때 목사님이 바로 고치실 수 있어야 한다. 편집 화면은 2026-09-19 에 만들었다.
 *
 * 고친 것은 **다음 질문부터 바로** 쓰인다 — 질문·답변 라우트가 요청마다 목록을 읽는다(캐시 없음).
 * 누가 고쳤는지는 `updated_by`, 언제는 `updated_at` 에 남고, 답변 기록의 `lists_synced_at` 이 그 시각을 가리킨다.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFreshAdmin } from "@/lib/auth/verifySession";
import { isSuperAdmin } from "@/lib/admin";
import type { SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const KINDS = ["heresy", "housechurch", "crisis", "lifestudy"] as const;
type Kind = (typeof KINDS)[number];

const LIMITS = { title: 200, body: 1000, note: 1000 };

/**
 * 관리자 등급만으로는 못 고친다 — 등급을 **DB 최신값으로 확인한 세션**으로 판정한다
 * (`/api/admin/ai-questions` 와 같은 문). 쿠키 등급으로 판정하면 교적부에서 등급을 내려도 계속 통한다.
 */
async function requireSuper(): Promise<
  { ok: true; session: SessionData } | { ok: false; res: NextResponse }
> {
  const gate = await requireFreshAdmin();
  if (!gate.ok) return { ok: false, res: gate.res };
  if (!isSuperAdmin(gate.session)) {
    return {
      ok: false,
      res: NextResponse.json({ error: "수퍼어드민만 고칠 수 있습니다" }, { status: 403 }),
    };
  }
  return { ok: true, session: gate.session };
}

function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** 글 칸 하나를 다듬는다. 빈 글은 null(제목은 따로 막는다), 너무 길면 오류. */
function textField(v: unknown, key: keyof typeof LIMITS): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${key} 는 글이어야 합니다` };
  const t = v.trim();
  if (t.length > LIMITS[key]) return { ok: false, error: `${key} 는 ${LIMITS[key]}자까지 쓸 수 있습니다` };
  return { ok: true, value: t || null };
}

function editor(session: SessionData): string {
  return session.name || session.user_id;
}

/** UNIQUE(kind, title) 에 걸렸을 때 사람이 읽을 말로 */
function saveError(error: { code?: string; message: string }): NextResponse {
  if (error.code === "23505") {
    return NextResponse.json({ error: "같은 목록에 같은 이름이 이미 있습니다" }, { status: 409 });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export async function GET() {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  // 꺼 둔 줄도 함께 보인다 — 편집 화면이다.
  const { data, error } = await supabaseAdmin
    .from("qa_lists")
    .select("id, kind, sort_order, title, body, note, enabled, updated_at, updated_by")
    .order("kind")
    .order("sort_order")
    .order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

/** 새 줄. 순서는 그 목록의 맨 끝. */
export async function POST(request: NextRequest) {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  const body = await request.json().catch(() => ({}));
  if (!isKind(body.kind)) {
    return NextResponse.json({ error: "목록 종류가 올바르지 않습니다" }, { status: 400 });
  }
  const title = textField(body.title, "title");
  const text = textField(body.body, "body");
  const note = textField(body.note, "note");
  for (const f of [title, text, note]) if (!f.ok) return NextResponse.json({ error: f.error }, { status: 400 });
  if (!title.ok || !title.value) {
    return NextResponse.json({ error: "이름을 적어 주세요" }, { status: 400 });
  }

  const { data: last } = await supabaseAdmin
    .from("qa_lists")
    .select("sort_order")
    .eq("kind", body.kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("qa_lists")
    .insert({
      kind: body.kind,
      sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1,
      title: title.value,
      body: text.ok ? text.value : null,
      note: note.ok ? note.value : null,
      enabled: body.enabled !== false,
      updated_at: new Date().toISOString(),
      updated_by: editor(gate.session),
    })
    .select("id, kind, sort_order, title, body, note, enabled, updated_at, updated_by")
    .single();
  if (error) return saveError(error);
  return NextResponse.json({ item: data });
}

/**
 * 고치기 — 보낸 칸만 바꾼다(`title` · `body` · `note` · `enabled`).
 * `move: "up" | "down"` 이면 같은 목록의 이웃과 순서를 맞바꾼다.
 */
export async function PATCH(request: NextRequest) {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id 가 필요합니다" }, { status: 400 });
  }
  const { data: row, error: readError } = await supabaseAdmin
    .from("qa_lists")
    .select("id, kind, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "없는 줄입니다" }, { status: 404 });

  const now = new Date().toISOString();
  const who = editor(gate.session);

  if (body.move === "up" || body.move === "down") {
    const up = body.move === "up";
    let near = supabaseAdmin.from("qa_lists").select("id, sort_order").eq("kind", row.kind);
    near = up ? near.lt("sort_order", row.sort_order) : near.gt("sort_order", row.sort_order);
    const { data: neighbor } = await near
      .order("sort_order", { ascending: !up })
      .limit(1)
      .maybeSingle();
    if (!neighbor) return NextResponse.json({ ok: true, moved: false });
    // 두 줄의 순서를 맞바꾼다. 둘 사이에 다른 요청이 끼어도 값이 겹칠 뿐 줄이 사라지지는 않는다.
    const a = await supabaseAdmin
      .from("qa_lists")
      .update({ sort_order: neighbor.sort_order, updated_at: now, updated_by: who })
      .eq("id", row.id);
    const b = await supabaseAdmin
      .from("qa_lists")
      .update({ sort_order: row.sort_order, updated_at: now, updated_by: who })
      .eq("id", neighbor.id);
    const err = a.error ?? b.error;
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ ok: true, moved: true });
  }

  const patch: Record<string, unknown> = { updated_at: now, updated_by: who };
  if ("title" in body) {
    const f = textField(body.title, "title");
    if (!f.ok) return NextResponse.json({ error: f.error }, { status: 400 });
    if (!f.value) return NextResponse.json({ error: "이름을 적어 주세요" }, { status: 400 });
    patch.title = f.value;
  }
  for (const key of ["body", "note"] as const) {
    if (key in body) {
      const f = textField(body[key], key);
      if (!f.ok) return NextResponse.json({ error: f.error }, { status: 400 });
      patch[key] = f.value;
    }
  }
  if ("enabled" in body) patch.enabled = body.enabled === true;

  const { data, error } = await supabaseAdmin
    .from("qa_lists")
    .update(patch)
    .eq("id", id)
    .select("id, kind, sort_order, title, body, note, enabled, updated_at, updated_by")
    .single();
  if (error) return saveError(error);
  return NextResponse.json({ item: data });
}

/** 지우기. 되돌릴 수 없다 — 화면은 먼저 '끄기' 를 권한다. */
export async function DELETE(request: NextRequest) {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id 가 필요합니다" }, { status: 400 });
  }
  const { error } = await supabaseAdmin.from("qa_lists").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
