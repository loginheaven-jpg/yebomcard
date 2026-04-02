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
        // 삽화 모드: 키워드 기반으로 직접 프롬프트 구성 (AI 프롬프트 생성 대신)
        // Unsplash 매핑과 같은 키워드를 활용하되, 삽화 스타일로
        const sceneMap: Record<string, string> = {
          평안: "a calm lake reflecting soft sky",
          소망: "a single sunrise over a hill",
          능력: "a single mountain peak with golden light",
          사랑: "a few simple flowers in warm sunlight",
          기쁨: "a single tree in a sunlit meadow",
          감사: "a golden wheat field under warm sky",
          생명: "a single green tree with morning light",
          치유: "calm ocean horizon with soft light",
          묵상: "a quiet misty forest path",
          영광: "golden light rays through simple clouds",
          구원: "light breaking through a single cloud",
          믿음: "a simple path leading to distant light",
          지혜: "a single olive tree in a quiet garden",
        };

        let scene = "a calm simple landscape with soft sky";
        for (const k of keywords) {
          if (sceneMap[k]) { scene = sceneMap[k]; break; }
        }
        prompt = `Simple minimal children storybook watercolor: ${scene}. Very simple composition, few elements, large empty space in center for text overlay. Soft pastel tones, gentle brushstrokes. NO people, NO faces, NO characters. ABSOLUTELY NO text, NO letters, NO numbers, NO writing, NO characters, NO watermarks, NO signatures anywhere in the image. Portrait orientation.`;
      } else {
        // 배경 모드: 풍경 사진
        prompt = `A beautiful ${kw} landscape photograph, serene spiritual atmosphere, soft natural lighting, suitable as background for white text overlay, portrait orientation. ABSOLUTELY NO text, NO letters, NO numbers, NO writing, NO watermarks, NO signatures anywhere in the image.`;
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
