/**
 * 영희(f4) 음원 진도 — 여러 PC 를 한 곳에서 본다.
 *
 *   node scripts/voice-progress.mjs            # 권별 진도 + 최근 활동
 *   node scripts/voice-progress.mjs --ot       # 구약만
 *   node scripts/voice-progress.mjs --nt       # 신약만
 *   node scripts/voice-progress.mjs --hours 3  # 최근 몇 시간 활동을 볼지 (기본 6)
 *
 * 왜 이렇게 하는가
 *   생성은 PC 마다 따로 돈다. 각 PC 의 `voice/jobs/*.json` 은 그 PC 안에만 있어서
 *   다른 PC 가 어디까지 왔는지 알 방법이 없다. 중앙 보류 큐는 "문제가 된 절"만 모으므로
 *   진도를 재는 자로는 못 쓴다.
 *
 *   대신 **산출물 자체를 센다.** 공유 캐시가 콘텐츠 주소화라 키가 `sha1(주석 제거 본문)` 이므로,
 *   DB 의 모든 절을 같은 규칙으로 해싱해 R2 에 그 키가 있는지 맞춰 보면 어느 PC 가 만들었든
 *   상관없이 절 단위 진도가 나온다. LastModified 로 최근 활동까지 읽는다.
 *
 *   즉 이 스크립트는 PC 에 접속하지 않고도 "돌고 있나 · 어디까지 왔나"에 답한다.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const ONLY_OT = argv.includes("--ot");
const ONLY_NT = argv.includes("--nt");
const HOURS = Number(argv[argv.indexOf("--hours") + 1]) || 6;

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

/** lib/tts/verseText.ts · voice/engine.py 와 문자 단위로 같아야 한다 */
const NOTE_RE = /\s*\(\s*주\s*[:：][\s\S]*$/;
const cleanForTts = (t) => t.replace(NOTE_RE, "").trim() || t;
const hashOf = (t) => crypto.createHash("sha1").update(t).digest("hex");

// 진도표 기준 구약 39권 / 신약 27권
const OT = [
  ["gen","창세기"],["exo","출애굽기"],["lev","레위기"],["num","민수기"],["deu","신명기"],
  ["jos","여호수아"],["jdg","사사기"],["rut","룻기"],["1sa","사무엘상"],["2sa","사무엘하"],
  ["1ki","열왕기상"],["2ki","열왕기하"],["1ch","역대상"],["2ch","역대하"],["ezr","에스라"],
  ["neh","느헤미야"],["est","에스더"],["job","욥기"],["psa","시편"],["pro","잠언"],
  ["ecc","전도서"],["sng","아가"],["isa","이사야"],["jer","예레미야"],["lam","예레미야애가"],
  ["ezk","에스겔"],["dan","다니엘"],["hos","호세아"],["jol","요엘"],["amo","아모스"],
  ["oba","오바댜"],["jon","요나"],["mic","미가"],["nam","나훔"],["hab","하박국"],
  ["zep","스바냐"],["hag","학개"],["zec","스가랴"],["mal","말라기"],
];
const NT = [
  ["mat","마태복음"],["mrk","마가복음"],["luk","누가복음"],["jhn","요한복음"],["act","사도행전"],
  ["rom","로마서"],["1co","고린도전서"],["2co","고린도후서"],["gal","갈라디아서"],["eph","에베소서"],
  ["php","빌립보서"],["col","골로새서"],["1th","데살로니가전서"],["2th","데살로니가후서"],
  ["1ti","디모데전서"],["2ti","디모데후서"],["tit","디도서"],["phm","빌레몬서"],["heb","히브리서"],
  ["jas","야고보서"],["1pe","베드로전서"],["2pe","베드로후서"],["1jn","요한일서"],["2jn","요한이서"],
  ["3jn","요한삼서"],["jud","유다서"],["rev","요한계시록"],
];

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
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  const out = new Map(); // hash → LastModified
  let token;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.R2_BUCKET,
        Prefix: "tts/v1/ko/f4/",
        ContinuationToken: token,
      }),
    );
    for (const o of r.Contents || []) {
      const m = o.Key.match(/([0-9a-f]{40})\.mp3$/);
      if (m) out.set(m[1], o.LastModified);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function bar(pct, width = 22) {
  const n = Math.round((pct / 100) * width);
  return "█".repeat(n) + "·".repeat(width - n);
}

async function main() {
  process.stdout.write("본문·산출물 조회 중...\r");
  const [verses, audio] = await Promise.all([fetchVerses(), listAudio()]);
  process.stdout.write(" ".repeat(30) + "\r");

  // 같은 본문을 쓰는 절이 여럿이면 파일은 하나다 — 절 기준으로 세되 그 사실을 밝힌다
  const byBook = new Map();
  for (const r of verses) {
    const h = hashOf(cleanForTts(r.text || ""));
    const e = byBook.get(r.book_code) || { total: 0, done: 0, last: null };
    e.total++;
    const at = audio.get(h);
    if (at) {
      e.done++;
      if (!e.last || at > e.last) e.last = at;
    }
    byBook.set(r.book_code, e);
  }

  const groups = [];
  if (!ONLY_NT) groups.push(["구약 39권", OT]);
  if (!ONLY_OT) groups.push(["신약 27권", NT]);

  const now = Date.now();
  const ago = (d) => {
    if (!d) return "";
    const m = Math.round((now - d.getTime()) / 60000);
    if (m < 60) return `${m}분 전`;
    if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
    return `${Math.round(m / 1440)}일 전`;
  };

  for (const [title, books] of groups) {
    let gt = 0, gd = 0;
    console.log(`\n${"─".repeat(64)}\n${title}\n`);
    for (const [code, name] of books) {
      const e = byBook.get(code) || { total: 0, done: 0, last: null };
      gt += e.total; gd += e.done;
      const pct = e.total ? (e.done / e.total) * 100 : 0;
      if (e.done === 0) continue; // 아직 손대지 않은 책은 접는다
      const mark = e.done >= e.total ? "완료" : `${pct.toFixed(0)}%`;
      console.log(
        `  ${name.padEnd(7)} ${bar(pct)} ${String(e.done).padStart(5)}/${String(e.total).padEnd(5)} ${mark.padStart(4)}  ${ago(e.last)}`,
      );
    }
    const untouched = books.filter(([c]) => !(byBook.get(c)?.done));
    if (untouched.length) {
      console.log(`  (아직 시작 전 ${untouched.length}권: ${untouched.map((b) => b[1]).slice(0, 8).join(", ")}${untouched.length > 8 ? " …" : ""})`);
    }
    console.log(`\n  합계 ${gd} / ${gt}  (${((gd / gt) * 100).toFixed(1)}%)`);
  }

  // 최근 활동 — 시간대별로 몇 절이 올라왔는가. 돌고 있는지 여기서 드러난다.
  const cutoff = now - HOURS * 3600 * 1000;
  const buckets = new Map();
  for (const d of audio.values()) {
    if (d.getTime() < cutoff) continue;
    const k = new Date(Math.floor(d.getTime() / (30 * 60000)) * 30 * 60000);
    buckets.set(k.getTime(), (buckets.get(k.getTime()) || 0) + 1);
  }
  console.log(`\n${"─".repeat(64)}\n최근 ${HOURS}시간 업로드 (30분 단위)\n`);
  if (buckets.size === 0) {
    console.log("  없음 — 두 PC 모두 멈춰 있습니다");
  } else {
    for (const t of [...buckets.keys()].sort()) {
      const d = new Date(t);
      const n = buckets.get(t);
      console.log(`  ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}  ${String(n).padStart(4)}절  ${"#".repeat(Math.min(60, Math.round(n / 3)))}`);
    }
  }
  console.log(`\n  R2 총 파일 ${audio.size}개 (본문이 같은 절은 한 파일을 공유한다)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
