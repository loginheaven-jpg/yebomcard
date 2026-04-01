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
          content: `"${topic.trim()}" 주제 성경 구절 7개. JSON만 응답:
[{"book":"시편","chapter":23,"verse":1,"preview":"여호와는 나의 목자시니"}]
규칙: ${versionName} 책이름, preview 15자 이내, 주제 관련 구절만`,
        },
      ],
      {
        provider: "gemini-flash",
        max_tokens: 2500,
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
