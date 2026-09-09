/**
 * 1000행 잘림 재현 — 수정 전후 비교.
 *
 *   node scripts/verify-reading-progress-range.mjs          # 전체(삽입 → 비교 → 정리)
 *   node scripts/verify-reading-progress-range.mjs --keep   # 테스트 데이터 남김
 *
 * 왜 필요한가
 *   PostgREST 가 max-rows=1000 하드 캡을 걸어 두었는데, 통독 진도는 성경 1,189장을
 *   전량 조회한다. 완주에 가까워질수록 읽은 장이 조용히 사라지고 진도가 되돌아간다.
 *   오류도 경고도 없어서 "왜 진도가 줄었지?" 로만 보인다.
 *
 *   게다가 재열람 시 read_at 이 갱신되므로(app/api/reading-progress POST),
 *   정렬이 read_at desc 인 이 조회에서는 **잘려나가는 대상이 매번 달라진다.**
 *   어제 욥기를 다시 열면 오늘은 다른 장이 사라진다.
 *
 * 무엇을 보여주는가
 *   테스트 계정에 성경읽기진도표가 덮는 1,188장을 넣고,
 *     (수정 전) range 없는 단일 조회
 *     (수정 후) range 페이지네이션
 *   두 결과로 각각 통독 진도와 91회차 완료 수를 계산해 나란히 보여준다.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TEST_USER = "__range_probe_test__";
const KEEP = process.argv.includes("--keep");

// ── env ──
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error(".env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// ── 성경읽기진도표(yebom91) 회차 정의 ──
// lib/plans/yebom91.ts 가 아직 없으므로 여기 최소 형태로 둔다.
// 파일이 생기면 이 블록을 지우고 그쪽을 import 한다.
const CC = {
  gen: 50, exo: 40, lev: 27, num: 36, deu: 34, jos: 24, jdg: 21, rut: 4,
  "1sa": 31, "2sa": 24, "1ki": 22, "2ki": 25, "1ch": 29, "2ch": 36, ezr: 10,
  neh: 13, est: 10, job: 42, psa: 150, pro: 31, ecc: 12, sng: 8, isa: 66,
  jer: 52, lam: 5, ezk: 48, dan: 12, hos: 14, jol: 3, amo: 9, oba: 1, jon: 4,
  mic: 7, nam: 3, hab: 3, zep: 3, hag: 2, zec: 14, mal: 4,
  mat: 28, mrk: 16, luk: 24, jhn: 21, act: 28, rom: 16, "1co": 16, "2co": 13,
  gal: 6, eph: 6, php: 4, col: 4, "1th": 5, "2th": 3, "1ti": 6, "2ti": 4,
  tit: 3, phm: 1, heb: 13, jas: 5, "1pe": 5, "2pe": 3, "1jn": 5, "2jn": 1,
  "3jn": 1, jud: 1, rev: 22,
};
const c = (b, f, t = f) => [b, f, t];
const w = (b) => [b, 1, CC[b]];
const UNITS = [
  [c("job",1,13)],[c("job",14,27)],[c("job",28,42)],
  [c("gen",1,13)],[c("gen",14,27)],[c("gen",28,40)],
  [c("gen",41,50),c("exo",1,4)],[c("exo",5,19)],[c("exo",20,31)],
  [c("exo",32,40),c("num",9,9)],[c("num",1,8)],[c("num",10,19)],[c("num",20,36)],
  [c("lev",1,10)],[c("lev",11,27)],[c("deu",1,13)],[c("deu",14,27)],
  [c("deu",28,34),c("jos",1,5)],[c("jos",6,19)],[c("jos",20,24),c("jdg",1,5)],
  [c("jdg",6,16)],[c("jdg",17,21),c("rut",1,4)],[c("1sa",1,6)],[c("1sa",7,20)],
  [c("psa",1,2),c("psa",4,17),c("psa",59)],
  [c("1sa",21,24),c("psa",52),c("psa",54),c("psa",56),c("psa",57),c("psa",63)],
  [c("1sa",25,31),c("2sa",1),c("psa",19,30)],[c("2sa",2,7),c("psa",31,41)],
  [c("2sa",8,12),c("psa",60),c("psa",51)],[c("psa",42,50),c("2sa",13,15),c("psa",3)],
  [c("2sa",16,24),c("psa",53),c("psa",55),c("psa",58),c("psa",61,62)],
  [c("psa",64,71),c("1ki",1,6)],[c("psa",72),c("pro",1,15)],
  [c("1ki",7,11),c("sng",1,8)],[c("pro",16,31)],[c("ecc",1,12)],[c("1ki",12,22)],
  [c("2ki",1,10),c("oba",1)],
  [c("2ki",11,15),c("jol",1,3),c("jon",1,4),c("amo",1,9)],
  [c("2ki",15,17),c("isa",1,4)],[c("hos",1,14)],[c("isa",5,24)],[c("isa",25,35)],
  [c("mic",1,7),c("2ki",18,20)],[c("isa",36,52)],[c("isa",53,66),c("mat",26,27)],
  [c("2ki",21),c("nam",1,3),c("2ki",22,23),c("zep",1,3)],
  [c("jer",1,15)],[c("jer",16,34)],
  [c("2ki",23,23),c("jer",35,40),c("2ki",24),c("jer",52,52)],
  [c("2ki",25),c("jer",43,51),c("jer",40,42),c("jer",52,52)],
  [c("lam",1,5),c("hab",1,3)],[c("1ch",1,9)],[c("1ch",9,14)],
  [c("1ch",15,16),c("psa",105),c("psa",73,83)],[c("psa",84,89),c("1ch",17,21)],
  [c("psa",90,104),c("psa",106)],[c("1ch",22,26),c("psa",107,117)],
  [c("psa",118,134),c("1ch",27,29)],[c("psa",135,150)],
  [c("2ch",1,10)],[c("2ch",11,21)],[c("2ch",22,36)],[c("dan",1,12)],
  [c("ezk",1,10)],[c("ezk",11,28)],[c("ezk",29,42)],[c("ezk",43,48)],
  [c("2ch",36,36),c("ezr",1,10)],[c("hag",1,2),c("zec",1,7)],
  [c("zec",8,14),c("mal",1,4)],[c("est",1,10)],[c("neh",1,13)],
  [w("mat")],[w("mrk")],[w("luk")],[w("jhn")],[c("act",1,12)],
  [c("act",13,15),w("gal"),c("act",15,16)],[c("act",17,19)],
  [w("1th"),w("2th")],[w("1co")],[c("act",19,20),w("2co")],
  [c("act",20,20),c("rom",1,6)],[c("rom",7,16),c("act",20,28)],
  [w("col"),w("phm"),w("eph")],[w("php"),w("1ti"),w("tit"),w("2ti")],
  [w("jas"),w("jud"),w("1pe"),w("2pe")],[w("heb")],
  [w("1jn"),w("2jn"),w("3jn")],[w("rev")],
];

const unitChapters = (ranges) => {
  const out = [], seen = new Set();
  for (const [b, f, t] of ranges) {
    for (let ch = f; ch <= t; ch++) {
      const k = `${b} ${ch}`;
      if (!seen.has(k)) { seen.add(k); out.push([b, ch]); }
    }
  }
  return out;
};

/** 플랜이 덮는 모든 장 — 읽기 순서대로(중복 제거) */
function planChapters() {
  const out = [], seen = new Set();
  for (const ranges of UNITS) {
    for (const [b, ch] of unitChapters(ranges)) {
      const k = `${b} ${ch}`;
      if (!seen.has(k)) { seen.add(k); out.push([b, ch]); }
    }
  }
  return out;
}

/** lib/reading-progress.ts computeProgress 와 같은 규칙 */
function readByBook(rows) {
  const m = {};
  for (const r of rows) {
    const max = CC[r.book_code];
    if (!max || r.chapter < 1 || r.chapter > max) continue;
    (m[r.book_code] ??= new Set()).add(r.chapter);
  }
  return m;
}

/** 지시서 3.2 computeUnitProgress — 수동 체크 없음 기준 */
function unitStats(rows) {
  const by = readByBook(rows);
  let done = 0, currentSeq = 91;
  let firstIncomplete = null;
  UNITS.forEach((ranges, i) => {
    const chs = unitChapters(ranges);
    const read = chs.filter(([b, ch]) => by[b]?.has(ch)).length;
    if (read === chs.length) done++;
    else if (firstIncomplete === null) firstIncomplete = i + 1;
  });
  if (firstIncomplete !== null) currentSeq = firstIncomplete;
  const totalRead = Object.values(by).reduce((s, set) => s + set.size, 0);
  return { done, currentSeq, totalRead, percent: Math.round((totalRead / 1189) * 1000) / 10 };
}

// ── 조회 두 가지 ──
const SELECT = "book_code,chapter,read_at";
const ORDER = "read_at.desc";

/** 수정 전: range 없이 한 번에 (실제 배포 코드가 하던 것) */
async function fetchOld() {
  const r = await fetch(
    `${URL_}/rest/v1/reading_progress?select=${SELECT}&user_id=eq.${TEST_USER}&order=${ORDER}`,
    { headers: H },
  );
  if (!r.ok) throw new Error(`조회 실패 ${r.status}: ${await r.text()}`);
  return r.json();
}

/** 수정 후: lib/supabasePaged.ts 와 같은 규칙으로 1000행씩 */
async function fetchNew() {
  const out = [];
  for (let i = 0; i < 60; i++) {
    const from = i * 1000, to = from + 999;
    const r = await fetch(
      `${URL_}/rest/v1/reading_progress?select=${SELECT}&user_id=eq.${TEST_USER}&order=${ORDER}`,
      { headers: { ...H, Range: `${from}-${to}`, "Range-Unit": "items" } },
    );
    if (!r.ok) throw new Error(`조회 실패 ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ── 테스트 데이터 ──
async function seed(chs) {
  console.log(`테스트 계정에 ${chs.length}장 삽입 중...`);
  // read_at 을 플랜 순서대로 과거→현재로 흩는다.
  // 정렬이 read_at desc 라, 잘리면 "가장 먼저 읽은 것"(욥기·창세기)부터 사라진다.
  const base = Date.parse("2026-01-01T00:00:00Z");
  const rows = chs.map(([b, ch], i) => ({
    user_id: TEST_USER,
    book_code: b,
    chapter: ch,
    version: "rnksv",
    read_at: new Date(base + i * 60_000).toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${URL_}/rest/v1/reading_progress`, {
      method: "POST",
      headers: { ...H, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`삽입 실패 ${r.status}: ${await r.text()}`);
  }
}

async function cleanup() {
  const r = await fetch(`${URL_}/rest/v1/reading_progress?user_id=eq.${TEST_USER}`, {
    method: "DELETE",
    headers: { ...H, Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`정리 실패 ${r.status}: ${await r.text()}`);
}

function report(label, rows) {
  const s = unitStats(rows);
  console.log(
    `  ${label.padEnd(10)} 받은 행 ${String(rows.length).padStart(5)} · ` +
    `통독 ${String(s.totalRead).padStart(4)}/1189 (${s.percent}%) · ` +
    `회차 완료 ${String(s.done).padStart(2)}/91 · 지금 ${s.currentSeq}회차`,
  );
  return s;
}

// ── 본체 ──
const chs = planChapters();
console.log(`성경읽기진도표가 덮는 장: ${chs.length}장 (전체 1189장 중)\n`);

await cleanup(); // 이전 실행 잔재 제거
await seed(chs);

console.log("\n수정 전후 비교");
const before = report("수정 전", await fetchOld());
const after = report("수정 후", await fetchNew());

console.log("\n판정");
if (before.done === after.done && before.totalRead === after.totalRead) {
  console.log("  차이 없음 — 이 데이터 규모에서는 재현되지 않습니다.");
} else {
  console.log(`  사라진 장       ${after.totalRead - before.totalRead}장`);
  console.log(`  못 세는 회차    ${after.done - before.done}회차`);
  console.log(`  '지금' 회차     ${before.currentSeq}회차 ← 실제는 ${after.currentSeq}회차`);
  console.log("  → 수정 전에는 91회차를 다 읽어도 완주로 표시되지 않습니다.");
}

if (KEEP) {
  console.log(`\n(--keep) 테스트 데이터를 남깁니다. user_id = ${TEST_USER}`);
} else {
  await cleanup();
  console.log("\n테스트 데이터 정리 완료");
}
