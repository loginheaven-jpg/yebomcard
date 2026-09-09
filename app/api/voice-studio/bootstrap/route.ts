/**
 * GET /api/voice-studio/bootstrap — 설치 스크립트(bootstrap.py) 원문.
 *
 * 배치파일이 가장 먼저 받아가는 파일. 이후의 판단(패키지 설치, GPU 확인,
 * 소스 내려받기, 실행)은 전부 여기서 한다 — 배치 스크립트보다 파이썬이
 * 오류를 훨씬 정확히 알려줄 수 있기 때문이다.
 *
 * 서버가 원문을 그대로 주므로, 설치 절차를 고치면 새 PC 는 자동으로 새 절차를 따른다.
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireDevice } from "@/lib/voiceStudio/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  let body: string;
  try {
    body = await fs.readFile(path.join(process.cwd(), "voice", "bootstrap.py"), "utf8");
  } catch {
    return NextResponse.json(
      { error: "서버에 bootstrap.py 가 없습니다(배포 설정 확인 필요)" },
      { status: 500 },
    );
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/x-python; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
