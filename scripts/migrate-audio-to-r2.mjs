/**
 * easy/nkrv 음원 Supabase Storage → Cloudflare R2(attached) 이전.
 *
 * - 대상: bible_audio 의 version in (easy, nkrv) 전 row (각 1189, 합 2378)
 * - R2 key = Supabase audio_url 의 '/bible-audio/' 뒤 경로 그대로 (예: easy/1ch/001.mp3)
 *   → 새 공개 URL = R2_PUBLIC_BASE + '/' + key (베이스만 교체되므로 DB 갱신은 문자열 치환)
 * - skip-if-exists(HeadObject) 라 중단 시 재실행으로 이어받기
 *
 * 실행: node scripts/migrate-audio-to-r2.mjs
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("[ERROR] R2_* env 누락");
  process.exit(1);
}

const MARKER = "/bible-audio/";
const CONCURRENCY = 12;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const supa = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

async function migrateOne(url) {
  const idx = url.indexOf(MARKER);
  if (idx === -1) return { bad: true };
  const key = url.slice(idx + MARKER.length); // easy/1ch/001.mp3
  if (await objectExists(key)) return { skipped: true, key };
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buf,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return { uploaded: true, key, bytes: buf.length };
}

async function main() {
  // 전체 row 페이지네이션 수집 (PostgREST 기본 1000 제한)
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supa
      .from("bible_audio")
      .select("audio_url")
      .in("version", ["easy", "nkrv"])
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < page) break;
  }
  console.log(`[INFO] 대상 ${rows.length} rows, 동시성 ${CONCURRENCY}`);

  const queue = rows.map((r) => r.audio_url);
  let done = 0, uploaded = 0, skipped = 0, bad = 0, bytes = 0;
  const errors = [];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      try {
        const r = await migrateOne(url);
        if (r.uploaded) { uploaded++; bytes += r.bytes; }
        else if (r.skipped) skipped++;
        else if (r.bad) bad++;
        done++;
        if (done % 100 === 0)
          console.log(`[PROGRESS] ${done}/${rows.length} up=${uploaded} skip=${skipped} ${(bytes / 1e9).toFixed(2)}GB err=${errors.length}`);
      } catch (e) {
        errors.push({ url, err: String(e.message || e).slice(0, 160) });
        if (errors.length <= 10) console.error(`[ERR] ${url}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n[DONE] total=${rows.length} uploaded=${uploaded} skipped=${skipped} bad=${bad} bytes=${(bytes / 1e9).toFixed(2)}GB errors=${errors.length}`);
  if (bad) console.log(`[WARN] '/bible-audio/' 마커 없는 url ${bad}건 (건너뜀)`);
  if (errors.length) {
    console.log("[ERRORS sample]", errors.slice(0, 20));
    process.exit(2);
  }
  console.log("[OK] 전 파일 업로드 완료");
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
