import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/aiGateway";

/**
 * AI 주제 추천 API
 * POST /api/ai/recommend
 * body: { topic: "감사", version: "nkrv" }
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

    const versionName = version === "rnksv" ? "새번역" : "개역개정";

    const result = await callAI(
      [
        {
          role: "user",
          content: `"${topic.trim()}" 주제 성경 구절 5개 추천. JSON 배열만 출력하라. 설명 금지.
[{"book":"시편","chapter":23,"verse":1,"preview":"여호와는 나의 목자시니"}]
${versionName} 책이름. preview 10자.`,
        },
      ],
      {
        provider: "gemini-flash",
        max_tokens: 4096,
        temperature: 0.7,
        caller: "yebom-card:recommend",
      }
    );

    const content = result.content.trim();

    // JSON 배열 파싱 — 잘린 응답 복구 포함
    const recommendations = parsePartialJsonArray(content);

    if (recommendations.length === 0) {
      return NextResponse.json(
        { error: "AI 추천 결과를 파싱할 수 없습니다" },
        { status: 500 }
      );
    }

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

/**
 * 잘린 JSON 배열도 복구하여 파싱
 * 완전한 객체만 추출 (마지막 불완전 객체는 버림)
 */
function parsePartialJsonArray(
  raw: string
): { book: string; chapter: number; verse: number; preview: string }[] {
  // 1. 정상 파싱 시도
  const fullMatch = raw.match(/\[[\s\S]*\]/);
  if (fullMatch) {
    try {
      return JSON.parse(fullMatch[0]);
    } catch {
      // 잘린 JSON — 아래 복구 로직으로
    }
  }

  // 2. `[`부터 시작되는 부분을 추출
  const startIdx = raw.indexOf("[");
  if (startIdx === -1) return [];

  let jsonStr = raw.slice(startIdx);

  // 3. 마지막 완전한 `}` 위치를 찾아서 거기까지만 사용
  const lastBrace = jsonStr.lastIndexOf("}");
  if (lastBrace === -1) return [];

  jsonStr = jsonStr.slice(0, lastBrace + 1) + "]";

  try {
    return JSON.parse(jsonStr);
  } catch {
    // 4. 개별 객체 추출 (최후의 수단)
    const objRegex =
      /\{\s*"book"\s*:\s*"([^"]+)"\s*,\s*"chapter"\s*:\s*(\d+)\s*,\s*"verse"\s*:\s*(\d+)\s*,\s*"preview"\s*:\s*"([^"]*)"?\s*\}/g;
    const results: {
      book: string;
      chapter: number;
      verse: number;
      preview: string;
    }[] = [];
    let match;
    while ((match = objRegex.exec(raw)) !== null) {
      results.push({
        book: match[1],
        chapter: parseInt(match[2]),
        verse: parseInt(match[3]),
        preview: match[4],
      });
    }
    return results;
  }
}
