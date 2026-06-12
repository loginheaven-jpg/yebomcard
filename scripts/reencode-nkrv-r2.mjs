/**
 * nkrv(개역개정) 음원을 64k 모노로 재인코딩 → R2(attached) nkrv/ 덮어쓰기.
 *
 * - 소스: Supabase 원본 공개 URL (bible_audio.version='nkrv' 의 audio_url, 아직 갱신 전)
 * - ffmpeg 가 URL 을 직접 받아 64k mono 변환 → stdout → R2 PutObject(같은 key 덮어씀)
 * - R2 key = url 의 '/bible-audio/' 뒤 (nkrv/<book>/NNN.mp3) — URL/DB 갱신엔 영향 없음
 *
 * 실행: node scripts/reencode-nkrv-r2.mjs
 */
import { spawn } from "child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const {
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const MARKER = "/bible-audio/";
const CONCURRENCY = 6; // ffmpeg CPU 부하 고려

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const supa = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function transcode(url) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", url,
      "-ac", "1", "-b:a", "64k", "-map_metadata", "-1",
      "-f", "mp3", "pipe:1",
    ]);
    const out = [], err = [];
    ff.stdout.on("data", (c) => out.push(c));
    ff.stderr.on("data", (c) => err.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(0, 160)}`));
    });
  });
}

async function main() {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supa
      .from("bible_audio").select("audio_url").eq("version", "nkrv")
      .order("id", { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < page) break;
  }
  console.log(`[INFO] nkrv ${rows.length} files, 64k mono 재인코딩, 동시성 ${CONCURRENCY}`);

  const queue = rows.map((r) => r.audio_url);
  let done = 0, ok = 0, bytes = 0;
  const errors = [];
  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      const key = url.slice(url.indexOf(MARKER) + MARKER.length);
      try {
        const buf = await transcode(url);
        if (!buf.length) throw new Error("empty output");
        await s3.send(new PutObjectCommand({
          Bucket: R2_BUCKET, Key: key, Body: buf,
          ContentType: "audio/mpeg", CacheControl: "public, max-age=31536000, immutable",
        }));
        ok++; bytes += buf.length; done++;
        if (done % 100 === 0)
          console.log(`[PROGRESS] ${done}/${rows.length} ok=${ok} ${(bytes / 1e9).toFixed(2)}GB err=${errors.length}`);
      } catch (e) {
        errors.push({ key, err: String(e.message || e).slice(0, 160) });
        if (errors.length <= 10) console.error(`[ERR] ${key}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n[DONE] nkrv ${rows.length} → ok=${ok} new_size=${(bytes / 1e9).toFixed(2)}GB errors=${errors.length}`);
  if (errors.length) { console.log("[ERRORS sample]", errors.slice(0, 20)); process.exit(2); }
  console.log("[OK] nkrv 재인코딩 완료");
}

main().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
