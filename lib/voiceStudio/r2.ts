/**
 * 음원 생성 스튜디오가 쓰는 R2 접근 — 서버 전용.
 *
 * lib/tts/r2Cache.ts 는 "본문 sha1 → mp3" 한 가지 용도에 맞춰져 있어서
 * 목록 조회나 임의 컨텐츠 타입을 다루지 못한다. 여기서는 보이스 참조음,
 * 폐기 목록처럼 형태가 다른 객체를 다룬다. 버킷은 같은 것을 쓴다.
 *
 * R2 미설정이면 전부 no-op(null/false) — 로컬 개발에서 라우트가 죽지 않게.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "";

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !BUCKET) return null;
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return client;
}

export function studioR2Enabled(): boolean {
  return getClient() !== null;
}

export async function studioGetBytes(key: string): Promise<Buffer | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!r.Body) return null;
    const bytes = await (r.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  } catch {
    return null; // NoSuchKey 등
  }
}

export async function studioGetJson<T>(key: string): Promise<T | null> {
  const buf = await studioGetBytes(key);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function studioPutBytes(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl = "no-store",
): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
    return true;
  } catch (e) {
    console.error("[voice-studio] R2 put 실패", key, e instanceof Error ? e.message : e);
    return false;
  }
}

export async function studioPutJson(key: string, value: unknown): Promise<boolean> {
  return studioPutBytes(key, Buffer.from(JSON.stringify(value), "utf8"), "application/json");
}

export async function studioDelete(key: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** prefix 아래 키 목록 (최대 1000개 — 보이스 수는 이보다 훨씬 적다) */
export async function studioList(
  prefix: string,
): Promise<{ key: string; size: number; lastModified?: Date }[]> {
  const c = getClient();
  if (!c) return [];
  const out: { key: string; size: number; lastModified?: Date }[] = [];
  let token: string | undefined;
  do {
    const r = await c.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of r.Contents || []) {
      if (o.Key) out.push({ key: o.Key, size: o.Size || 0, lastModified: o.LastModified });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
