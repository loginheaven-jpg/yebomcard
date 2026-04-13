import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/aiGateway";
import { extractKeywords, getUnsplashQuery } from "@/lib/keywords";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "Given a Bible verse, return 3-5 English Unsplash photo search keywords. " +
  "Focus on landscape, nature, mood. JSON array only, no markdown.";

export async function POST(request: NextRequest) {
  try {
    const { verseText } = await request.json();
    if (!verseText || typeof verseText !== "string") {
      return NextResponse.json({ error: "verseText required" }, { status: 400 });
    }

    // AI 검색어 생성 시도
    try {
      const result = await callAI(
        [{ role: "user", content: verseText }],
        {
          provider: "claude-haiku",
          system_prompt: SYSTEM_PROMPT,
          max_tokens: 100,
          temperature: 0.7,
          caller: "yebom-card:unsplash-suggest",
        }
      );

      // markdown code fence 제거 후 JSON 파싱
      const cleaned = result.content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const keywords: string[] = JSON.parse(cleaned);

      if (Array.isArray(keywords) && keywords.length > 0) {
        return NextResponse.json({ query: keywords.join(" ") });
      }
    } catch {
      // AI 실패 → fallback
    }

    // Fallback: 정적 매핑
    const kw = extractKeywords(verseText);
    const query = getUnsplashQuery(kw, verseText);
    return NextResponse.json({ query });
  } catch {
    return NextResponse.json(
      { query: "nature peaceful landscape bright" },
      { status: 200 }
    );
  }
}
