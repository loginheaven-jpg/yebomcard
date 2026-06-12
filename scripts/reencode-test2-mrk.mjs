/** 레시피3 비교용: easy 마가복음 16장 → 80k 평균다운믹스+-2.5dB → R2 test80/ */
import { spawn } from "child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const MARKER = "/bible-audio/";
const AF = "pan=mono|c0=0.5*c0+0.5*c1,volume=-2.5dB";
const s3 = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
const supa = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
function transcode(url) {
  return new Promise((res, rej) => {
    const ff = spawn("ffmpeg", ["-hide_banner","-loglevel","error","-i",url,"-af",AF,"-b:a","80k","-map_metadata","-1","-f","mp3","pipe:1"]);
    const o = [], e = []; ff.stdout.on("data", c=>o.push(c)); ff.stderr.on("data", c=>e.push(c));
    ff.on("error", rej); ff.on("close", c => c===0 ? res(Buffer.concat(o)) : rej(new Error(Buffer.concat(e).toString().slice(0,160))));
  });
}
const { data } = await supa.from("bible_audio").select("audio_url,file_bytes,chapter").eq("version","easy").eq("book_code","mrk").order("chapter");
let orig=0,neu=0;
for (const r of data) {
  const key = "test80/" + r.audio_url.slice(r.audio_url.indexOf(MARKER)+MARKER.length);
  const buf = await transcode(r.audio_url);
  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "audio/mpeg", CacheControl: "public, max-age=3600" }));
  orig += r.file_bytes||0; neu += buf.length;
  console.log(`  ${key}  ${((r.file_bytes||0)/1e6).toFixed(2)}MB → ${(buf.length/1e6).toFixed(2)}MB`);
}
console.log(`\n[DONE] 원본 ${(orig/1e6).toFixed(1)}MB → 레시피3 80k ${(neu/1e6).toFixed(1)}MB (${(100*neu/orig).toFixed(0)}%)`);
for (const ch of ["001","006","014"]) {
  console.log(`\n마가 ${ch}:`);
  console.log(`  원본    : ${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bible-audio/easy/mrk/${ch}.mp3`);
  console.log(`  레시피3 : ${R2_PUBLIC_BASE}/test80/easy/mrk/${ch}.mp3`);
  console.log(`  (나쁜64k): ${R2_PUBLIC_BASE}/test64/easy/mrk/${ch}.mp3`);
}
