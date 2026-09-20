/**
 * 말씀의삶 — AI 로 진도표 초안 만들기 (지휘부 2026-09-20)
 *
 * 교인이 한 줄 적으면("요한복음을 30일에, 주 5일만") AI 가 **초안만** 만든다. 저장은 사람이 한다.
 *
 * 두 갈래를 받는다.
 *  - `auto` — AI 는 **범위(책)와 회차 수만** 정하고, 회차는 서버가 절 수 기준으로 나눈다.
 *    회차가 많은 진도표(1년 통독 365회차)는 AI 에게 다 적게 하면 답이 잘린다. 이쪽이 정확하고 싸다.
 *  - `units` — "첫 주는 창세기 1-3씩" 처럼 구조를 직접 말했을 때. 120회차까지만 받는다.
 *
 * **AI 가 준 것을 그대로 쓰지 않는다.** 없는 책·장 수를 넘는 범위는 서버가 걸러 내고(`sanitizeUnits`),
 * 검사 결과를 함께 돌려줘 사람이 보고 고친다. 선별(성경 질문 §A)은 거치지 않는다 — 교리 질문이 아니다.
 */
import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/aiGateway";
import { rateLimit } from "@/lib/rateLimit";
import { readSession } from "@/lib/readingGroups";
import { BOOKS, CHAPTER_COUNTS } from "@/lib/books";
import {
  MAX_PLAN_NAME,
  MAX_UNITS,
  autoUnits,
  planStats,
  sanitizeUnits,
  validateUnits,
} from "@/lib/plans/builder";

export const dynamic = "force-dynamic";

/** 모델 시간 + 게이트웨이. 초안 하나라 넉넉하면 된다. */
export const maxDuration = 60;
const TIMEOUT_MS = 40_000;
/** units 갈래로 받을 수 있는 최대 회차 — 넘으면 답이 잘린다 */
const MAX_AI_UNITS = 120;

const BOOK_TABLE = BOOKS.map((b) => `${b.code}=${b.nameKr}(${CHAPTER_COUNTS[b.code]}장)`).join(" · ");

const SYSTEM = `너는 교회 성경읽기 진도표를 짜는 장치다. 사람이 적은 한 줄을 읽고 **JSON 하나만** 출력한다.

쓸 수 있는 책 코드와 장 수:
${BOOK_TABLE}

출력은 둘 중 하나다.
1) 범위와 회차 수만 정할 때(길고 고른 진도표에 알맞다):
{"mode":"auto","name":"진도표 이름","books":["jhn"],"unitCount":30}
2) 회차를 직접 적을 때(120회차까지):
{"mode":"units","name":"진도표 이름","units":[{"label":"요한복음 1-3","ranges":[{"book":"jhn","fromCh":1,"toCh":3}]}]}

규칙
- 책은 위 표의 코드만 쓴다. 표에 없는 코드를 지어내지 않는다.
- 장 번호는 그 책의 장 수를 넘지 않는다. 장을 절로 쪼개지 않는다.
- "주 5일" 처럼 쉬는 날이 있으면 회차 수를 그만큼 줄인다(예: 30일·주5일 → 22회차).
- 이름은 20자 안쪽으로, 사람이 알아볼 수 있게 적는다.
- 회차 수를 말하지 않으면 하루 3~4장쯤으로 잡는다.
- JSON 말고 다른 글자를 붙이지 않는다.`;

function readJson(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < 0) return null;
  try {
    return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  // AI 호출이라 넉넉하지 않게 — 한 사람이 10분에 10번
  const limited = rateLimit(request, "reading-plans-draft", 10, 10 * 60_000);
  if (limited) return limited;

  const session = await readSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const prompt = String((body as { prompt?: unknown }).prompt ?? "").trim().slice(0, 200);
  if (!prompt) return NextResponse.json({ error: "어떤 진도표를 원하시는지 적어 주세요" }, { status: 400 });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let raw = "";
  try {
    const res = await callAI([{ role: "user", content: prompt }], {
      provider: "gemini-flash",
      system_prompt: SYSTEM,
      max_tokens: 8192,
      temperature: 0.2,
      use_fallback: false,
      use_cache: true,
      caller: "yebom-card:plan-draft",
      signal: ac.signal,
    });
    raw = res.content ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reading-plans/draft] 실패", msg);
    return NextResponse.json({ error: "지금은 초안을 만들지 못했습니다. 잠시 뒤 다시 해 주세요." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const json = readJson(raw);
  if (!json) {
    return NextResponse.json({ error: "초안을 읽지 못했습니다. 조금 더 자세히 적어 주세요." }, { status: 422 });
  }

  const name = String(json.name ?? "").trim().slice(0, MAX_PLAN_NAME);
  let units = [];
  let note: string | null = null;

  if (json.mode === "units" && Array.isArray(json.units)) {
    if (json.units.length > MAX_AI_UNITS) {
      return NextResponse.json(
        { error: `회차가 너무 많습니다(${json.units.length}). 범위와 기간으로 다시 말씀해 주세요.` },
        { status: 422 },
      );
    }
    units = sanitizeUnits(json.units);
  } else {
    // auto — 책과 회차 수만 받는다. 회차는 **서버가** 절 수 기준으로 나눈다.
    const books = Array.isArray(json.books)
      ? (json.books as unknown[]).map(String).filter((c) => !!CHAPTER_COUNTS[c])
      : [];
    const unitCount = Math.max(1, Math.min(MAX_UNITS, Math.floor(Number(json.unitCount) || 0)));
    if (books.length === 0 || !unitCount) {
      return NextResponse.json({ error: "어떤 책을 몇 회로 읽을지 알아듣지 못했습니다" }, { status: 422 });
    }
    // 성경 순서로 정렬해 나눈다(AI 가 순서를 뒤섞어 줄 수 있다).
    const ordered = BOOKS.map((b) => b.code).filter((c) => books.includes(c));
    units = autoUnits(ordered, unitCount);
    note = "AI 가 고른 범위를 앱이 절 수 기준으로 고르게 나눴습니다.";
  }

  if (units.length === 0) {
    return NextResponse.json({ error: "초안을 만들지 못했습니다. 조금 더 자세히 적어 주세요." }, { status: 422 });
  }

  const issues = validateUnits(units);
  const stats = planStats(units);
  return NextResponse.json({
    name: name || "새 진도표",
    units,
    stats,
    note,
    errors: issues.errors,
    warnings: issues.warnings,
  });
}
