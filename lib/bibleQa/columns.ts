/**
 * 성경 질문 — 세 칸(모델) 정의와 답 받아 오기
 *
 * 화면은 Gemini · ChatGPT · Claude 세 칸이고, 답을 합치지 않는다.
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
 * `gemini-pro` 는 2026-09-18 현재 게이트웨이에서 **고장나 있다**
 * (설정된 모델 ID `gemini-3.1-pro` 가 404 NOT_FOUND). 폴백을 끈 상태로 부르면 100% 실패한다.
 * 그래서 Gemini 칸은 `gemini-flash` 로 둔다 — 고쳐지면 이 한 줄만 바꾼다.
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
 * 답 하나당 시간 상한. 게이트웨이가 스스로 잰 provider 소요는 0.65~3.7초였지만
 * 앞단·네트워크가 더해진다(2026-09-18 실측). 라우트 전체 상한(60초) 안에서
 * 한 칸이 늦어도 나머지 칸이 살아 돌아오게 잡은 값이다.
 */
const ANSWER_TIMEOUT_MS = 40_000;

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
}

/** 한 칸에 묻는다. **던지지 않는다** — 실패도 결과로 돌려주어 그 칸만 비운다. */
export async function askColumn(input: AskColumnInput): Promise<AnswerResult> {
  const { column } = input;
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ANSWER_TIMEOUT_MS);

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
      error: ac.signal.aborted ? `TIMEOUT ${ANSWER_TIMEOUT_MS}ms` : msg.slice(0, 300),
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
