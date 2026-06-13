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
    const { topic } = body;

    if (!topic || typeof topic !== "string" || topic.trim().length < 1) {
      return NextResponse.json(
        { error: "주제를 입력해주세요" },
        { status: 400 }
      );
    }

    // 버전 무관: AI 는 구절 참조(책/장/절)만 추천하고, 실제 본문은 클라이언트가 현재 역본에서 조회한다.
    // 프롬프트에 역본명("새번역" 등)을 넣으면 그 역본 표현으로 출력이 길어져 — 특히 긴 주제 + 새번역에서 —
    // preview 모델 잘림 경계를 넘겨 0개 파싱→500 이 났음. 역본명을 빼면 출력이 짧고 버전 무관해져 안정.
    const prompt = `"${topic.trim()}" 주제 성경 구절 5개 추천. JSON 배열만 출력하라. 설명 금지.
[{"book":"시편","chapter":23,"verse":1,"preview":"여호와는 나의 목자시니"}]
한국어 책이름. preview 10자.`;

    // preview 모델(gemini-3-flash-preview)이 간헐적으로 응답을 잘라 0개 파싱→500 이 나던 문제
    // (특히 rnksv 출력이 잘림 경계에 걸침). 최대 3회 재시도하며 가장 많이 복구된 결과를 채택
    // (≥4개면 조기 종료). 모든 버전 공통으로 견고화.
    let best: ReturnType<typeof parsePartialJsonArray> = [];
    let provider = "";
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callAI([{ role: "user", content: prompt }], {
          provider: "gemini-flash",
          max_tokens: 4096,
          temperature: 0.7,
          caller: "yebom-card:recommend",
        });
        const recs = parsePartialJsonArray(result.content.trim());
        if (recs.length > best.length) {
          best = recs;
          provider = result.provider;
        }
        if (best.length >= 4) break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "unknown";
      }
    }

    if (best.length === 0) {
      return NextResponse.json(
        { error: `AI 추천 결과를 파싱할 수 없습니다${lastErr ? ` (${lastErr})` : ""}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ recommendations: best, provider });
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
