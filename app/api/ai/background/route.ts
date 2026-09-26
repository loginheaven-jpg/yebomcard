import { NextRequest, NextResponse } from "next/server";
import { callImage } from "@/lib/aiGateway";
import { gradientBackgrounds } from "@/lib/gradientBackgrounds";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  // 이미지 생성이 가장 비싸다 — 한 주소에서 10분에 10장
  const limited = rateLimit(request, "ai-background", 10, 10 * 60_000);
  if (limited) return limited;
  try {
    const body = await request.json();
    const { verseText, keywords = [], mode = "background" } = body;

    if (!verseText || typeof verseText !== "string") {
      return NextResponse.json(
        { error: "구절 텍스트가 필요합니다" },
        { status: 400 }
      );
    }

    if (mode === "gradient") {
      return NextResponse.json({ type: "gradient", backgrounds: gradientBackgrounds(verseText), provider: "local" });
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

    return NextResponse.json({
      type: "gradient",
      backgrounds: gradientBackgrounds(verseText),
      provider: "local",
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
