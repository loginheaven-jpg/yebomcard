/**
 * GET /api/voice-studio/code — 스튜디오 소스 일체를 JSON 으로 내려준다.
 *
 * zip 을 쓰지 않는 이유: 압축 라이브러리를 새로 들이지 않으려는 것이고,
 * 받는 쪽이 이미 파이썬이라 파일로 쓰는 데 아무 도구가 필요 없다.
 *
 * 이 경로 덕분에 로컬 PC 에 git 도 GitHub 계정도 필요 없다. 또한 스튜디오를
 * 실행할 때마다 이 목록과 대조하므로 **코드가 서버와 자동으로 같아진다** —
 * 캐시 키 규칙이 서버와 어긋나 조용히 캐시 미스가 나는 사고를 막는다.
 */

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireDevice } from "@/lib/voiceStudio/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 로컬 PC 에서 돌아야 하는 파일만. 산출물·참조음·작업 상태는 각 PC 것이므로 제외.
// bootstrap.py 도 넣는다 — 설치 때 한 번 받은 뒤로 갱신되지 않아서, 실행 파일 규칙 같은
// 설치 절차의 수정이 이미 설치된 PC 에는 닿지 않았다.
const FILES = [
  "bootstrap.py",
  "engine.py",
  "jobs.py",
  "prosody.py",
  "plan.py",
  "app.py",
  "server.py",
  "run_book.py",
  "run_plan.py",
  "recheck_held.py",
  "qc_sweep.py",
  "push_voice.py",
  "smoke_job.py",
  "bench.py",
  "README.md",
];

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  const dir = path.join(process.cwd(), "voice");
  const files: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of FILES) {
    try {
      files[name] = await fs.readFile(path.join(dir, name), "utf8");
    } catch {
      missing.push(name); // 아직 없는 파일은 조용히 건너뛴다(버전 차이 허용)
    }
  }

  if (Object.keys(files).length === 0) {
    return NextResponse.json(
      { error: "서버에 스튜디오 소스가 없습니다(배포 설정 확인 필요)" },
      { status: 500 },
    );
  }

  // 로컬이 "바뀐 게 없으면 다시 안 씀" 판단을 할 수 있도록 파일별 해시를 같이 준다
  const hashes: Record<string, string> = {};
  for (const [name, body] of Object.entries(files)) {
    hashes[name] = crypto.createHash("sha1").update(body, "utf8").digest("hex").slice(0, 12);
  }

  return NextResponse.json(
    { files, hashes, missing },
    { headers: { "Cache-Control": "no-store" } },
  );
}
