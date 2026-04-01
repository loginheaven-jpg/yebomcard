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

export async function callAI(
  messages: ChatMessage[],
  options?: {
    provider?: string;
    system_prompt?: string;
    max_tokens?: number;
    temperature?: number;
    caller?: string;
  }
): Promise<ChatResult> {
  const res = await fetch(`${AI_GATEWAY_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      ...options,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown" }));
    throw new Error(`AI_ERROR: ${res.status} ${err.detail}`);
  }

  return res.json();
}
