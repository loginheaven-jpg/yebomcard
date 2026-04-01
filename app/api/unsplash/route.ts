import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") || "nature";
  const perPage = searchParams.get("per_page") || "3";

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return NextResponse.json(
      { error: "Unsplash API key not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Unsplash API error: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const results =
      data.results?.map((img: Record<string, unknown>) => {
        const urls = img.urls as Record<string, string>;
        const links = img.links as Record<string, string>;
        const user = img.user as Record<string, unknown>;
        const userLinks = user.links as Record<string, string>;

        return {
          id: img.id,
          url: urls.regular,
          fullUrl: urls.full,
          color: img.color,
          blur_hash: img.blur_hash,
          download_location: links.download_location,
          credit: {
            name: user.name,
            profileUrl: `${userLinks.html}?utm_source=yebom_card&utm_medium=referral`,
          },
        };
      }) || [];

    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch from Unsplash" },
      { status: 500 }
    );
  }
}
