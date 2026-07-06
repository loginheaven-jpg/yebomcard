/**
 * AI TTS 공유 캐시 (Cloudflare R2) — 서버 전용.
 *
 * 각 (역본·성우·본문) 합성음을 R2 에 한 번만 저장해 전 사용자에게 서빙 → 절·성우당 평생 1회만 과금.
 * 콘텐츠 주소화: 키에 본문 sha1 을 포함해 본문이 바뀌면(교정 등) 자동으로 새 키가 되어 재합성.
 * 엔진 재매핑 시엔 CACHE_VERSION(호출측) 을 올려 일괄 무효화.
 *
 * R2_* 환경변수가 없으면 no-op(null/skip) → 로컬/미설정 환경에서도 route 는 정상 동작(매번 합성).
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";

let client: S3Client | null = null;
function getClient(): S3Client | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

export function r2CacheEnabled(): boolean {
  return getClient() !== null;
}

/** 공유 캐시 조회. hit → { buffer, voice(저장 시 X-TTS-Voice) }, miss/미설정 → null */
export async function getR2Audio(key: string): Promise<{ buffer: Buffer; voice: string } | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!r.Body) return null;
    const bytes = await (r.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return { buffer: Buffer.from(bytes), voice: r.Metadata?.["x-tts-voice"] || "" };
  } catch {
    return null; // NoSuchKey 등 → 캐시 미스
  }
}

/** 공유 캐시 저장(fire-and-forget). 실패는 무시 — 재생엔 영향 없음. */
export async function putR2Audio(key: string, buffer: Buffer, voiceTag: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: { "x-tts-voice": voiceTag.slice(0, 128) },
      }),
    );
  } catch (e) {
    console.error("[R2] put 실패", e instanceof Error ? e.message : e);
  }
}
