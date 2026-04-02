import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import { getBookByCode } from "@/lib/books";
import ShareContent from "@/components/ShareContent";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface SharePageProps {
  searchParams: Promise<{ v?: string; r?: string }>;
}

export async function generateMetadata({
  searchParams,
}: SharePageProps): Promise<Metadata> {
  const params = await searchParams;
  const version = params.v || "nkrv";
  const refs = params.r || "";

  if (!refs) {
    return { title: "말씀나눔 | 예봄성경" };
  }

  // 첫 번째 구절 정보 파싱
  const parts = refs.split(",").map((r) => {
    const [bookCode, ch, vs] = r.split(".");
    return { bookCode, chapter: parseInt(ch), verse: parseInt(vs) };
  });

  const first = parts[0];
  const book = getBookByCode(first.bookCode);
  const bookName = book?.nameKr || first.bookCode;

  const verseRange =
    parts.length === 1
      ? `${parts[0].verse}`
      : `${parts[0].verse}-${parts[parts.length - 1].verse}`;
  const refStr = `${bookName} ${first.chapter}:${verseRange}`;

  // 본문 미리보기 (첫 절)
  let preview = "";
  try {
    const { data } = await supabase
      .from("bible_verses")
      .select("text")
      .eq("version", version)
      .eq("book_code", first.bookCode)
      .eq("chapter", first.chapter)
      .eq("verse", first.verse)
      .single();
    if (data?.text) {
      preview = data.text.length > 10 ? data.text.slice(0, 10) + "..." : data.text;
    }
  } catch {
    // silent
  }

  const title = `말씀나눔 - ${refStr}`;
  const description = preview || `${refStr} | 예봄성경`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "예봄성경",
      type: "article",
      images: [
        {
          url: "/icons/og-image.png",
          width: 1200,
          height: 630,
          alt: "예봄성경",
        },
      ],
    },
  };
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">
          불러오는 중...
        </div>
      }
    >
      <ShareContent />
    </Suspense>
  );
}
