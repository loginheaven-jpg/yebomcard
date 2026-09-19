/**
 * 성경 질문 — 선별(게이트)
 *
 * 값싼 모델 하나가 질문을 crisis · basic · doctrine · deny 로 가른다(docs/BIBLE_QA_DOCTRINE.md §A).
 * 여기서 걸러야 비싼 모델을 부르지 않고, 위기 신호를 답변보다 먼저 잡는다.
 * **몇 칸이 답할지도 여기서 정해진다**(지휘부 2026-09-19) — basic 이면 두 칸, doctrine 이면 세 칸(§B-3-1).
 */
import { callAI } from "@/lib/aiGateway";
import { loadGatePrompt } from "./prompt";

export type GateVerdict = "crisis" | "allow" | "deny" | "error";

/**
 * 통과한 질문의 갈래. 판정(`GateVerdict`)과 따로 둔다 — 기록의 `gate_result` 는 옛 기록 · 관리자 화면과
 * 같은 값(`allow`)을 쓰고, 갈래는 칸을 고르는 데만 쓴다(낱말 그대로는 `gate_raw` 에 남는다).
 */
export type GateKind = "basic" | "doctrine";

/**
 * **max_tokens 를 작게 주면 안 된다.**
 *
 * 문서(§A)는 `max_tokens: 8` 로 적었는데, Gemini 는 thinking 토큰이 max_tokens 를 먹는다.
 * 2026-09-18 실측(15개 질문): `gemini-flash` + 8 → **0/15**, 모든 응답이
 * `[Empty response: FinishReason.MAX_TOKENS]` 였다. 그대로 두면 게이트가 늘 실패해
 * **위기 신호를 한 번도 잡지 못한다**(실패는 통과로 처리하므로 조용히 지나간다).
 * 1024 로 올리면 15/15 이고, 출력 토큰은 호출당 1개뿐이라 값도 거의 같다.
 */
const GATE_MAX_TOKENS = 1024;

/**
 * 선별을 얼마나 기다리는가.
 *
 * 처음에는 8초였다(게이트웨이가 스스로 잰 시간 중앙값 1.07초·최대 7.26초를 보고 잡았다).
 * **운영에서 틀렸다**(2026-09-18): 그 숫자는 게이트웨이 **안에서** 모델을 부른 시간일 뿐이고,
 * 게이트웨이 앞단이 따로 느렸다 — 모델을 부르지 않는 캐시 적중이 3.9~30.8초, 한 낱말 선별의
 * 벽시계가 10~14초였다. 그래서 운영의 첫 두 질문은 **둘 다 선별이 시간 초과로 통과**됐다.
 *
 * 20초로 늘렸다. 게이트웨이를 고친 뒤(2026-09-19) 선별은 1초 안팎이지만, 게이트웨이가 다시
 * 느려지는 날의 여유로 그대로 둔다(2026-09-19 검토 — 드물게만 쓰이는 값이라 바꾸지 않는다).
 * 시간 초과가 나도 위기를 놓치지 않게 `crisisSignal.ts` 가 받친다(아래 `decide`).
 */
const GATE_TIMEOUT_MS = 20_000;

/**
 * 게이트는 게이트웨이의 `gemini-lite` 별칭으로 한다(2026-09-19) — 한 낱말 판정용으로 게이트웨이가 만든 것
 * (gemini-3.5-flash-lite, 생각 끔). **모델 이름을 여기 박지 않는다** — 모델이 바뀌면 게이트웨이 설정만 고친다.
 * 실측: 보기에 없는 21문장 × 2회 42/42(위기 18/18), 두 갈래 가르기 24문장 × 2회 48/48, 중앙 0.9초.
 * (예전 `gemini-flash` 는 같은 판정에 1.4초, 6초 넘으면 flash-lite 로 넘어가 최대 7.3초였다.)
 */
const GATE_PROVIDER = "gemini-lite";

/** Gemini 가 thinking 토큰으로 한도를 소진하면 HTTP 200 으로 이 문자열이 온다. */
const EMPTY_SENTINEL = "[Empty response";

export interface GateResult {
  verdict: GateVerdict;
  /** 통과(allow)일 때의 갈래. 그 밖(위기·거절·실패)에는 null */
  kind: GateKind | null;
  /** 모델이 실제로 돌려준 글자(기록·디버깅용) */
  raw: string;
  elapsedMs: number;
}

function readVerdict(text: string): { verdict: GateVerdict; kind: GateKind | null } | null {
  const t = (text || "").toLowerCase();
  // crisis 를 가장 먼저 본다 — 섞여 있으면 crisis 다(§A 규칙 1).
  if (/\bcrisis\b/.test(t)) return { verdict: "crisis", kind: null };
  // 애매하면 doctrine(§A 규칙 2) — 둘이 섞여 오면 칸이 많은 쪽으로.
  if (/\bdoctrine\b/.test(t)) return { verdict: "allow", kind: "doctrine" };
  if (/\bbasic\b/.test(t)) return { verdict: "allow", kind: "basic" };
  // 옛 프롬프트의 낱말. 갈래를 모르니 칸이 많은 쪽으로 둔다.
  if (/\ballow\b/.test(t)) return { verdict: "allow", kind: "doctrine" };
  if (/\bdeny\b/.test(t)) return { verdict: "deny", kind: null };
  return null;
}

/**
 * 질문 하나를 가른다.
 *
 * 실패(빈 응답·오류·시간 초과)는 **통과**로 돌려준다 — 값싼 문이 신앙 질문을 막으면
 * 교인은 다시 쓰지 않는다(§A). 무관한 질문은 답변 프롬프트 §2-4 가 한 번 더 막는다.
 * 다만 통과시킨 사실을 `verdict: "error"` 로 남겨, 기록에서 진짜 allow 와 구별한다.
 */
export async function gateQuestion(question: string): Promise<GateResult> {
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GATE_TIMEOUT_MS);
  try {
    const gatePrompt = await loadGatePrompt();
    const res = await callAI([{ role: "user", content: question }], {
      provider: GATE_PROVIDER,
      system_prompt: gatePrompt,
      max_tokens: GATE_MAX_TOKENS,
      temperature: 0,
      // 같은 질문이 매번 같게 갈려야 한다. 캐시는 그 편에 선다(1시간 TTL).
      use_cache: true,
      // 선별을 다른 모델이 대신하면 기준이 달라진다.
      use_fallback: false,
      caller: "yebom-card:qa-gate",
      signal: ac.signal,
    });
    const raw = res.content ?? "";
    if (raw.includes(EMPTY_SENTINEL)) {
      return { verdict: "error", kind: null, raw, elapsedMs: Date.now() - startedAt };
    }
    const read = readVerdict(raw);
    return {
      verdict: read?.verdict ?? "error",
      kind: read?.kind ?? null,
      raw: raw.slice(0, 200),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      verdict: "error",
      kind: null,
      raw: ac.signal.aborted ? `TIMEOUT ${GATE_TIMEOUT_MS}ms` : msg.slice(0, 200),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 게이트가 error 면 모델을 부른다(통과). deny·crisis 만 막는다. */
export function shouldCallModels(verdict: GateVerdict): boolean {
  return verdict === "allow" || verdict === "error";
}

/**
 * Claude 칸까지 부르는가(§B-3-1). 교리가 걸렸거나, **선별이 실패해 갈래를 모를 때** —
 * 교리 질문일 수도 있으니 칸이 많은 쪽으로 둔다(선별 실패는 드물다).
 */
export function wantsDoctrineColumns(verdict: GateVerdict, kind: GateKind | null): boolean {
  if (verdict === "error") return true;
  return verdict === "allow" && kind !== "basic";
}

/**
 * 선별 결과와 안전망을 합쳐 최종 판정을 낸다.
 *
 *  - 선별이 제때 답했으면 **선별을 따른다**(안전망 말이 있어도 — '욥은 왜 죽고 싶다고 했나요' 는 통과)
 *  - 선별이 실패했는데 **위기를 시사하는 1인칭 말**이 있으면 → crisis(막는다, 모델을 부르지 않는다)
 *  - 선별이 실패했고 그런 말도 없으면 → error(문서대로 통과)
 *
 * 놓치는 쪽이 잘못 막는 쪽보다 나쁘다. 잘못 막으면 상담 창구가 보일 뿐이다.
 */
export function decide(gate: GateVerdict, localSignal: boolean): GateVerdict {
  if (gate !== "error") return gate;
  return localSignal ? "crisis" : "error";
}
