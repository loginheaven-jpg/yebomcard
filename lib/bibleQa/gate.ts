/**
 * 성경 질문 — 선별(게이트)
 *
 * 값싼 모델 하나가 질문을 crisis · allow · deny 로 가른다(docs/BIBLE_QA_DOCTRINE.md §A).
 * 여기서 걸러야 비싼 세 모델을 부르지 않고, 위기 신호를 답변보다 먼저 잡는다.
 */
import { callAI } from "@/lib/aiGateway";
import { loadGatePrompt } from "./prompt";

export type GateVerdict = "crisis" | "allow" | "deny" | "error";

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
 * 문서(§A)는 1.5초를 넘으면 통과라고 적었다. 그런데 게이트웨이가 스스로 잰 시간이
 * 중앙값 1.07초 · 최대 7.26초였다(2026-09-18 실측, `gemini-flash`).
 * 1.5초로 자르면 상당수가 **선별 없이** 통과해 위기 신호를 놓친다 —
 * 놓치는 쪽이 기다리는 쪽보다 나쁘므로 8초로 둔다.
 */
const GATE_TIMEOUT_MS = 8000;

/** 게이트는 gemini-flash 로 한다 — 목록에서 가장 싸고, 위 실측에서 15/15 였다. */
const GATE_PROVIDER = "gemini-flash";

/** Gemini 가 thinking 토큰으로 한도를 소진하면 HTTP 200 으로 이 문자열이 온다. */
const EMPTY_SENTINEL = "[Empty response";

export interface GateResult {
  verdict: GateVerdict;
  /** 모델이 실제로 돌려준 글자(기록·디버깅용) */
  raw: string;
  elapsedMs: number;
}

function readVerdict(text: string): GateVerdict | null {
  const t = (text || "").toLowerCase();
  // crisis 를 가장 먼저 본다 — 섞여 있으면 crisis 다(§A 규칙 1).
  if (/\bcrisis\b/.test(t)) return "crisis";
  if (/\ballow\b/.test(t)) return "allow";
  if (/\bdeny\b/.test(t)) return "deny";
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
      return { verdict: "error", raw, elapsedMs: Date.now() - startedAt };
    }
    const verdict = readVerdict(raw);
    return {
      verdict: verdict ?? "error",
      raw: raw.slice(0, 200),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      verdict: "error",
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
