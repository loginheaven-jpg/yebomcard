/**
 * '이 구절을 다룬 우리 교회 설교' 카드 (docs/BIBLE_QA_SERMONS.md)
 *
 * **이것이 별도 라우트인 까닭**이 설계의 핵심이다. 답변(`/api/bible-qa`)에 끼워 넣으면
 *  ① DB 왕복이 답변 시간에 직렬로 더해지고
 *  ② 색인 조회가 실패하면 교인이 카드를 못 보는 게 아니라 **답을 못 본다**(라우트 전체가 500)
 *  ③ 답은 스트리밍이 아니라 가장 느린 모델 뒤에 한 덩이로 오므로, 카드도 그때까지 화면에 없다.
 * 라우트를 나누면 지휘부 조건("설교 연동이 질문 응답속도에 영향을 주면 보류")을 지킬 수 있다.
 *
 * 점수(§3): main > quoted → 포함 > 걸침 → 최근순. **최대 두 편.** 맞는 것이 없으면 빈 목록이다
 * ('관련 설교 없음' 을 쓰지 않는다 — 화면이 아무것도 그리지 않는다).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getBookByCode } from "@/lib/books";

export const dynamic = "force-dynamic";

/** 최대 두 편(§3). */
const MAX_CARDS = 2;

interface RefRow {
  sermon_id: number;
  kind: string;
  chapter: number;
  verse_start: number | null;
  verse_end: number | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookCode = searchParams.get("book") ?? "";
  const chapter = Number(searchParams.get("chapter"));
  const verseStart = Number(searchParams.get("verse_start"));
  const verseEndRaw = Number(searchParams.get("verse_end"));
  const verseEnd = Number.isFinite(verseEndRaw) && verseEndRaw >= verseStart ? verseEndRaw : verseStart;

  if (!getBookByCode(bookCode) || !Number.isFinite(chapter) || !Number.isFinite(verseStart)) {
    return NextResponse.json({ error: "book, chapter, verse_start가 필요합니다" }, { status: 400 });
  }

  // 장 단위로 좁혀 온다 — 인덱스가 (book_code, chapter) 다.
  const { data: refs, error } = await supabaseAdmin
    .from("sermon_refs")
    .select("sermon_id, kind, chapter, verse_start, verse_end")
    .eq("book_code", bookCode)
    .eq("chapter", chapter);

  // 표가 아직 없으면 **조용히 빈 목록**이다. 카드가 없는 것과 같은 자리로 떨어지므로
  // 화면이 깨지지 않는다(질문 답변은 이 라우트와 무관하게 그대로 온다).
  if (error) return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  if (!refs || refs.length === 0) {
    return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "public, max-age=3600" } });
  }

  // 절 범위가 겹치는 것만 남기고 점수를 매긴다.
  const scored = new Map<number, number>();
  for (const r of refs as RefRow[]) {
    const rs = r.verse_start ?? 1;
    const re = r.verse_end ?? (r.verse_start ?? 100000);
    const chapterWide = r.verse_start == null; // '장 전체'
    const overlaps = chapterWide || (rs <= verseEnd && re >= verseStart);
    if (!overlaps) continue;

    const contained = chapterWide || (rs <= verseStart && re >= verseEnd);
    let score = r.kind === "main" ? 100 : 40;
    if (contained) score += 20;
    if (chapterWide) score -= 10; // 장 전체는 걸침보다도 느슨하다
    const prev = scored.get(r.sermon_id) ?? 0;
    if (score > prev) scored.set(r.sermon_id, score);
  }
  if (scored.size === 0) {
    return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "public, max-age=3600" } });
  }

  const ids = [...scored.keys()];
  const { data: sermons } = await supabaseAdmin
    .from("sermons")
    .select("id, preached_on, title, preacher, video_url, summary")
    .in("id", ids);

  const items = (sermons ?? [])
    .map((s) => ({
      id: s.id as number,
      preached_on: s.preached_on as string,
      title: s.title as string,
      preacher: (s.preacher as string | null) ?? null,
      video_url: (s.video_url as string | null) ?? null,
      // 카드에는 **요약 첫 문단만** 보인다(§3). 전문을 다 보내면 카드가 답보다 길어진다.
      summary: firstParagraph(s.summary as string | null),
      score: scored.get(s.id as number) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || b.preached_on.localeCompare(a.preached_on))
    .slice(0, MAX_CARDS);

  return NextResponse.json(
    { items },
    // 색인은 하루 한 번만 바뀐다. 절 단위 조회라 캐시가 잘 맞는다.
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

function firstParagraph(summary: string | null): string | null {
  if (!summary) return null;
  const para = summary.split(/\n\s*\n/)[0]?.trim() || summary.trim();
  // 첫 문단이 길면 잘라 준다 — 카드가 답을 밀어내면 안 된다.
  return para.length > 400 ? para.slice(0, 400).trimEnd() + "…" : para;
}
