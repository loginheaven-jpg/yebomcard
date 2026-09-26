/** 성경 질문: 일반 Flash·Luna, 교리/어려운 해석 Flash·Luna·Terra.
 * 과거 chatgpt·claude 키와 응답은 별도로 보존한다. */
import { callAI } from "@/lib/aiGateway";

export type ColumnKey = "gemini" | "luna" | "terra" | "chatgpt" | "claude";

export interface QaColumn {
  key: ColumnKey;
  /** 화면에 보이는 이름 */
  label: string;
  /** 게이트웨이에 요청하는 별칭 */
  provider: string;
  model?: string;
  /** 응답 `model` 이 이 가운데 하나로 시작해야 그 칸의 답으로 인정한다 */
  modelPrefixes: string[];
}

/** 공용 게이트웨이 별칭은 그대로 두고 GPT 모델만 요청별로 지정한다. */
export const QA_COLUMNS: QaColumn[] = [
  { key: "gemini", label: "Gemini Flash", provider: "gemini-flash", modelPrefixes: ["gemini-"] },
  { key: "luna", label: "GPT Luna", provider: "chatgpt", model: "gpt-5.6-luna", modelPrefixes: ["gpt-5.6-luna"] },
  { key: "terra", label: "GPT Terra", provider: "chatgpt", model: "gpt-5.6-terra", modelPrefixes: ["gpt-5.6-terra"] },
];

// 이미 저장된 질문·배포 전에 열어 둔 창의 키는 별도로 유지한다.
const LEGACY_COLUMNS: QaColumn[] = [
  { key: "chatgpt", label: "ChatGPT", provider: "chatgpt", modelPrefixes: ["gpt-"] },
  { key: "claude", label: "Claude", provider: "claude-sonnet", modelPrefixes: ["claude-"] },
];

export function columnOf(key: string): QaColumn | undefined {
  return [...QA_COLUMNS, ...LEGACY_COLUMNS].find((c) => c.key === key);
}

/** 새 칸 이름을 과거 답변에 덮어쓰지 않는다. 응답 모델이 표시의 기준이다. */
export function answerLabel(key: string, model?: string | null): string {
  if (model?.startsWith("claude-")) return "Claude";
  if (model?.startsWith("gpt-5.6-luna")) return "GPT Luna";
  if (model?.startsWith("gpt-5.6-terra")) return "GPT Terra";
  if (model?.startsWith("gpt-")) return "ChatGPT";
  if (model?.startsWith("gemini-")) return "Gemini Flash";
  return columnOf(key)?.label ?? key;
}

/** 교리·어려운 해석·선별 실패는 Terra까지 세 칸. */
export const BASE_COLUMNS: ColumnKey[] = ["gemini", "luna"];
export const DOCTRINE_COLUMNS: ColumnKey[] = ["gemini", "luna", "terra"];

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
      ...(column.model ? { model: column.model } : {}),
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
