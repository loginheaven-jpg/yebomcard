import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/aiGateway";

const AI_GATEWAY_URL =
  process.env.AI_GATEWAY_URL ||
  "https://ai-gateway20251125.up.railway.app";

// TODO: Gateway에 /api/ai/image 추가 후 활성화
// → AI_IMAGE_GENERATION_REQUEST.md 참조
const USE_IMAGE_GENERATION = false;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { verseText, keywords = [] } = body;

    if (!verseText || typeof verseText !== "string") {
      return NextResponse.json(
        { error: "구절 텍스트가 필요합니다" },
        { status: 400 }
      );
    }

    // ─── 이미지 생성 모드 (Gateway 준비 후 USE_IMAGE_GENERATION = true) ───
    if (USE_IMAGE_GENERATION) {
      const kw = keywords.length > 0 ? keywords.join(", ") : "peaceful";
      const prompt = `A serene ${kw} landscape, spiritual atmosphere, suitable for text overlay, Bible verse card background, 4:5 portrait orientation`;

      const res = await fetch(`${AI_GATEWAY_URL}/api/ai/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          size: "1080x1350",
          style: "natural",
          caller: "yebom-card:background",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          type: "image",
          url: data.url || data.data,
          provider: data.provider,
        });
      }
      // 이미지 생성 실패 → gradient fallback
    }

    // ─── Gradient fallback (현재 기본 모드) ───

    const kw = keywords.length > 0 ? keywords.join(",") : "";

    const result = await callAI(
      [
        {
          role: "user",
          content: `"${verseText}" 말씀에 어울리는 CSS gradient 배경 2개. ${kw ? `키워드:${kw}.` : ""} JSON만:
[{"name":"이름","gradient":"linear-gradient(...)","textColor":"white"}]
textColor: white 또는 dark. 설명 금지.`,
        },
      ],
      {
        provider: "gemini-flash",
        max_tokens: 4096,
        temperature: 0.8,
        caller: "yebom-card:background",
      }
    );

    const content = result.content.trim();
    const backgrounds = parsePartialJsonArray(content);

    if (backgrounds.length === 0) {
      return NextResponse.json(
        { error: "배경 생성 파싱 실패" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      backgrounds,
      provider: result.provider,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `배경 생성 실패: ${message}` },
      { status: 500 }
    );
  }
}

function parsePartialJsonArray(
  raw: string
): { name: string; gradient: string; textColor: string }[] {
  const fullMatch = raw.match(/\[[\s\S]*\]/);
  if (fullMatch) {
    try {
      return JSON.parse(fullMatch[0]);
    } catch {
      // fall through
    }
  }

  const startIdx = raw.indexOf("[");
  if (startIdx === -1) return [];

  let jsonStr = raw.slice(startIdx);
  const lastBrace = jsonStr.lastIndexOf("}");
  if (lastBrace === -1) return [];

  jsonStr = jsonStr.slice(0, lastBrace + 1) + "]";

  try {
    return JSON.parse(jsonStr);
  } catch {
    const objRegex =
      /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"gradient"\s*:\s*"([^"]+)"\s*,\s*"textColor"\s*:\s*"([^"]+)"[^}]*\}/g;
    const results: { name: string; gradient: string; textColor: string }[] = [];
    let match;
    while ((match = objRegex.exec(raw)) !== null) {
      results.push({
        name: match[1],
        gradient: match[2],
        textColor: match[3],
      });
    }
    return results;
  }
}
