/**
 * 성경 질문 — 칸(모델) 정의와 답 받아 오기
 *
 * 화면은 Gemini · ChatGPT 두 칸(교리 질문이면 Claude 까지 세 칸)이고, 답을 합치지 않는다.
 * 그래서 **칸 라벨이 사실이어야 한다** — Gemini 칸에 Claude 답이 들어가면
 * "답이 갈리는 이유가 모델이 달라서" 라는 전제가 무너진다(docs/BIBLE_QA_DOCTRINE.md §B-4).
 *
 * 그 보장은 두 겹이다.
 *  1. `use_fallback: false` — 게이트웨이의 자동 대체를 끈다(2026-09-18 실측으로 실제 동작 확인).
 *  2. 응답의 **`model`** 이 그 칸의 것인지 대조 — 응답의 `provider` 로는 안 된다.
 *     그 필드는 계열명으로 정규화돼 와서(`gemini-flash` → `"gemini"`),
 *     정상 응답과 강등된 응답이 **같은 문자열**로 온다(같은 날 실측).
 */
import { callAI } from "@/lib/aiGateway";

export type ColumnKey = "gemini" | "chatgpt" | "claude";

export interface QaColumn {
  key: ColumnKey;
  /** 화면에 보이는 이름 */
  label: string;
  /** 게이트웨이에 요청하는 별칭 */
  provider: string;
  /** 응답 `model` 이 이 가운데 하나로 시작해야 그 칸의 답으로 인정한다 */
  modelPrefixes: string[];
}

/**
 * 칸마다 게이트웨이 별칭을 부른다 — 모델은 게이트웨이가 정한다(2026-09-19: gemini-3.8-flash ·
 * gpt-5.6-terra · claude-sonnet-5). Gemini 칸은 6초 안에 답이 없으면 게이트웨이가 같은 Gemini 의
 * flash-lite 로 바꿔 부른다 — `model` 이 `gemini-` 로 시작하므로 라벨은 그대로 참이다.
 */
export const QA_COLUMNS: QaColumn[] = [
  { key: "gemini", label: "Gemini", provider: "gemini-flash", modelPrefixes: ["gemini-"] },
  { key: "chatgpt", label: "ChatGPT", provider: "chatgpt", modelPrefixes: ["gpt-"] },
  { key: "claude", label: "Claude", provider: "claude-sonnet", modelPrefixes: ["claude-"] },
];

export function columnOf(key: string): QaColumn | undefined {
  return QA_COLUMNS.find((c) => c.key === key);
}

/**
 * **어느 칸이 답하는가 — 앱이 정한다**(지휘부 2026-09-19, docs/BIBLE_QA_DOCTRINE.md §B-3-1).
 * 교인은 AI 를 고르지 않는다. 늘 Gemini · ChatGPT 두 칸이 답하고, 교리가 걸린 질문(선별 `doctrine`,
 * 또는 선별이 실패해 모를 때)에는 Claude 를 더한다.
 *
 * 왜 Claude 를 늘 부르지 않나 — 세 칸을 가린 채 채점해 보니(질문 14개, 대결과 무관한 심사자)
 * 교리 질문에서도 세 모델이 비슷했고, Claude 는 한 답에 약 $0.04 로 다른 두 칸을 합친 값의 두 배가 넘는다.
 */
export const BASE_COLUMNS: ColumnKey[] = ["gemini", "chatgpt"];
export const DOCTRINE_COLUMNS: ColumnKey[] = ["gemini", "chatgpt", "claude"];

export function columnsFor(doctrine: boolean): ColumnKey[] {
  return doctrine ? DOCTRINE_COLUMNS : BASE_COLUMNS;
}

/**
 * 답 하나당 시간 상한(기본값).
 *
 * 처음에는 40초였다. **운영에서 Claude 가 두 번 다 잘렸다**(2026-09-18) — 그때는 게이트웨이가
 * 요청마다 DB 에 동기로 붙어 앞단에서만 10초 안팎을 더했고, Claude 모델 시간도 31~36초였다.
 * 게이트웨이를 고친 뒤(2026-09-19) 세 칸이 동시에 2.5 · 4.7 · 10.7초(중앙값)에 오고, 게이트웨이도
 * 칸마다 30초에서 스스로 끊는다. 100초는 이제 여유가 크지만 게이트웨이가 다시 느려지는 날을 위해 둔다.
 */
export const ANSWER_TIMEOUT_MS = 100_000;

/**
 * Gemini 는 thinking 토큰이 max_tokens 를 먹는다 — 작게 주면 HTTP 200 에
 * 빈 응답이 실려 온다. 답은 9~14 문장(§4)이라 4096 이면 넉넉하다.
 */
const ANSWER_MAX_TOKENS = 4096;

const EMPTY_SENTINEL = "[Empty response";

export interface AnswerResult {
  columnKey: ColumnKey;
  providerAlias: string;
  ok: boolean;
  content: string | null;
  /** 게이트웨이가 돌려준 실제 모델 이름 */
  model: string | null;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number;
}

export interface AskColumnInput {
  column: QaColumn;
  systemPrompt: string;
  question: string;
  /** '다시 묻기' 는 캐시를 끈다 — 켜 두면 한 시간 동안 같은 답이 재생된다. */
  useCache: boolean;
  /** 이 칸을 기다리는 시간. 없으면 ANSWER_TIMEOUT_MS */
  timeoutMs?: number;
}

/** 한 칸에 묻는다. **던지지 않는다** — 실패도 결과로 돌려주어 그 칸만 비운다. */
export async function askColumn(input: AskColumnInput): Promise<AnswerResult> {
  const { column } = input;
  const startedAt = Date.now();
  const ac = new AbortController();
  const timeoutMs = input.timeoutMs ?? ANSWER_TIMEOUT_MS;
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  const base = {
    columnKey: column.key,
    providerAlias: column.provider,
    inputTokens: null as number | null,
    outputTokens: null as number | null,
  };

  try {
    const res = await callAI([{ role: "user", content: input.question }], {
      provider: column.provider,
      system_prompt: input.systemPrompt,
      max_tokens: ANSWER_MAX_TOKENS,
      temperature: 0.7,
      use_fallback: false,
      use_cache: input.useCache,
      caller: `yebom-card:qa-${column.key}`,
      signal: ac.signal,
    });

    const elapsedMs = Date.now() - startedAt;
    const model = res.model ?? "";
    const content = res.content ?? "";
    const usage = {
      inputTokens: res.usage?.input_tokens ?? null,
      outputTokens: res.usage?.output_tokens ?? null,
    };

    // 폴백을 껐어도 게이트웨이 설정이 바뀌면 다른 모델이 답할 수 있다.
    // 라벨이 거짓이 되는 것보다 칸을 비우는 편이 낫다.
    if (!column.modelPrefixes.some((p) => model.startsWith(p))) {
      return {
        ...base,
        ...usage,
        ok: false,
        content: null,
        model,
        error: `MODEL_MISMATCH: ${model}`,
        elapsedMs,
      };
    }
    if (content.includes(EMPTY_SENTINEL) || content.trim().length === 0) {
      return {
        ...base,
        ...usage,
        ok: false,
        content: null,
        model,
        error: "EMPTY_RESPONSE",
        elapsedMs,
      };
    }
    return { ...base, ...usage, ok: true, content, model, error: null, elapsedMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      ok: false,
      content: null,
      model: null,
      error: ac.signal.aborted ? `TIMEOUT ${timeoutMs}ms` : msg.slice(0, 300),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 여러 칸에 동시에 묻는다. 한 칸이 실패해도 나머지는 그대로 돌아온다. */
export async function askColumns(
  columns: QaColumn[],
  shared: Omit<AskColumnInput, "column">,
): Promise<AnswerResult[]> {
  return Promise.all(columns.map((column) => askColumn({ ...shared, column })));
}
