/**
 * easy + nkrv 음원 최종 재인코딩 → R2(attached) 덮어쓰기.
 * 레시피3: 평균 다운믹스(0.5L+0.5R) + -2.5dB 헤드룸 + 80k mono.
 *   - 합산 다운믹스(-ac 1) 클리핑 + 64k 오버슈트 문제 해결. peak가 원본 수준(~0.7dB).
 *   - 소스: Supabase 원본(stereo 128k, audio_url). nkrv 의 기존 -ac1 64k 도 이걸로 교체.
 * 실행: node scripts/reencode-r2-final.mjs
 */
import { spawn } from "child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const MARKER = "/bible-audio/";
const CONCURRENCY = 6;
const AF = "pan=mono|c0=0.5*c0+0.5*c1,volume=-2.5dB";
const BITRATE = "80k";

const s3 = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });
const supa = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function transcode(url) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner","-loglevel","error","-i",url,"-af",AF,"-b:a",BITRATE,"-map_metadata","-1","-f","mp3","pipe:1"]);
    const out = [], err = [];
    ff.stdout.on("data", (c) => out.push(c));
    ff.stderr.on("data", (c) => err.push(c));
    ff.on("error", reject);
    ff.on("close", (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(0,160)}`)));
  });
}

async function main() {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supa.from("bible_audio").select("audio_url,version")
      .in("version", ["easy", "nkrv"]).order("id", { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < page) break;
  }
  console.log(`[INFO] ${rows.length} files 재인코딩 (${AF} @ ${BITRATE}), 동시성 ${CONCURRENCY}`);

  const queue = [...rows];
  let done = 0, ok = 0; const bytesByVer = { easy: 0, nkrv: 0 };
  const errors = [];
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      const url = row.audio_url;
      const key = url.slice(url.indexOf(MARKER) + MARKER.length);
      try {
        const buf = await transcode(url);
        if (!buf.length) throw new Error("empty");
        await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf,
          ContentType: "audio/mpeg", CacheControl: "public, max-age=31536000, immutable" }));
        ok++; bytesByVer[row.version] += buf.length; done++;
        if (done % 100 === 0) console.log(`[PROGRESS] ${done}/${rows.length} ok=${ok} easy=${(bytesByVer.easy/1e9).toFixed(2)}GB nkrv=${(bytesByVer.nkrv/1e9).toFixed(2)}GB err=${errors.length}`);
      } catch (e) {
        errors.push({ key, err: String(e.message || e).slice(0, 160) });
        if (errors.length <= 10) console.error(`[ERR] ${key}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\n[DONE] ok=${ok}/${rows.length} easy=${(bytesByVer.easy/1e9).toFixed(2)}GB nkrv=${(bytesByVer.nkrv/1e9).toFixed(2)}GB errors=${errors.length}`);
  if (errors.length) { console.log("[ERRORS]", errors.slice(0, 20)); process.exit(2); }
  console.log("[OK] 재인코딩 완료");
}
main().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
