import { NextRequest, NextResponse } from "next/server";
import { callImageEdit } from "@/lib/aiGateway";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // 올린 사진의 글자 지우기도 유료 이미지 편집이다 — 한 주소에서 10분에 20장
  const limited = rateLimit(request, "upload-clean", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const { image, media_type } = await request.json();

    if (!image || !media_type) {
      return NextResponse.json(
        { error: "image와 media_type이 필요합니다" },
        { status: 400 }
      );
    }

    // DALL-E는 OpenAI가 response_format 파라미터를 더 이상 지원 안 함 → 게이트웨이 400 에러
    // imagen으로 강제 (env IMAGE_EDIT_PROVIDER로 override 가능)
    const provider = process.env.IMAGE_EDIT_PROVIDER || "imagen";
    const result = await callImageEdit(
      image,
      media_type,
      "remove_text",
      "yebom-card:upload-clean",
      provider,
    );

    return NextResponse.json({
      data: result.data,
      media_type: result.media_type,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `글자 제거 실패: ${message}` },
      { status: 500 }
    );
  }
}
