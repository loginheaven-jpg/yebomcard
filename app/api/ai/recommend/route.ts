import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/aiGateway";

/**
 * AI 주제 추천 API
 * POST /api/ai/recommend
 * body: { topic: "감사", version: "nkrv" }
 * → AI가 해당 주제에 맞는 성경 구절 목록 반환
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, version = "nkrv" } = body;

    if (!topic || typeof topic !== "string" || topic.trim().length < 1) {
      return NextResponse.json(
        { error: "주제를 입력해주세요" },
        { status: 400 }
      );
    }

    const versionName =
      version === "nkrv"
        ? "개역개정"
        : version === "rnksv"
          ? "새번역"
          : "개역개정";

    const result = await callAI(
      [
        {
          role: "user",
          content: `"${topic.trim()}" 주제에 맞는 성경 구절을 10개 추천해줘.

반드시 아래 JSON 배열 형식으로만 응답해. 다른 텍스트 없이 JSON만:
[
  {"book": "시편", "chapter": 23, "verse": 1, "preview": "여호와는 나의 목자시니..."},
  {"book": "요한복음", "chapter": 3, "verse": 16, "preview": "하나님이 세상을 이처럼..."}
]

규칙:
- ${versionName} 기준 정확한 책이름 사용 (창세기, 출애굽기, 시편 등)
- preview는 해당 절의 앞부분 15~25자
- 해당 주제와 실제로 관련 있는 구절만
- 잘 알려진 구절과 덜 알려진 구절을 섞어서`,
        },
      ],
      {
        provider: "gemini-flash",
        max_tokens: 1500,
        temperature: 0.7,
        caller: "yebom-card:recommend",
      }
    );

    // AI 응답에서 JSON 배열 파싱
    const content = result.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 응답 파싱 실패", raw: content },
        { status: 500 }
      );
    }

    const recommendations = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      recommendations,
      provider: result.provider,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `AI 추천 실패: ${message}` },
      { status: 500 }
    );
  }
}
