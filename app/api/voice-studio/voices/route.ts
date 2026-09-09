/**
 * 보이스(참조음) 배포 — 새 PC 가 참조 클립을 직접 자르지 않게 한다.
 *
 *   GET  : 등록된 보이스 목록 (기기 토큰)
 *   POST : 보이스 등록/갱신 (관리자 세션 — 기존 PC 에서 push_voice.py 로 올린다)
 *
 * 왜 서버에 두는가: 참조 클립이 1초라도 다르면 음색이 미묘하게 달라져
 * **책마다 목소리가 바뀐다**. 듣기 전에는 알아채기 어렵고 알아챘을 땐 수천 절을
 * 만든 뒤다. 그래서 각 PC 가 같은 파일을 받도록 하고, 지문(fingerprint)을 함께 준다.
 *
 * 주의: 참조음은 목소리 복제 데이터다. 받아 간 쪽은 그 목소리로 무엇이든 말하게
 * 만들 수 있으므로 목록·내용 모두 인증 뒤에서만 나간다.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdmin, requireDevice } from "@/lib/voiceStudio/auth";
import { studioList, studioGetJson, studioPutBytes, studioPutJson } from "@/lib/voiceStudio/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "voice-studio/voices/";
const MAX_REF_BYTES = 20 * 1024 * 1024; // 참조음은 10~30초 — 20MB 면 충분히 넉넉하다

export interface VoiceMeta {
  name: string;
  ref_text: string;
  /** ref.wav + ref_text 로 만든 지문 — PC 간 동일성 확인용 */
  fingerprint: string;
  gender?: string;
  /** 예봄성경 성우 슬롯 (예: f4=영희). 지정하면 생성 후 자동 업로드가 이 슬롯으로 간다 */
  voiceKey?: string;
  updatedAt: string;
  updatedBy: string;
  refBytes: number;
}

/** 이름이 경로를 벗어나지 못하게 — R2 키에 그대로 들어간다 */
function safeName(name: string): string | null {
  const n = (name || "").trim();
  if (!n || n.length > 40) return null;
  if (n.includes("/") || n.includes("\\") || n.includes("..")) return null;
  return n;
}

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  const keys = await studioList(PREFIX);
  const names = [
    ...new Set(
      keys
        .map((k) => k.key.slice(PREFIX.length).split("/")[0])
        .filter(Boolean),
    ),
  ];

  const voices: VoiceMeta[] = [];
  for (const name of names) {
    const meta = await studioGetJson<VoiceMeta>(`${PREFIX}${name}/meta.json`);
    if (meta) voices.push(meta);
  }
  voices.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return NextResponse.json({ voices }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  let body: {
    name?: string;
    refText?: string;
    refWavBase64?: string;
    gender?: string;
    voiceKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const name = safeName(body.name || "");
  if (!name) return NextResponse.json({ error: "보이스 이름이 올바르지 않습니다" }, { status: 400 });
  if (!body.refText?.trim()) {
    return NextResponse.json({ error: "참조 텍스트(ref_text)가 필요합니다" }, { status: 400 });
  }
  if (!body.refWavBase64) {
    return NextResponse.json({ error: "참조음(ref.wav)이 필요합니다" }, { status: 400 });
  }

  let wav: Buffer;
  try {
    wav = Buffer.from(body.refWavBase64, "base64");
  } catch {
    return NextResponse.json({ error: "참조음 디코딩 실패" }, { status: 400 });
  }
  if (wav.length === 0 || wav.length > MAX_REF_BYTES) {
    return NextResponse.json(
      { error: `참조음 크기가 올바르지 않습니다 (${wav.length} bytes)` },
      { status: 400 },
    );
  }

  const refText = body.refText.trim();
  // voice/engine.py 의 voice_fingerprint 와 **같은 규칙**이어야 한다.
  // 어긋나면 PC 마다 지문이 달라 보여, 정작 음색이 흔들릴 때 알아채지 못한다.
  //   sha256(ref.wav 바이트 + ref_text UTF-8) 의 앞 16자
  const fingerprint = crypto
    .createHash("sha256")
    .update(wav)
    .update(refText, "utf8")
    .digest("hex")
    .slice(0, 16);

  const meta: VoiceMeta = {
    name,
    ref_text: refText,
    fingerprint,
    gender: body.gender,
    voiceKey: body.voiceKey,
    updatedAt: new Date().toISOString(),
    updatedBy: gate.session.email || "관리자",
    refBytes: wav.length,
  };

  const okWav = await studioPutBytes(`${PREFIX}${name}/ref.wav`, wav, "audio/wav");
  const okMeta = await studioPutJson(`${PREFIX}${name}/meta.json`, meta);
  if (!okWav || !okMeta) {
    return NextResponse.json({ error: "R2 저장 실패 (R2_* 환경변수 확인)" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, voice: meta });
}
