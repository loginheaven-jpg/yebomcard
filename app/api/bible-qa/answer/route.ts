/**
 * 성경 질문 — 2단계: 한 칸의 답을 받는다
 *
 * 1단계(`/api/bible-qa`)가 선별하고 기록한 질문에 대해, **칸 하나**의 답을 만든다.
 * 화면은 칸마다 이 라우트를 동시에 부르고, **먼저 끝난 칸부터** 그린다(지휘부 2026-09-18 —
 * "셋 다 동시에 보여 주기보다 완료된 것 먼저 차례로").
 *
 * 칸마다 요청이 따로라 좋은 점이 셋이다.
 *  - 느린 칸이 빠른 칸을 붙잡지 않는다(운영 실측: Claude 모델 시간만 31~36초)
 *  - 칸 하나가 라우트 상한을 통째로 쓴다 — 예전에는 세 칸이 60초를 나눠 써서 Claude 가 잘렸다
 *  - 한 칸이 실패해도 다른 칸의 기록이 따로 남는다
 *
 * 지키는 것:
 *  - **자기 질문에만** 답을 만든다(user_id 로 스코프)
 *  - 선별이 통과시킨 질문에만(위기·거절이면 모델을 부르지 않는다, §A)
 *  - 1단계에서 고른 칸에만(`columns`) — 한 칸만 물었는데 세 칸을 받아 가지 못하게
 *  - 같은 칸을 두 번 만들지 않는다(UNIQUE (question_id, column_key))
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { getVersionLabel } from "@/lib/versions";
import { stripNotes, type BibleVersion } from "@/lib/types";
import { buildAnswerPrompt, type QaListRow } from "@/lib/bibleQa/prompt";
import { askColumn, columnOf } from "@/lib/bibleQa/columns";
import { extractRefs, stripMissingRefs, verifyRefs } from "@/lib/bibleQa/verseRefs";

export const dynamic = "force-dynamic";

/**
 * 칸 하나가 쓰는 시간. Claude 는 모델 시간만 31~36초이고 게이트웨이 앞단이 10초 안팎 더한다.
 * 칸 기다림(100초)보다 넉넉히 둔다 — 라우트가 먼저 끊기면 답이 와도 기록되지 못한다.
 */
export const maxDuration = 120;

/** 칸을 기다리는 시간 — maxDuration(120초) 안에서 기록할 몫을 남긴다. */
const COLUMN_TIMEOUT_MS = 100_000;

/** 답 아래에 본문을 붙이는 구절 수(교리 기준 §4 — 한 답에 세 개까지). */
const MAX_ATTACHED_REFS = 3;

async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  // 칸 하나 = AI 호출 하나. 질문 상한(20회/10분)에 세 칸을 곱한 값이다.
  const limited = rateLimit(request, "bible-qa-answer", 60, 10 * 60_000);
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const questionId = Number(body.id);
  const column = columnOf(typeof body.column === "string" ? body.column : "");
  const retry = body.retry === true;
  if (!Number.isFinite(questionId) || questionId <= 0 || !column) {
    return NextResponse.json({ error: "id, column이 필요합니다" }, { status: 400 });
  }

  // ── 자기 질문인가, 선별이 통과시켰는가, 고른 칸인가 ──────────────────
  const { data: q, error: qError } = await supabaseAdmin
    .from("ai_questions")
    .select("id, book_code, chapter, verse_start, verse_end, version, verses_ref, question, is_crisis, gate_result, columns")
    .eq("id", questionId)
    .eq("user_id", session.user_id)
    .maybeSingle();
  if (qError) return NextResponse.json({ error: qError.message }, { status: 500 });
  if (!q) {
    // 남의 질문이거나 없는 질문. 어느 쪽인지 알려 주지 않는다.
    return NextResponse.json({ error: "질문을 찾을 수 없습니다" }, { status: 404 });
  }
  // 위기·거절이면 모델을 부르지 않는다(§A). 1단계가 columns 를 비워 둔 것이 그 표시다.
  const allowedColumns: string[] = Array.isArray(q.columns) ? q.columns : [];
  if (q.is_crisis || q.gate_result === "deny" || allowedColumns.length === 0) {
    return NextResponse.json({ error: "이 질문에는 답을 만들지 않습니다" }, { status: 409 });
  }
  if (!allowedColumns.includes(column.key)) {
    return NextResponse.json({ error: "물은 AI 가 아닙니다" }, { status: 409 });
  }

  // 이미 만든 칸이면 그대로 돌려준다(새로고침·두 번 누름). 다시 부르지 않는다.
  const { data: existing } = await supabaseAdmin
    .from("ai_question_answers")
    .select("column_key, model, ok, content, error, elapsed_ms")
    .eq("question_id", questionId)
    .eq("column_key", column.key)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      column: column.key,
      label: column.label,
      ok: existing.ok,
      content: existing.content,
      model: existing.model,
      error: existing.ok ? null : existing.error,
      elapsed_ms: existing.elapsed_ms ?? 0,
      refs: [],
      cached: true,
    });
  }

  // ── 프롬프트 — 1단계가 남긴 질문 행으로 다시 조립한다 ────────────────
  // 본문은 서버가 DB 에서 가져온다(클라이언트 글을 프롬프트에 넣지 않는다).
  const version = (q.version || "rnksv") as BibleVersion;
  const lastVerse = q.verse_end ?? q.verse_start;
  const [{ data: verseRows }, { data: listRows }] = await Promise.all([
    supabaseAdmin
      .from("bible_verses")
      .select("verse, text")
      .eq("version", version)
      .eq("book_code", q.book_code)
      .eq("chapter", q.chapter)
      .gte("verse", q.verse_start)
      .lte("verse", lastVerse)
      .order("verse"),
    supabaseAdmin
      .from("qa_lists")
      .select("kind, title, body, sort_order")
      .eq("enabled", true),
  ]);
  const versesText = (verseRows ?? [])
    .map((v) => `${v.verse} ${stripNotes(v.text ?? "")}`)
    .join("\n");

  const built = await buildAnswerPrompt({
    versesRef: q.verses_ref ?? "",
    versesText,
    versionName: getVersionLabel(version),
    question: q.question,
    lists: (listRows ?? []) as QaListRow[],
  });

  // ── 답 ─────────────────────────────────────────────────────────
  const answer = await askColumn({
    column,
    systemPrompt: built.systemPrompt,
    question: q.question,
    useCache: !retry,
    timeoutMs: COLUMN_TIMEOUT_MS,
  });

  // ── 구절 검증과 본문 붙이기 (§B-5 · §B-9) ─────────────────────────
  let shownContent = answer.content;
  let refs: { ref: string; text: string }[] = [];
  let removed: string[] = [];
  if (answer.ok && answer.content) {
    const found = extractRefs(answer.content);
    if (found.length > 0) {
      const { resolved, missing } = await verifyRefs(found, version);
      if (missing.length > 0) shownContent = stripMissingRefs(answer.content, missing);
      // 없는 구절 지우기(§B-5)는 **전부** 검사하고, 본문을 붙이는 것(§B-9)은 **앞의 셋까지만**.
      // 교리 기준 §4 가 "한 답에 세 개까지" 인데 모델이 어긴다 — 2026-09-18 비교 측정에서
      // ChatGPT 가 한 답에 6개를 달았고, 앱이 여섯 본문을 다 붙여 카드가 답보다 길어졌다.
      refs = resolved.slice(0, MAX_ATTACHED_REFS).map((r) => ({
        ref:
          r.verseEnd > r.verseStart
            ? `${r.bookName} ${r.chapter}:${r.verseStart}-${r.verseEnd}`
            : `${r.bookName} ${r.chapter}:${r.verseStart}`,
        text: r.text,
      }));
      removed = missing.map((r) => r.raw);
    }
  }

  // ── 기록 — 모델이 실제로 준 글을 그대로 남긴다 ─────────────────────
  const { error: saveError } = await supabaseAdmin.from("ai_question_answers").insert({
    question_id: questionId,
    column_key: column.key,
    provider_alias: answer.providerAlias,
    model: answer.model,
    ok: answer.ok,
    content: answer.content,
    removed_refs: removed.length > 0 ? removed : null,
    error: answer.error,
    input_tokens: answer.inputTokens,
    output_tokens: answer.outputTokens,
    elapsed_ms: answer.elapsedMs,
  });
  // 같은 칸이 동시에 두 번 들어오면 UNIQUE 가 막는다(23505) — 답은 그대로 돌려준다.
  if (saveError && saveError.code !== "23505") {
    console.error("[bible-qa/answer] 기록 실패", questionId, column.key, saveError.message);
  }

  return NextResponse.json({
    column: column.key,
    label: column.label,
    ok: answer.ok,
    content: shownContent,
    // 화면 라벨의 진실은 model 뿐이다(응답 provider 는 계열명으로 정규화돼 온다).
    model: answer.model,
    error: answer.ok ? null : answer.error,
    elapsed_ms: answer.elapsedMs,
    refs,
  });
}
