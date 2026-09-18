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
  const tables = ["ai_questions", "ai_question_answers", "qa_lists", "sermons"] as const;
  const ready: Record<string, boolean> = {};
  for (const t of tables) {
    const { error } = await supabaseAdmin.from(t).select("id", { head: true, count: "exact" });
    ready[t] = !error;
  }
  out.tables = ready;

  // 목록이 심겼는가 — 이단 목록이 비면 답이 스스로 이단을 규정하려 든다(§9 를 지키는 장치가 목록이다)
  const { count: heresyCount } = await supabaseAdmin
    .from("qa_lists")
    .select("id", { head: true, count: "exact" })
    .eq("kind", "heresy")
    .eq("enabled", true);
  const { count: crisisCount } = await supabaseAdmin
    .from("qa_lists")
    .select("id", { head: true, count: "exact" })
    .eq("kind", "crisis")
    .eq("enabled", true);
  out.lists = { heresy: heresyCount ?? null, crisis: crisisCount ?? null };

  const okAll =
    (out.doctrine as { ok: boolean }).ok &&
    (out.gate as { ok: boolean }).ok &&
    Object.values(ready).every(Boolean);
  out.ok = okAll;

  return NextResponse.json(out, {
    // 점검 창구는 캐시하지 않는다 — 방금 마이그레이션을 돌린 사람이 옛 답을 보면 안 된다.
    headers: { "Cache-Control": "no-store" },
  });
}
