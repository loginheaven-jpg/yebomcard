/**
 * AI Gateway 유틸리티
 * 서버사이드 전용 (API Route에서만 사용)
 */

const AI_GATEWAY_URL =
  process.env.AI_GATEWAY_URL ||
  "https://ai-gateway20251125.up.railway.app";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface CallAIOptions {
  provider?: string;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
  caller?: string;
  /**
   * 게이트웨이의 자동 대체를 끈다. **기본값이 true 라 끄려면 반드시 명시해야 한다.**
   * 성경 질문의 세 칸은 "답이 갈리는 이유가 모델이 달라서" 라는 전제 위에 서 있어서,
   * Gemini 칸에 Claude 답이 들어오면 화면이 거짓말을 한다
   * (docs/BIBLE_QA_DOCTRINE.md §B-4).
   */
  use_fallback?: boolean;
  /**
   * 게이트웨이 응답 캐시(TTL 1시간). 기본 true — 같은 본문+provider 는 한 시간 안에 같은 답이 재생된다.
   * 값이 싸고 빨라 평소엔 켜 두고, '다시 묻기' 처럼 새 답이 필요할 때만 false 로 한다.
   */
  use_cache?: boolean;
}

export async function callAI(
  messages: ChatMessage[],
  options?: CallAIOptions & { signal?: AbortSignal },
): Promise<ChatResult> {
  // signal 은 fetch 옵션이고 나머지는 본문이다 — 함께 JSON.stringify 하면 AbortSignal 이 빈 객체로 실려 나간다.
  const { signal, ...body } = options ?? {};
  const res = await fetch(`${AI_GATEWAY_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      ...body,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw new Error(`AI_ERROR: ${res.status} ${err.detail}`);
  }

  return res.json();
}

// ─── Image Generation ─────────────────────────────────────

export interface ImageResult {
  data: string; // base64
  media_type: string;
  provider: string;
  model: string;
  size: string;
  revised_prompt?: string;
  elapsed_ms?: number;
}

export async function callImage(
  prompt: string,
  options?: {
    size?: string;
    style?: string;
    provider?: string;
    caller?: string;
  }
): Promise<ImageResult> {
  const res = await fetch(`${AI_GATEWAY_URL}/api/ai/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...options,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw new Error(`IMAGE_ERROR: ${res.status} ${err.detail}`);
  }

  return res.json();
}

// ─── Image Edit (text removal etc.) ──────────────────────

export async function callImageEdit(
  imageBase64: string,
  mediaType: string,
  editType: string = "remove_text",
  caller?: string,
  provider?: string,
): Promise<ImageResult> {
  const res = await fetch(`${AI_GATEWAY_URL}/api/ai/image/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: imageBase64,
      media_type: mediaType,
      edit_type: editType,
      ...(caller && { caller }),
      ...(provider && { provider }),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw new Error(`IMAGE_EDIT_ERROR: ${res.status} ${err.detail}`);
  }

  return res.json();
}
