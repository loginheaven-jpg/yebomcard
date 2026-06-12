/**
 * 품질 비교용: easy 마가복음(mrk) 16장을 64k 모노로 재인코딩 → R2 테스트 경로.
 * 원본(easy/mrk)은 건드리지 않고 test64/easy/mrk/ 에 별도 적재.
 *   비교: 원본(Supabase .../easy/mrk/NNN.mp3) vs 64k(R2 .../test64/easy/mrk/NNN.mp3)
 * 실행: node scripts/reencode-test-easy-mrk.mjs
 */
import { spawn } from "child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const MARKER = "/bible-audio/";

const s3 = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
const supa = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function transcode(url) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner","-loglevel","error","-i",url,"-ac","1","-b:a","64k","-map_metadata","-1","-f","mp3","pipe:1"]);
    const out = [], err = [];
    ff.stdout.on("data", (c) => out.push(c));
    ff.stderr.on("data", (c) => err.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(0,160)}`)));
  });
}

const { data, error } = await supa.from("bible_audio").select("audio_url,file_bytes,chapter")
  .eq("version", "easy").eq("book_code", "mrk").order("chapter");
if (error) throw error;
console.log(`[INFO] easy 마가복음 ${data.length}장 64k 재인코딩 → test64/`);

let origBytes = 0, newBytes = 0;
for (const row of data) {
  const url = row.audio_url;
  const key = "test64/" + url.slice(url.indexOf(MARKER) + MARKER.length); // test64/easy/mrk/NNN.mp3
  const buf = await transcode(url);
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "audio/mpeg", CacheControl: "public, max-age=3600" }));
  origBytes += row.file_bytes || 0; newBytes += buf.length;
  console.log(`  ${key}  ${((row.file_bytes||0)/1e6).toFixed(2)}MB → ${(buf.length/1e6).toFixed(2)}MB`);
}
console.log(`\n[DONE] 원본 ${(origBytes/1e6).toFixed(1)}MB → 64k ${(newBytes/1e6).toFixed(1)}MB (${(100*newBytes/origBytes).toFixed(0)}%)`);
console.log(`\n비교 URL (마가복음 1장):`);
console.log(`  원본: ${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bible-audio/easy/mrk/001.mp3`);
console.log(`  64k : ${R2_PUBLIC_BASE}/test64/easy/mrk/001.mp3`);
