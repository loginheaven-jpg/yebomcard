/**
 * 성경 질문 — 1단계: 선별하고 기록한다
 *
 * **두 단계로 나눴다(2026-09-18).** 처음에는 한 요청이 선별 → 세 모델 → 기록을 다 하고
 * 한꺼번에 돌려줬다. 운영에서 재 보니 그러면 **가장 느린 모델이 전부를 붙잡는다** —
 * Claude 가 모델 시간만 31~36초라 Gemini·ChatGPT 답이 와 있어도 교인은 40초 넘게 빈 화면을 봤다.
 * 이제는:
 *   1. 이 라우트 — 선별 · 기록 · 위기/거절 판정. 답은 만들지 않는다
 *   2. `/api/bible-qa/answer` — **칸마다 따로** 부른다. 먼저 끝난 칸이 먼저 화면에 뜬다
 * 선별이 끝나야 모델을 부른다는 규칙(§A — crisis 면 모델을 부르지 않는다)은 그대로다.
 *
 * **어느 칸이 답할지는 이 라우트가 정한다**(지휘부 2026-09-19, §B-3-1). 교인은 AI 를 고르지 않는다 —
 * 선별이 `basic` 이면 Gemini · ChatGPT, `doctrine` 이거나 선별이 실패했으면 Claude 까지.
 * 요청에 `columns` 가 실려 와도(옛 화면) 따르지 않는다.
 *
 * 설교 카드도 이 라우트가 하지 않는다 — 별도 GET(`/api/bible-qa/sermons`)이다.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { getBookByCode } from "@/lib/books";
import { type BibleVersion } from "@/lib/types";
import { decide, gateQuestion, shouldCallModels, wantsDoctrineColumns } from "@/lib/bibleQa/gate";
import { hasCrisisSignal } from "@/lib/bibleQa/crisisSignal";
import { PROMPT_VERSION, needsHouseChurch, lifeStudyNames, type QaListRow } from "@/lib/bibleQa/prompt";
import { QA_COLUMNS, columnsFor } from "@/lib/bibleQa/columns";
import {
  CRISIS_BODY,
  CRISIS_FALLBACK,
  CRISIS_HEADING,
  DISCLAIMER,
  EXTENDED_NOTE,
  QUESTION_MAX_LENGTH,
  REFUSAL_GENERAL,
} from "@/lib/bibleQa/texts";

export const dynamic = "force-dynamic";

/** 선별(최대 20초) + 기록. 답은 여기서 만들지 않으므로 60초면 넉넉하다. */
export const maxDuration = 60;

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

/** 표가 아직 없을 때의 코드 — Postgres(42P01) · PostgREST 스키마 캐시(PGRST205) */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** 관리자 화면에서 고치는 네 목록. 표가 없으면 빈 배열로 돌려 기능을 죽이지 않는다(§B-11). */
async function loadLists(): Promise<{ rows: QaListRow[]; syncedAt: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("qa_lists")
    .select("kind, title, body, sort_order, updated_at")
    .eq("enabled", true)
    .order("kind")
    .order("sort_order");
  if (error || !data) return { rows: [], syncedAt: null };
  let syncedAt: string | null = null;
  for (const row of data) {
    const at = (row as { updated_at?: string }).updated_at ?? null;
    if (at && (!syncedAt || at > syncedAt)) syncedAt = at;
  }
  return { rows: data as QaListRow[], syncedAt };
}

export async function POST(request: NextRequest) {
  // 질문 한 번이 AI 호출 최대 4번(선별 1 + 칸 3)이다. 상한을 맨 앞에 둔다.
  const limited = rateLimit(request, "bible-qa", 20, 10 * 60_000);
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const bookCode = typeof body.book_code === "string" ? body.book_code : "";
  const chapter = Number(body.chapter);
  const verseStart = Number(body.verse_start);
  const verseEnd = body.verse_end == null ? null : Number(body.verse_end);
  const version: BibleVersion = typeof body.version === "string" ? body.version : "rnksv";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const inputKind = body.input_kind === "voice" ? "voice" : "text";

  const book = getBookByCode(bookCode);
  if (!book || !Number.isFinite(chapter) || chapter < 1 || !Number.isFinite(verseStart)) {
    return NextResponse.json(
      { error: "book_code, chapter, verse_start가 필요합니다" },
      { status: 400 },
    );
  }
  if (!question) {
    return NextResponse.json({ error: "질문을 입력해 주세요" }, { status: 400 });
  }
  if (question.length > QUESTION_MAX_LENGTH) {
    return NextResponse.json(
      { error: `질문은 ${QUESTION_MAX_LENGTH}자까지 쓸 수 있습니다` },
      { status: 400 },
    );
  }

  const lastVerse = verseEnd && verseEnd >= verseStart ? verseEnd : verseStart;
  const versesRef =
    lastVerse > verseStart
      ? `${book.nameKr} ${chapter}:${verseStart}-${lastVerse}`
      : `${book.nameKr} ${chapter}:${verseStart}`;

  // ── 선별 + 안전망 ───────────────────────────────────────────────
  // 선별과 목록 읽기는 서로 기다릴 까닭이 없다 — 함께 띄운다.
  const localSignal = hasCrisisSignal(question);
  // 선별에는 고른 구절의 주소를 함께 준다 — '무슨 뜻인가?' 가 그 구절에 대한 질문임을 알게(§A).
  const [gate, lists] = await Promise.all([gateQuestion(question, versesRef), loadLists()]);
  // 선별이 실패했을 때 위기를 시사하는 1인칭 말이 있으면 막는다(crisisSignal.ts).
  const verdict = decide(gate.verdict, localSignal);
  const isCrisis = verdict === "crisis";
  const housechurch = shouldCallModels(verdict)
    ? needsHouseChurch(question, lifeStudyNames(lists.rows))
    : false;
  // 어느 칸이 답할지 — 교리가 걸렸으면(또는 선별이 실패해 모르면) Claude 까지(§B-3-1).
  const extended = wantsDoctrineColumns(verdict, gate.kind);
  const columns = columnsFor(extended);
  // 이제 늘 두 칸 이상이다. 기록의 mode 는 옛 값('chorus')을 그대로 쓴다(관리자 화면과 같은 값).
  const mode = "chorus";

  // ── 기록을 먼저 남긴다 (§B-10) ───────────────────────────────────
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("ai_questions")
    .insert({
      user_id: session.user_id,
      user_name: session.name,
      book_code: bookCode,
      chapter,
      verse_start: verseStart,
      verse_end: lastVerse > verseStart ? lastVerse : null,
      version,
      verses_ref: versesRef,
      question,
      input_kind: inputKind,
      // 선별 모델이 실제로 가른 값. 안전망이 뒤집었으면 is_crisis 와 local_signal 로 드러난다.
      gate_result: gate.verdict,
      gate_ms: gate.elapsedMs,
      gate_raw: gate.raw ? gate.raw.slice(0, 200) : null,
      local_signal: localSignal,
      is_crisis: isCrisis,
      mode,
      columns: shouldCallModels(verdict) ? columns : null,
      housechurch,
      prompt_version: PROMPT_VERSION,
      lists_synced_at: lists.syncedAt,
    })
    .select("id")
    .single();

  if (insertError) {
    if (isMissingTable(insertError)) {
      // 코드는 배포됐고 마이그레이션은 아직이다. 기록 없는 답은 §B-10 위반이라 여기서 멈춘다.
      return NextResponse.json(
        { error: "질문 기능이 아직 준비 중입니다. 잠시 뒤 다시 시도해 주세요." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  const questionId = inserted?.id as number;

  // ── 위기 — 모델을 부르지 않는다 ─────────────────────────────────
  if (isCrisis) {
    const fromDb = lists.rows
      .filter((r) => r.kind === "crisis")
      .map((r) => ({ title: r.title, body: r.body ?? "" }));
    return NextResponse.json({
      id: questionId,
      kind: "crisis",
      heading: CRISIS_HEADING,
      body: CRISIS_BODY,
      lines: fromDb.length > 0 ? fromDb : CRISIS_FALLBACK,
    });
  }

  // ── 거절 ────────────────────────────────────────────────────────
  if (verdict === "deny") {
    return NextResponse.json({ id: questionId, kind: "refused", message: REFUSAL_GENERAL });
  }

  // ── 답은 칸마다 따로 받는다 ─────────────────────────────────────
  return NextResponse.json({
    id: questionId,
    kind: "pending",
    mode,
    columns: columns.map((key) => ({
      column: key,
      label: QA_COLUMNS.find((c) => c.key === key)?.label ?? key,
    })),
    // Claude 가 더해졌으면 화면이 왜 칸이 셋인지 한 줄로 알린다
    extended_note: extended ? EXTENDED_NOTE : null,
    disclaimer: DISCLAIMER,
  });
}
