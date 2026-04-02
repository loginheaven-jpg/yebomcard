import { NextRequest, NextResponse } from "next/server";
import { callImage, callAI } from "@/lib/aiGateway";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { verseText, keywords = [], mode = "background" } = body;

    if (!verseText || typeof verseText !== "string") {
      return NextResponse.json(
        { error: "구절 텍스트가 필요합니다" },
        { status: 400 }
      );
    }

    const kw = keywords.length > 0 ? keywords.join(", ") : "peaceful";

    // ─── 이미지 생성 ───
    try {
      let prompt: string;

      if (mode === "illustration") {
        // 삽화 모드: AI Chat으로 본문 분석 → 삽화 프롬프트 생성
        const promptResult = await callAI(
          [
            {
              role: "user",
              content: `성경 말씀: "${verseText}"
이 말씀의 핵심 장면을 시각적 삽화로 표현하는 영문 이미지 프롬프트 1줄만 작성해.
규칙: 성경 내용과 직접 관련된 장면/상징, 유화풍 또는 수채화풍, 따뜻한 톤, 글자 없이, 세로 비율.
프롬프트만:`,
            },
          ],
          {
            provider: "gemini-flash",
            max_tokens: 150,
            temperature: 0.8,
            caller: "yebom-card:illustration-prompt",
          }
        );
        prompt = promptResult.content.trim() + ", oil painting style, warm tones, no text no letters no words, portrait orientation, suitable for white text overlay";
      } else {
        // 배경 모드: 풍경 사진
        prompt = `A beautiful ${kw} landscape photograph, serene spiritual atmosphere, soft natural lighting, suitable as background for white text overlay, portrait orientation, no text no letters no words`;
      }

      const imageResult = await callImage(prompt, {
        size: "1080x1350",
        style: mode === "illustration" ? "vivid" : "natural",
        caller: `yebom-card:${mode}`,
      });

      return NextResponse.json({
        type: "image",
        mode,
        data: imageResult.data,
        media_type: imageResult.media_type,
        provider: imageResult.provider,
        model: imageResult.model,
      });
    } catch (imageError) {
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
