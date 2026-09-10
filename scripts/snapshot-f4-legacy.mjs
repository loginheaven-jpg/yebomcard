/**
 * 영희(f4) 구방식 음원 동결 목록 — 새 생성 방식으로 넘어가기 직전에 한 번만 찍는다.
 *
 *   node scripts/snapshot-f4-legacy.mjs          # 목록 작성 (이미 있으면 거부)
 *   node scripts/snapshot-f4-legacy.mjs --force  # 덮어쓰기 — 전환 뒤에 다시 찍으면 새 방식 음원까지 섞인다
 *
 * 왜 필요한가
 *   지금까지의 영희 음원은 음성 복제 기본값인 '본문 흘려 넣기' 모드(non_streaming_mode=False)로
 *   만들었다. 이 모드는 대상 본문의 끝 신호가 참조 음성 한가운데에 찍혀, 모델이 어디서 끝나는지를
 *   흐릿하게 알고 **절 끝 음절을 짧게 맺는다**(실측: 절 끝 중앙값 98ms, 12회 중 9회가 150ms 미만.
 *   통째로 넣기로 바꾸면 218ms, 3회).
 *
 *   결정(2026-09-10): 남은 절부터 새 방식으로 성경 전체를 마친 뒤, 이 목록의 절을 다시 만들어 교체한다.
 *   그러려면 '구방식으로 만든 절' 이 정확히 무엇인지 동결 시점에 기록해 두어야 한다.
 *
 * 무엇을 기록하는가
 *   DB 의 새번역 전 절을 공유 캐시 규칙(sha1(주석 제거 본문))으로 해싱해 R2 tts/v1/ko/f4/ 에
 *   그 키가 있는 절을 모두 담는다. 어느 PC 가 만들었든 상관없다.
 *   본문이 같은 절은 파일 하나를 함께 쓰므로 교체도 파일 단위로 한 번이면 된다.
 *
 * 교체 단계에서 쓰는 규칙
 *   목록의 절 가운데, 지금 본문으로 계산한 키의 객체가 있고 그 LastModified 가 snapshotAt 이전이면
 *   아직 구방식이다. snapshotAt 이후면 이미 교체됐다. 객체가 없으면 본문이 바뀐 것 — 평소 생성이 맡는다.
 *
 * 전제 — 동결 시점에 어느 PC 도 구코드로 생성하고 있지 않아야 한다.
 *   그래서 마지막 업로드 시각을 함께 찍는다. 최근 10분 안에 업로드가 있으면 경고한다.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "scripts", "data", "f4-legacy-streaming.json");
const FORCE = process.argv.includes("--force");

if (fs.existsSync(OUT) && !FORCE) {
  console.error(`이미 동결 목록이 있습니다: ${path.relative(ROOT, OUT)}`);
  console.error("전환 뒤에 다시 찍으면 새 방식 음원까지 구방식으로 섞입니다. 정말 다시 찍으려면 --force");
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

/** lib/tts/verseText.ts · voice/engine.py 와 문자 단위로 같아야 한다 */
const NOTE_RE = /\s*\(\s*주\s*[:：][\s\S]*$/;
const cleanForTts = (t) => t.replace(NOTE_RE, "").trim() || t;
const hashOf = (t) => crypto.createHash("sha1").update(t).digest("hex");

async function fetchVerses() {
  const H = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/bible_verses?version=eq.rnksv&select=book_code,chapter,verse,text&order=id`,
      { headers: { ...H, "Range-Unit": "items", Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) throw new Error(`본문 조회 실패 ${res.status}`);
    const part = await res.json();
    rows.push(...part);
    if (part.length < 1000) break;
  }
  return rows;
}

async function listAudio() {
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const out = new Map();
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: "tts/v1/ko/f4/", ContinuationToken: token }),
    );
    for (const o of r.Contents || []) {
      const m = o.Key.match(/([0-9a-f]{40})\.mp3$/);
      if (m) out.set(m[1], o.LastModified);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function main() {
  const snapshotAt = new Date();
  const [verses, audio] = await Promise.all([fetchVerses(), listAudio()]);

  const latest = [...audio.values()].reduce((a, b) => (b > a ? b : a), new Date(0));
  const minsAgo = Math.round((snapshotAt - latest) / 60000);

  const byBook = {};
  const used = new Set();
  let total = 0;
  for (const r of verses) {
    const h = hashOf(cleanForTts(r.text || ""));
    const at = audio.get(h);
    if (!at) continue;
    used.add(h);
    total++;
    (byBook[r.book_code] ||= []).push([r.chapter, r.verse, h, at.toISOString()]);
  }
  const unmapped = [...audio.keys()].filter((h) => !used.has(h)).length;

  const counts = Object.fromEntries(Object.entries(byBook).map(([b, v]) => [b, v.length]));
  const doc = {
    note:
      "영희(f4) 구방식 음원 동결 목록. 이 목록의 절은 본문 흘려 넣기 모드(non_streaming_mode=False)로 만들어 " +
      "절 끝 음절이 짧게 잘린 것이 많다. 성경 전체를 새 방식으로 마친 뒤 다시 만들어 교체한다.",
    snapshotAt: snapshotAt.toISOString(),
    method: "Qwen3-TTS-12Hz-1.7B voice clone (ICL) · non_streaming_mode=False",
    replacedBy: "non_streaming_mode=True + 절 끝 음절 길이 검사",
    voiceKey: "f4",
    rule:
      "목록의 절 중 현재 본문 키의 객체 LastModified 가 snapshotAt 이전이면 아직 구방식, 이후면 교체됨. " +
      "객체가 없으면 본문이 바뀐 것이므로 평소 생성이 맡는다.",
    latestUploadAt: latest.toISOString(),
    totalVerses: total,
    files: used.size,
    unmappedFiles: unmapped,
    counts,
    fields: ["chapter", "verse", "sha1", "lastModified"],
    verses: byBook,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc));

  console.log(`동결 시각      ${snapshotAt.toLocaleString("ko-KR")}`);
  console.log(`마지막 업로드  ${latest.toLocaleString("ko-KR")} (${minsAgo}분 전)`);
  if (minsAgo < 10) {
    console.log("  ⚠ 최근 10분 안에 업로드가 있습니다 — 어느 PC 가 아직 구코드로 만들고 있을 수 있습니다");
  }
  console.log(`구방식 절      ${total}절 · 파일 ${used.size}개 (본문이 같은 절은 파일을 함께 씀)`);
  console.log(`어느 절에도 안 맞는 파일 ${unmapped}개 — 본문 정정 전 옛 키 등 고아, 교체 대상 아님`);
  console.log(`저장          ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
  console.log("\n책별");
  for (const [b, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(4)} ${String(n).padStart(5)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
