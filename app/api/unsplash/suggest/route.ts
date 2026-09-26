import { NextRequest, NextResponse } from "next/server";
import { extractKeywords, getUnsplashQuery } from "@/lib/keywords";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "unsplash-suggest", 30, 10 * 60_000);
  if (limited) return limited;
  try {
    const { verseText } = await request.json();
    if (!verseText || typeof verseText !== "string") {
      return NextResponse.json({ error: "verseText required" }, { status: 400 });
    }

    // 본문 풍경어와 기존 키워드 매핑만 사용한다.
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
