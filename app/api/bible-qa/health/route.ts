/**
 * 성경 질문 — 점검 창구
 *
 * 이 기능이 **가장 조용히 깨지는 자리**는 배포 번들에 교리 문서가 빠지는 것이다.
 * 로컬에서는 파일이 있으니 다 되고, 배포에서만 프롬프트를 못 찾는다. 그래서 프로덕션에서
 * 눈으로 확인할 창구를 둔다(`next.config.ts` 의 `outputFileTracingIncludes` 를 누가 지우면 여기서 잡힌다).
 *
 * **글 내용은 내보내지 않는다** — 길이와 있음/없음만이다. 그래서 로그인을 요구하지 않는다.
 * 표 준비 여부도 함께 본다(마이그레이션 적용 전에는 질문이 503 이 된다).
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadDoctrinePrompt, loadGatePrompt, PROMPT_VERSION } from "@/lib/bibleQa/prompt";
import { QA_COLUMNS } from "@/lib/bibleQa/columns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "bible-qa-health", 30, 10 * 60_000);
  if (limited) return limited;

  const out: Record<string, unknown> = {
    prompt_version: PROMPT_VERSION,
    columns: QA_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      provider: c.provider,
      model: c.model ?? null,
      expects: c.modelPrefixes,
    })),
  };

  // 문서를 읽을 수 있는가 (배포 번들 포함 여부)
  try {
    const doctrine = await loadDoctrinePrompt();
    out.doctrine = { ok: true, chars: doctrine.length };
  } catch (e) {
    out.doctrine = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const gate = await loadGatePrompt();
    out.gate = { ok: true, chars: gate.length };
  } catch (e) {
    out.gate = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 표가 준비됐는가 (마이그레이션 적용 여부). 건수는 세지 않는다 — 있음/없음만.
  //
  // **`head: true` 를 쓰면 안 된다.** HEAD 요청에는 본문이 없어서 supabase-js 가 PostgREST 의
  // 404 를 에러 객체로 만들지 못하고 `error` 가 null 로 온다 → 없는 표를 '있다' 고 답한다.
  // 2026-09-18 프로덕션에서 실제로 그렇게 거짓을 말했다(표 7개가 하나도 없는데 전부 true).
  const tables = [
    "ai_questions",
    "ai_question_answers",
    "ai_question_views",
    "qa_lists",
    "sermons",
    "sermon_refs",
    "sermon_ingest_runs",
  ] as const;
  const ready: Record<string, boolean> = {};
  for (const t of tables) {
    const { error } = await supabaseAdmin.from(t).select("id").limit(1);
    ready[t] = !error;
  }
  out.tables = ready;

  // 표가 있어도 공유 칸이 빠지면 공개 저장은 작동하지 않는다.
  const { error: shareError } = await supabaseAdmin
    .from("ai_questions")
    .select("shared, shared_at, share_hidden_at, share_hidden_by")
    .limit(1);
  out.sharing = { ok: !shareError };

  // 목록이 심겼는가 — 이단 목록이 비면 답이 스스로 이단을 규정하려 든다(§9 를 지키는 장치가 목록이다)
  if (ready.qa_lists) {
    const { data: listRows } = await supabaseAdmin
      .from("qa_lists")
      .select("kind")
      .eq("enabled", true);
    const tally: Record<string, number> = {};
    for (const r of listRows ?? []) {
      const kind = (r as { kind: string }).kind;
      tally[kind] = (tally[kind] ?? 0) + 1;
    }
    out.lists = {
      heresy: tally.heresy ?? 0,
      crisis: tally.crisis ?? 0,
      housechurch: tally.housechurch ?? 0,
      lifestudy: tally.lifestudy ?? 0,
    };
  } else {
    out.lists = null;
  }

  // 설교 자동 들여오기가 **정말 돌 수 있는 상태인가.**
  //  - `CRON_SECRET` 이 없으면 Vercel cron 은 인증 헤더 없이 오고 라우트가 403 으로 막는다.
  //    즉 날마다 부르기는 하지만 **한 번도 들어오지 못한다** — 오류도 안 나서 모르고 지나간다.
  //  - 폴더가 서비스 계정에 공유되지 않으면 목록이 0편으로 나온다(이것도 오류가 아니다).
  //    그래서 마지막 실행 결과를 함께 보인다.
  const cron: Record<string, unknown> = { secret_set: !!process.env.CRON_SECRET };
  if (ready.sermon_ingest_runs) {
    const { data: runs } = await supabaseAdmin
      .from("sermon_ingest_runs")
      .select("ran_at, trigger, scanned, inserted, updated, skipped, failures, error")
      .order("ran_at", { ascending: false })
      .limit(1);
    const last = runs?.[0] ?? null;
    cron.last_run = last
      ? {
          ran_at: last.ran_at,
          trigger: last.trigger,
          scanned: last.scanned,
          inserted: last.inserted,
          updated: last.updated,
          skipped: last.skipped,
          failures: Array.isArray(last.failures) ? last.failures.length : 0,
          error: last.error ?? null,
        }
      : null;
    if (last && last.scanned === 0 && !last.error) {
      cron.hint = "설교를 한 편도 못 찾았습니다 — 드라이브 폴더를 서비스 계정에 공유해야 합니다.";
    }
  }
  if (!cron.secret_set) {
    cron.hint_secret = "CRON_SECRET 이 없어 자동 들여오기가 막힙니다(수퍼어드민이 손으로만 돌릴 수 있습니다).";
  }
  out.cron = cron;

  const okAll =
    (out.doctrine as { ok: boolean }).ok &&
    (out.gate as { ok: boolean }).ok &&
    Object.values(ready).every(Boolean) &&
    !shareError;
  out.ok = okAll;

  return NextResponse.json(out, {
    // 점검 창구는 캐시하지 않는다 — 방금 마이그레이션을 돌린 사람이 옛 답을 보면 안 된다.
    headers: { "Cache-Control": "no-store" },
  });
}
