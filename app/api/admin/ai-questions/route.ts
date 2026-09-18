/**
 * 성경 질문 — 기록 열람 (super_admin 전용)
 *
 * docs/BIBLE_QA_DOCTRINE.md §B-10 (지휘부 2026-09-18):
 *  - 모든 질문을 한 표에 남긴다. **위기 질문도 같이 남긴다**(감추지 않는다).
 *    위기 건은 눈에 띄게 표시해 super_admin 이 보고 처리한다
 *  - 보관은 무기한. 다만 **super_admin 이 개별 기록을 지울 수 있다**
 *  - **열람은 super_admin 한 사람뿐이고**(admin 등급은 못 본다), **열어 본 사실도 남긴다**
 *  - 교인에게 이 사실을 화면으로 알리지는 않는다
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFreshAdmin } from "@/lib/auth/verifySession";
import { isSuperAdmin } from "@/lib/admin";
import type { SessionData } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** 한 번에 읽어 오는 최대 건수. PostgREST 는 1000행에서 경고 없이 자른다. */
const PAGE_SIZE = 100;

/**
 * 관리자 등급만으로는 못 본다 — 등급을 **DB 최신값으로 확인한 세션**으로 판정한다.
 * 쿠키 등급으로 판정하면 교적부에서 등급을 내려도 쿠키 사본으로 계속 통한다.
 */
async function requireSuper(): Promise<
  { ok: true; session: SessionData } | { ok: false; res: NextResponse }
> {
  const gate = await requireFreshAdmin();
  if (!gate.ok) return { ok: false, res: gate.res };
  if (!isSuperAdmin(gate.session)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "이 기록은 수퍼어드민만 볼 수 있습니다" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session: gate.session };
}

/** 열어 본 사실을 남긴다. 실패해도 열람을 막지는 않되, 조용히 넘기지 않는다. */
async function logView(
  session: SessionData,
  action: string,
  questionId: number | null,
  detail: string | null,
) {
  const { error } = await supabaseAdmin.from("ai_question_views").insert({
    viewer_user_id: session.user_id,
    viewer_name: session.name,
    action,
    question_id: questionId,
    detail,
  });
  if (error) console.error("[admin/ai-questions] 열람 기록 실패", action, error.message);
}

export async function GET(request: NextRequest) {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  const { searchParams } = new URL(request.url);
  // crisis = 위기 건만 · reported = 신고된 답이 있는 건만 · all = 전부
  const filter = searchParams.get("filter") ?? "all";
  const q = (searchParams.get("q") ?? "").trim();
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  let query = supabaseAdmin
    .from("ai_questions")
    .select(
      "id, user_id, user_name, verses_ref, question, input_kind, gate_result, is_crisis, " +
        "crisis_reviewed, crisis_note, mode, housechurch, prompt_version, saved, asked_at, " +
        "ai_question_answers(column_key, provider_alias, model, ok, content, error, " +
        "removed_refs, input_tokens, output_tokens, elapsed_ms, reported, report_reason)",
      { count: "exact" },
    )
    .order("asked_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (filter === "crisis") query = query.eq("is_crisis", true);
  if (q) query = query.ilike("question", `%${q}%`);

  const { data, error, count } = await query;
  if (error) {
    // 표가 아직 없으면 화면이 '아직 준비 중' 을 보일 수 있게 분명히 알린다.
    return NextResponse.json({ error: error.message, ready: false }, { status: 503 });
  }

  let items = data ?? [];
  // 신고된 답이 있는 건만 — 조인 결과로 걸러야 해서 여기서 한다(행 수가 100 이라 값이 싸다).
  if (filter === "reported") {
    items = items.filter((row) =>
      ((row as { ai_question_answers?: { reported?: boolean }[] }).ai_question_answers ?? []).some(
        (a) => a.reported,
      ),
    );
  }

  await logView(gate.session, "list", null, `filter=${filter}${q ? ` q=${q}` : ""} offset=${offset}`);

  return NextResponse.json({
    ready: true,
    items,
    total: count ?? null,
    pageSize: PAGE_SIZE,
    offset,
  });
}

/** 위기 건을 사람이 검토했다고 표시한다 (§B-10 — super_admin 이 보고 처리한다) */
export async function PATCH(request: NextRequest) {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }
  const reviewed = body.crisis_reviewed === true;
  const note = typeof body.crisis_note === "string" ? body.crisis_note.slice(0, 1000) : null;

  const { error } = await supabaseAdmin
    .from("ai_questions")
    .update({ crisis_reviewed: reviewed, crisis_note: note })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logView(gate.session, "review", id, reviewed ? "검토함" : "검토 해제");
  return NextResponse.json({ success: true });
}

/**
 * 기록 삭제 — **super_admin 만**(§B-10 "보관은 무기한. 다만 super_admin 이 개별 기록을 지울 수 있다").
 * 답은 `on delete cascade` 로 함께 지워지고, **지웠다는 사실은 열람 기록에 남는다.**
 */
export async function DELETE(request: NextRequest) {
  const gate = await requireSuper();
  if (!gate.ok) return gate.res;

  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "유효한 id가 필요합니다" }, { status: 400 });
  }

  // 지우기 전에 무엇을 지웠는지 남긴다 — 지운 뒤에는 알 수 없다.
  const { data: row } = await supabaseAdmin
    .from("ai_questions")
    .select("user_name, verses_ref, question, is_crisis")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabaseAdmin.from("ai_questions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logView(
    gate.session,
    "delete",
    id,
    row
      ? `${row.user_name ?? "?"} · ${row.verses_ref ?? "?"} · ${String(row.question).slice(0, 60)}${row.is_crisis ? " · 위기" : ""}`
      : "이미 없던 기록",
  );
  return NextResponse.json({ success: true });
}
