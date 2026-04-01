import { NextRequest, NextResponse } from "next/server";
import { callImage, callAI } from "@/lib/aiGateway";

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

    const kw = keywords.length > 0 ? keywords.join(", ") : "peaceful";

    // ─── 이미지 생성 (DALL-E / Imagen) ───
    try {
      const prompt = `A beautiful ${kw} landscape photograph, serene spiritual atmosphere, soft natural lighting, suitable as background for white text overlay, portrait orientation, no text no letters no words`;

      const imageResult = await callImage(prompt, {
        size: "1080x1350",
        style: "natural",
        caller: "yebom-card:background",
      });

      return NextResponse.json({
        type: "image",
        data: imageResult.data,
        media_type: imageResult.media_type,
        provider: imageResult.provider,
        model: imageResult.model,
      });
    } catch (imageError) {
      // 이미지 생성 실패 → CSS gradient fallback
      console.error("Image generation failed, falling back to gradient:", imageError);
    }

    // ─── Gradient fallback ───
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
        { error: "배경 생성 실패" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      type: "gradient",
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
