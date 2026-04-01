import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/aiGateway";

/**
 * AI CSS 아트 배경 생성 API
 * POST /api/ai/background
 * body: { verseText: "...", keywords: ["평안","소망"] }
 * → AI가 말씀에 어울리는 CSS 그라데이션 생성
 */
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

    const keywordHint =
      keywords.length > 0
        ? `\n이 말씀의 키워드: ${keywords.join(", ")}`
        : "";

    const result = await callAI(
      [
        {
          role: "user",
          content: `성경 말씀에 어울리는 CSS 배경을 3종 생성해줘.

말씀: "${verseText}"${keywordHint}

반드시 아래 JSON 배열 형식으로만 응답해. 다른 텍스트 없이 JSON만:
[
  {
    "name": "배경 이름 (한글 2~4자)",
    "gradient": "linear-gradient(...) 또는 radial-gradient(...)",
    "textColor": "white" 또는 "dark",
    "description": "한줄 설명"
  }
]

규칙:
- gradient는 유효한 CSS gradient 문법
- 말씀의 감정/분위기를 색으로 표현
- 3종은 각각 분위기가 다르게 (밝은/깊은/따뜻한)
- textColor는 배경 위 텍스트 가독성 기준`,
        },
      ],
      {
        provider: "gemini-flash",
        max_tokens: 800,
        temperature: 0.8,
        caller: "yebom-card:background",
      }
    );

    const content = result.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 응답 파싱 실패", raw: content },
        { status: 500 }
      );
    }

    const backgrounds = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      backgrounds,
      provider: result.provider,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `AI 배경 생성 실패: ${message}` },
      { status: 500 }
    );
  }
}
