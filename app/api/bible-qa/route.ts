/**
 * 성경 질문 — 묻고 답받는 자리
 *
 * 흐름(docs/BIBLE_QA_DOCTRINE.md §A·§B):
 *   1. 로그인 확인 · 글자 수 상한
 *   2. 고른 절의 본문을 **서버가** DB 에서 가져온다(클라이언트 글을 프롬프트에 넣지 않는다)
 *   3. 값싼 모델로 선별 → crisis · deny · allow
 *   4. **기록을 먼저 남긴다** — 위기·거절도 남긴다(§B-10). 표가 없으면 여기서 멈춘다(돈을 쓰기 전에)
 *   5. crisis → 모델을 부르지 않고 위기 화면 · deny → §7 문구 · allow → 칸별 병렬 호출
 *   6. 답을 칸마다 기록한다(실패한 칸도 남긴다)
 *
 * 설교 카드는 **이 라우트가 하지 않는다** — 별도 GET(`/api/bible-qa/sermons`)이다.
 * 여기에 끼워 넣으면 DB 왕복이 답변 시간에 직렬로 더해지고, 색인 조회 실패가 답을 통째로 죽인다.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { getBookByCode } from "@/lib/books";
import { getVersionLabel } from "@/lib/versions";
import { stripNotes, type BibleVersion } from "@/lib/types";
import { gateQuestion, shouldCallModels } from "@/lib/bibleQa/gate";
import { buildAnswerPrompt, type QaListRow } from "@/lib/bibleQa/prompt";
import { QA_COLUMNS, askColumns, type ColumnKey, type QaColumn } from "@/lib/bibleQa/columns";
import { extractRefs, stripMissingRefs, verifyRefs } from "@/lib/bibleQa/verseRefs";
import {
  CRISIS_BODY,
  CRISIS_FALLBACK,
  CRISIS_HEADING,
  DISCLAIMER,
  QUESTION_MAX_LENGTH,
  REFUSAL_GENERAL,
} from "@/lib/bibleQa/texts";

export const dynamic = "force-dynamic";

/**
 * 이 저장소에 `maxDuration` 선례가 없다 — 그래도 여기에는 **반드시** 둔다.
 * 게이트(최대 8초) + 세 칸 병렬(칸당 최대 40초)이 플랫폼 기본 상한(10~15초)을 넘어
 * 그대로 두면 답이 다 왔는데도 조용히 504 가 된다.
 */
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

/** 표가 아직 없을 때의 Postgres 코드. 배포는 됐고 마이그레이션은 아직인 상태다. */
const UNDEFINED_TABLE = "42P01";

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === UNDEFINED_TABLE;
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
  const retry = body.retry === true;

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

  // 어느 칸에 물을지. 없으면 Gemini 한 칸(첫 교인의 기본값).
  const requested: ColumnKey[] = Array.isArray(body.columns)
    ? (body.columns.filter((k: unknown) =>
        QA_COLUMNS.some((c) => c.key === k),
      ) as ColumnKey[])
    : ["gemini"];
  const columns: QaColumn[] = QA_COLUMNS.filter((c) => requested.includes(c.key));
  if (columns.length === 0) {
    return NextResponse.json({ error: "AI 를 하나 이상 골라 주세요" }, { status: 400 });
  }
  const mode = columns.length > 1 ? "chorus" : "single";

  // ── 본문은 서버가 가져온다 ────────────────────────────────────────
  // 클라이언트가 보낸 글을 프롬프트에 넣으면 교인이 아무 문장이나 '본문' 으로 심을 수 있다.
  const lastVerse = verseEnd && verseEnd >= verseStart ? verseEnd : verseStart;
  const { data: verseRows } = await supabaseAdmin
    .from("bible_verses")
    .select("verse, text")
    .eq("version", version)
    .eq("book_code", bookCode)
    .eq("chapter", chapter)
    .gte("verse", verseStart)
    .lte("verse", lastVerse)
    .order("verse");

  const versesText = (verseRows ?? [])
    .map((v) => `${v.verse} ${stripNotes(v.text ?? "")}`)
    .join("\n");
  const versesRef =
    lastVerse > verseStart
      ? `${book.nameKr} ${chapter}:${verseStart}-${lastVerse}`
      : `${book.nameKr} ${chapter}:${verseStart}`;

  // ── 선별 ────────────────────────────────────────────────────────
  const gate = await gateQuestion(question);
  const isCrisis = gate.verdict === "crisis";

  // ── 기록을 먼저 남긴다 (§B-10) ───────────────────────────────────
  const { rows: lists, syncedAt } = await loadLists();
  const built = shouldCallModels(gate.verdict)
    ? await buildAnswerPrompt({
        versesRef,
        versesText,
        versionName: getVersionLabel(version),
        question,
        lists,
      })
    : null;

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
      gate_result: gate.verdict,
      is_crisis: isCrisis,
      mode,
      housechurch: built?.housechurch ?? false,
      prompt_version: built?.promptVersion ?? "v1",
      lists_synced_at: syncedAt,
    })
    .select("id")
    .single();

  if (insertError) {
    if (isMissingTable(insertError)) {
      // 코드는 배포됐고 마이그레이션은 아직이다. 답을 만들어 놓고 기록을 못 남기는 것보다
      // 분명한 한 줄로 멈추는 편이 낫다 — 기록 없는 답은 §B-10 위반이다.
      return NextResponse.json(
        { error: "질문 기능이 아직 준비 중입니다. 잠시 뒤 다시 시도해 주세요." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  const questionId = inserted?.id as number;

  // ── 위기 ────────────────────────────────────────────────────────
  if (isCrisis) {
    const fromDb = lists
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
  if (gate.verdict === "deny") {
    return NextResponse.json({
      id: questionId,
      kind: "refused",
      message: REFUSAL_GENERAL,
    });
  }

  // ── 답 ─────────────────────────────────────────────────────────
  const answers = await askColumns(columns, {
    systemPrompt: built!.systemPrompt,
    question,
    // 다시 묻기는 캐시를 끈다 — 켜 두면 한 시간 동안 같은 답이 재생된다.
    useCache: !retry,
  });

  // ── 구절 검증과 본문 붙이기 (§B-5 · §B-9) ─────────────────────────
  // 없는 구절은 프롬프트로 다 막지 못한다. 답에 적힌 주소를 실제로 찾아보고,
  // 없는 것은 **표시만** 지운다(글을 다시 쓰지 않는다).
  const shown = await Promise.all(
    answers.map(async (a) => {
      if (!a.ok || !a.content) return { ...a, content: a.content, refs: [], removed: [] as string[] };
      const found = extractRefs(a.content);
      if (found.length === 0) return { ...a, refs: [], removed: [] as string[] };
      const { resolved, missing } = await verifyRefs(found, version);
      const cleaned = missing.length > 0 ? stripMissingRefs(a.content, missing) : a.content;
      return {
        ...a,
        content: cleaned,
        refs: resolved.map((r) => ({
          ref:
            r.verseEnd > r.verseStart
              ? `${r.bookName} ${r.chapter}:${r.verseStart}-${r.verseEnd}`
              : `${r.bookName} ${r.chapter}:${r.verseStart}`,
          text: r.text,
        })),
        removed: missing.map((r) => r.raw),
      };
    }),
  );

  const { error: answerError } = await supabaseAdmin.from("ai_question_answers").insert(
    answers.map((a, i) => ({
      question_id: questionId,
      column_key: a.columnKey,
      provider_alias: a.providerAlias,
      model: a.model,
      ok: a.ok,
      // **모델이 실제로 준 글을 그대로 남긴다** — 화면에 보인 것은 주소를 지운 판이지만,
      // "모델이 없는 구절을 지어냈다" 는 사실은 기록에 남아야 잡을 수 있다.
      content: a.content,
      removed_refs: shown[i].removed.length > 0 ? shown[i].removed : null,
      error: a.error,
      input_tokens: a.inputTokens,
      output_tokens: a.outputTokens,
      elapsed_ms: a.elapsedMs,
    })),
  );
  // 답 기록 실패로 답을 버리지는 않는다. 다만 조용히 넘기지 않고 서버 로그에 남긴다.
  if (answerError) {
    console.error("[bible-qa] 답 기록 실패", questionId, answerError.message);
  }

  return NextResponse.json({
    id: questionId,
    kind: "answered",
    mode,
    disclaimer: DISCLAIMER,
    gate: gate.verdict,
    answers: shown.map((a) => ({
      column: a.columnKey,
      label: QA_COLUMNS.find((c) => c.key === a.columnKey)?.label ?? a.columnKey,
      ok: a.ok,
      // 없는 구절의 표시를 지운 판을 보낸다(§B-5)
      content: a.content,
      // 화면 라벨의 진실은 model 뿐이다(응답 provider 는 계열명으로 정규화돼 온다).
      model: a.model,
      error: a.ok ? null : a.error,
      elapsed_ms: a.elapsedMs,
      refs: a.refs,
    })),
  });
}
