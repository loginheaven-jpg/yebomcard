/**
 * POST /api/voice-studio/upload — 로컬에서 만든 절 음원을 공유 캐시에 넣는다 (기기 토큰).
 *
 * 왜 서버를 거치는가
 *   전에는 각 PC 의 .env.local 에 R2 비밀키를 복사해야 했다. PC 가 늘수록 키가
 *   퍼지고, 한 대만 분실돼도 음원 저장소 전체가 노출된다. 서버가 대신 쓰면
 *   **로컬 PC 에는 R2 키가 아예 없다** — 회수할 땐 토큰 하나만 폐기하면 된다.
 *
 * 덤으로 키 규칙을 서버가 직접 계산하므로, 로컬 코드가 어긋나 엉뚱한 키로
 * 올라가 조용히 캐시 미스가 나는 사고도 막힌다. 로컬은 **본문**을 보내고,
 * 키는 서버가 만든다.
 *
 * 교체(replace: true)
 *   평소에는 같은 키가 이미 있으면 건너뛴다(exists). 구방식 교체 작업은 replace 를 실어 보내는데,
 *   그때도 **기존 파일이 LEGACY_BEFORE 이전에 올라온 것일 때만** 덮어쓴다(replaced).
 *   두 PC 가 같은 절을 교체하더라도 새 방식 파일을 구방식으로 되돌리는 일이 생기지 않는다.
 *   있는지 확인은 HEAD 로 한다 — 예전에는 확인하려고 음원을 통째로 내려받았다.
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { putR2Audio, headR2Audio, r2CacheEnabled } from "@/lib/tts/r2Cache";
import { cleanForTts, ttsCacheKey, PREGENERATED_VOICE_KEYS, LEGACY_BEFORE } from "@/lib/tts/verseText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 절 하나짜리 mp3 는 96kbps 기준 대개 100KB 안쪽. 넉넉히 잡되 상한은 둔다.
const MAX_MP3_BYTES = 5 * 1024 * 1024;
const MAX_BATCH = 20;

interface Item {
  text?: string;
  mp3Base64?: string;
  ref?: string;
}

function isMp3(buf: Buffer): boolean {
  if (buf.length < 3) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // "ID3"
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0; // MPEG 프레임 동기
}

export async function POST(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  if (!r2CacheEnabled()) {
    return NextResponse.json(
      { error: "서버에 R2 가 설정되어 있지 않습니다 (R2_* 환경변수 확인)" },
      { status: 503 },
    );
  }

  let body: { voiceKey?: string; items?: Item[]; replace?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const voiceKey = (body.voiceKey || "").trim();
  if (!(PREGENERATED_VOICE_KEYS as readonly string[]).includes(voiceKey)) {
    return NextResponse.json(
      {
        error: `사전 생성 음원을 올릴 수 없는 성우 슬롯입니다: '${voiceKey}'. ` +
          `허용: ${PREGENERATED_VOICE_KEYS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const replace = body.replace === true;
  const legacyBefore = Date.parse(LEGACY_BEFORE[voiceKey] || "");

  const items = body.items || [];
  if (!items.length) return NextResponse.json({ error: "items 가 비어 있습니다" }, { status: 400 });
  if (items.length > MAX_BATCH) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_BATCH}건까지` }, { status: 400 });
  }

  const results: {
    ref: string;
    status: "uploaded" | "replaced" | "exists" | "error";
    key?: string;
    error?: string;
  }[] = [];

  for (const it of items) {
    const ref = it.ref || "?";
    try {
      if (!it.text?.trim() || !it.mp3Base64) {
        results.push({ ref, status: "error", error: "본문 또는 음원 누락" });
        continue;
      }
      const mp3 = Buffer.from(it.mp3Base64, "base64");
      if (mp3.length === 0 || mp3.length > MAX_MP3_BYTES) {
        results.push({ ref, status: "error", error: `크기 이상 (${mp3.length} bytes)` });
        continue;
      }
      if (!isMp3(mp3)) {
        results.push({ ref, status: "error", error: "mp3 가 아닙니다" });
        continue;
      }

      // 키는 서버가 만든다 — 로컬이 계산한 키는 받지 않는다
      const key = ttsCacheKey(cleanForTts(it.text), voiceKey, "ko");

      const existing = await headR2Audio(key);
      if (existing) {
        const isLegacy =
          replace && Number.isFinite(legacyBefore) && existing.lastModified.getTime() < legacyBefore;
        if (!isLegacy) {
          results.push({ ref, status: "exists", key });
          continue;
        }
      }
      await putR2Audio(key, mp3, `voice:${voiceKey}`);
      results.push({ ref, status: existing ? "replaced" : "uploaded", key });
    } catch (e) {
      results.push({ ref, status: "error", error: e instanceof Error ? e.message : "실패" });
    }
  }

  const uploaded = results.filter((r) => r.status === "uploaded").length;
  const replaced = results.filter((r) => r.status === "replaced").length;
  const exists = results.filter((r) => r.status === "exists").length;
  const failed = results.filter((r) => r.status === "error").length;

  return NextResponse.json({ uploaded, replaced, exists, failed, results });
}
