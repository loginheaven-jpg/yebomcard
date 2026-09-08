// upload_r2.mjs — 생성된 절별 wav 를 mp3 로 인코딩해 예봄성경 공유 캐시(R2)에 올린다.
//
//   node upload_r2.mjs --job <작업ID> --voice-key f4 [--bitrate 96k] [--dry] [--force]
//
// 키 규칙은 예봄성경 서버(app/api/tts/route.ts)와 **반드시 동일**해야 한다:
//   tts/v1/ko/{voiceKey}/{sha1(정제본문)}.mp3
// 정제본문 = DB 본문에서 "(주:…)" 제거 후 trim — jobs 의 item.text 가 이미 그 값이다.
// (구두점 주입·대시 정리는 '생성 입력'에만 쓴 변형이므로 키에는 반영하지 않는다)
//
// 서버는 합성 전에 이 키를 먼저 조회하므로, 올려두면 코드 수정 없이 서빙된다.

import { createHash } from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]]);
    return acc;
  }, [])
);

const JOB = args.job;
const VOICE_KEY = args["voice-key"];
const BITRATE = args.bitrate || "96k";
const DRY = !!args.dry;
const FORCE = !!args.force;
if (!JOB || !VOICE_KEY) {
  console.error("사용법: node upload_r2.mjs --job <작업ID> --voice-key f4 [--bitrate 96k] [--dry] [--force]");
  process.exit(1);
}

// ── env ──
const envFile = path.resolve("../.env.local");
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
  if (!env[k]) { console.error(`.env.local 에 ${k} 없음`); process.exit(1); }
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

const job = JSON.parse(fs.readFileSync(path.join("jobs", `${JOB}.json`), "utf8"));
const items = job.items.filter((i) => i.status === "ok");
console.log(`작업 ${JOB} · 보이스 ${job.voice} → 키 ${VOICE_KEY}`);
console.log(`합격 ${items.length} / 전체 ${job.items.length}  (보류·대기는 올리지 않음)`);
if (DRY) console.log("** DRY RUN — 실제 업로드 안 함 **");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ttsup-"));
let up = 0, skip = 0, fail = 0, bytes = 0;

const exists = async (Key) => {
  try { await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key })); return true; }
  catch { return false; }
};

for (let n = 0; n < items.length; n++) {
  const it = items[n];
  const sha = createHash("sha1").update(it.text, "utf8").digest("hex");
  const Key = `tts/v1/ko/${VOICE_KEY}/${sha}.mp3`;
  try {
    if (!fs.existsSync(it.out)) { fail++; console.log(`  없음: ${it.ref}`); continue; }
    if (!FORCE && (await exists(Key))) { skip++; continue; }
    const mp3 = path.join(tmp, `${sha}.mp3`);
    execFileSync("ffmpeg", ["-y", "-i", it.out, "-ac", "1", "-b:a", BITRATE, mp3], { stdio: "ignore" });
    const body = fs.readFileSync(mp3);
    if (!DRY) {
      await s3.send(new PutObjectCommand({
        Bucket: env.R2_BUCKET, Key, Body: body, ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: { "x-tts-voice": `voice:${VOICE_KEY}` },
      }));
    }
    fs.unlinkSync(mp3);
    up++; bytes += body.length;
  } catch (e) {
    fail++;
    console.log(`  실패 ${it.ref}: ${String(e.message).slice(0, 120)}`);
  }
  if ((n + 1) % 50 === 0 || n === items.length - 1) {
    console.log(`  ${n + 1}/${items.length} · 업로드 ${up} · 건너뜀 ${skip} · 실패 ${fail}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n완료 — 업로드 ${up} · 건너뜀 ${skip} · 실패 ${fail} · ${(bytes / 1048576).toFixed(1)}MB`);
if (up && !DRY) {
  const sample = items[0];
  const sha = createHash("sha1").update(sample.text, "utf8").digest("hex");
  console.log(`확인용 키 예시: tts/v1/ko/${VOICE_KEY}/${sha}.mp3  (${sample.ref})`);
}
