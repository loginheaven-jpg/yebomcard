/**
 * 말씀의삶 91회차 플랜 데이터 검증 (단계 1).
 *
 *   npx tsc scripts/verify-plan-yebom91.ts --outDir <tmp> --module commonjs \
 *       --target es2022 --skipLibCheck --esModuleInterop
 *   node <tmp>/scripts/verify-plan-yebom91.js
 *
 * (npm run verify:plan 으로도 실행 가능)
 *
 * 지시서 §3.4 가 요구한 세 가지에 더해, **전사 오류를 잡는 검사**를 넣었다.
 * 커버리지만 보면 두 회차의 범위를 서로 바꿔 넣어도 통과한다 — 총합은 같기 때문이다.
 * 그래서 label 의 책 이름·장 번호가 ranges 와 맞는지 따로 대조한다.
 */

import { BOOKS, CHAPTER_COUNTS, TOTAL_CHAPTERS } from "../lib/books";
import {
  YEBOM91,
  unitChapters,
  flattenPlan,
  findPlanIndex,
  boundaryChapters,
  computeUnitProgress,
  planStep,
  chapterKey,
  unitSegments,
  chapterSegments,
  chapterEntryVerse,
} from "../lib/plans/yebom91";

const NAME: Record<string, string> = {};
for (const b of BOOKS) NAME[b.code] = b.nameKr;

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  [실패] ${msg}`);
};

const h = (t: string) => console.log(`\n${"─".repeat(64)}\n${t}\n`);

// ───────────────────────── 1. 구조 ─────────────────────────
h("1. 구조");

const seqs = YEBOM91.units.map((u) => u.seq);
console.log(`  회차 수        ${YEBOM91.units.length}`);
if (YEBOM91.units.length !== 91) fail(`회차가 91개가 아닙니다 (${YEBOM91.units.length})`);
for (let i = 0; i < seqs.length; i++) {
  if (seqs[i] !== i + 1) {
    fail(`seq 가 1..91 연속이 아닙니다 — ${i} 번째가 ${seqs[i]}`);
    break;
  }
}

// ───────────────────────── 2. 범위 유효성 ─────────────────────────
h("2. 범위 유효성 (없는 책 코드 / CHAPTER_COUNTS 초과)");

let rangeErrors = 0;
for (const u of YEBOM91.units) {
  for (const r of u.ranges) {
    const max = CHAPTER_COUNTS[r.book];
    if (max === undefined) {
      fail(`${u.seq}회차: 알 수 없는 책 코드 '${r.book}'`);
      rangeErrors++;
      continue;
    }
    if (r.fromCh < 1 || r.toCh < r.fromCh) {
      fail(`${u.seq}회차: 잘못된 장 범위 ${r.book} ${r.fromCh}-${r.toCh}`);
      rangeErrors++;
    }
    if (r.toCh > max) {
      fail(`${u.seq}회차: ${NAME[r.book]}(${r.book}) ${r.toCh}장 > 실제 ${max}장`);
      rangeErrors++;
    }
  }
}
console.log(`  범위 오류      ${rangeErrors}건  (기대: 0)`);

// ───────────────────────── 3. 커버리지 ─────────────────────────
h("3. 커버리지");

const owners = new Map<string, number[]>();
for (const u of YEBOM91.units) {
  for (const c of unitChapters(u)) {
    const k = chapterKey(c.book, c.chapter);
    owners.set(k, [...(owners.get(k) ?? []), u.seq]);
  }
}

const missing: string[] = [];
for (const b of BOOKS) {
  for (let c = 1; c <= CHAPTER_COUNTS[b.code]; c++) {
    if (!owners.has(chapterKey(b.code, c))) missing.push(`${b.nameKr} ${c}`);
  }
}
console.log(`  플랜이 덮는 장  ${owners.size} / ${TOTAL_CHAPTERS}  (기대: 1188)`);
if (owners.size !== 1188) fail(`커버리지가 1,188장이 아닙니다 (${owners.size})`);

console.log(`\n  한 번도 안 나오는 장 — ${missing.length}개  (기대: 1개, 시편 18)`);
for (const m of missing) console.log(`    ${m}`);
if (!(missing.length === 1 && missing[0] === "시편 18")) {
  fail("미커버 장이 '시편 18' 하나가 아닙니다 — 데이터 전사 오류 가능성");
}

// ───────────────────────── 4. 경계 장 ─────────────────────────
h("4. 두 회차 이상에 나오는 장 (경계 장)");

const dup = [...owners.entries()].filter(([, s]) => s.length > 1);
dup.sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));

console.log(`  경계 장        ${dup.length}개  (기대: 10)`);
console.log();
console.log(`  ${"장".padEnd(18)} ${"회차".padEnd(14)} 회차 맨 앞 여부`);
for (const [k, s] of dup) {
  const [book, chStr] = k.split(":");
  const label = `${NAME[book]} ${chStr}`;
  const heads = s.filter((seq) => {
    const first = unitChapters(YEBOM91.units[seq - 1])[0];
    return first.book === book && first.chapter === Number(chStr);
  });
  const head = heads.length ? `${heads.join("·")}의 [0]` : "아님";
  console.log(`  ${label.padEnd(18)} ${s.join(" · ").padEnd(14)} ${head}`);
}
if (dup.length !== 10) fail(`경계 장이 10개가 아닙니다 (${dup.length}) — 데이터 전사 오류 가능성`);

const boundary = boundaryChapters(YEBOM91);
if (boundary.size !== dup.length) {
  fail(`boundaryChapters() 가 ${boundary.size}개 — 직접 집계 ${dup.length}개와 다릅니다`);
}

// ───────────────────────── 5. label ↔ ranges 대조 ─────────────────────────
h("5. label 과 ranges 대조 (전사 오류 탐지)");

// 커버리지만 보면 두 회차의 범위를 맞바꿔도 통과한다(총합이 같으므로).
// label 에 적힌 책 이름과 장 번호가 실제 ranges 와 맞는지 따로 본다.
// 압축 표기("데살로니가전·후서", "요한1·2·3서")가 있어 이름은 앞 2글자로 대조한다.
let labelWarn = 0;
for (const u of YEBOM91.units) {
  const booksInRanges = [...new Set(u.ranges.map((r) => r.book))];
  for (const code of booksInRanges) {
    const stem = (NAME[code] ?? "").slice(0, 2);
    if (stem && !u.label.includes(stem)) {
      labelWarn++;
      console.log(`  [주의] ${u.seq}회차 label 에 '${NAME[code]}'(${stem}…) 없음 — "${u.label}"`);
    }
  }
  // label 에 나온 최대 장 번호가 ranges 의 최대 장을 넘으면 전사 오류일 수 있다.
  // 절 번호(`15:22` 의 22)는 장이 아니므로 먼저 걷어낸다 — 안 그러면 절 경계 회차가
  // 전부 오탐으로 잡힌다.
  const nums = (u.label.replace(/:\s*\d+/g, "").match(/\d+/g) ?? []).map(Number);
  const maxRange = Math.max(...u.ranges.map((r) => r.toCh));
  const overs = nums.filter((n) => n > maxRange && n > 3); // 1-3 은 "요한1·2·3서" 같은 표기
  if (overs.length) {
    labelWarn++;
    console.log(`  [주의] ${u.seq}회차 label 에 ranges 최대 장(${maxRange})보다 큰 수 ${overs.join(",")} — "${u.label}"`);
  }
}
console.log(`  주의 ${labelWarn}건${labelWarn === 0 ? " — label 과 ranges 가 일치합니다" : " (사람이 확인)"}`);

// ───────────────────────── 6. flatten / 이동 ─────────────────────────
h("6. flattenPlan · planStep");

const flat = flattenPlan(YEBOM91);
console.log(`  선형 길이      ${flat.length}  (커버 ${owners.size} + 경계 중복 ${flat.length - owners.size})`);

const adjacent = flat
  .map((c, i) => [c, flat[i + 1]] as const)
  .filter(([a, b]) => b && a.book === b.book && a.chapter === b.chapter);
console.log(`  인접 동일 장   ${adjacent.length}곳`);
for (const [a, b] of adjacent) {
  console.log(`    ${a.seq}회차 끝 ${NAME[a.book]} ${a.chapter}장 → ${b.seq}회차 시작 ${NAME[b.book]} ${b.chapter}장`);
  // planStep 이 방향 무관하게 건너뛰는지
  const fwd = planStep(flat, a.idx, 1);
  const back = planStep(flat, b.idx, -1);
  if (!fwd || (fwd.book === a.book && fwd.chapter === a.chapter)) {
    fail(`planStep 정방향이 같은 장에 머무릅니다 (${a.seq}→)`);
  } else {
    console.log(`      정방향 → ${fwd.seq}회차 ${NAME[fwd.book]} ${fwd.chapter}장`);
  }
  if (!back || (back.book === b.book && back.chapter === b.chapter)) {
    fail(`planStep 역방향이 같은 장에 머무릅니다 (←${b.seq})`);
  } else {
    console.log(`      역방향 → ${back.seq}회차 ${NAME[back.book]} ${back.chapter}장`);
  }
}

// findPlanIndex 가 경계 장을 seq 로 구분하는지
const [bk, bc] = [...boundary][0].split(":");
const bseqs = owners.get(chapterKey(bk, Number(bc)))!;
const i0 = findPlanIndex(flat, bseqs[0], bk, Number(bc));
const i1 = findPlanIndex(flat, bseqs[1], bk, Number(bc));
console.log(`\n  findPlanIndex  ${NAME[bk]} ${bc}장 → ${bseqs[0]}회차 idx ${i0} / ${bseqs[1]}회차 idx ${i1}`);
if (i0 === -1 || i1 === -1 || i0 === i1) fail("findPlanIndex 가 경계 장을 seq 로 구분하지 못합니다");

// ───────────────────────── 7. 판정 로직 ─────────────────────────
h("7. computeUnitProgress");

const read = (): Record<string, Set<number>> => ({});
const addCh = (m: Record<string, Set<number>>, b: string, c: number) => {
  (m[b] ??= new Set()).add(c);
  return m;
};
const addUnit = (m: Record<string, Set<number>>, seq: number) => {
  for (const c of unitChapters(YEBOM91.units[seq - 1])) addCh(m, c.book, c.chapter);
  return m;
};

// (a) 아무것도 안 읽음
{
  const p = computeUnitProgress(YEBOM91, read(), new Set());
  const ok = p.doneCount === 0 && p.currentSeq === 1
    && p.nextChapter?.book === "job" && p.nextChapter.chapter === 1
    && p.entryChapter?.chapter === 1;
  console.log(`  (a) 백지        지금 ${p.currentSeq}회차 · 다음 ${NAME[p.nextChapter!.book]} ${p.nextChapter!.chapter}장 ${ok ? "✓" : ""}`);
  if (!ok) fail("백지 상태 판정이 기대와 다릅니다");
}

// (b) 1~39회차 읽음 → 40회차 진입 시 경계 장(왕하 15)을 다시 제시해야 한다
{
  const m = read();
  for (let s = 1; s <= 39; s++) addUnit(m, s);
  const p = computeUnitProgress(YEBOM91, m, new Set());
  const nx = p.nextChapter!;
  const en = p.entryChapter!;
  console.log(`  (b) 39회차까지  지금 ${p.currentSeq}회차 · 완료 ${p.doneCount}`);
  console.log(`      다음 읽을 장  ${NAME[nx.book]} ${nx.chapter}장   ← 표시용(경계 장 건너뜀)`);
  console.log(`      진입 장       ${NAME[en.book]} ${en.chapter}장   ← 진입용(경계 장부터)`);
  if (p.currentSeq !== 40) fail(`(b) currentSeq 가 40 이 아닙니다 (${p.currentSeq})`);
  if (!(nx.book === "2ki" && nx.chapter === 16)) fail("(b) nextChapter 가 왕하 16장이 아닙니다");
  if (!(en.book === "2ki" && en.chapter === 15)) fail("(b) entryChapter 가 왕하 15장이 아닙니다");
}

// (c) 고정점이 생기지 않는지 — 경계 장이 맨 앞에 오는 6개 회차 전부에서
//     회차를 읽어나가는 동안 '다음 읽을 장' 이 전진해야 한다.
//     (v1 초안의 "경계 장은 건너뛰지 않는다" 규칙이 여기서 고정점을 만들었다)
{
  const heads = YEBOM91.units.filter((u) => {
    const first = unitChapters(u)[0];
    return boundary.has(chapterKey(first.book, first.chapter));
  });
  console.log(`  (c) 경계 장이 맨 앞인 회차 ${heads.length}개 — 진행 중 '다음 읽을 장' 전진 여부`);
  for (const u of heads) {
    const m = read();
    for (let s = 1; s < u.seq; s++) addUnit(m, s);
    const chs = unitChapters(u);
    const seenNext = new Set<string>();
    for (const c of chs) {
      const p = computeUnitProgress(YEBOM91, m, new Set());
      if (p.currentSeq === u.seq && p.nextChapter) {
        seenNext.add(chapterKey(p.nextChapter.book, p.nextChapter.chapter));
      }
      addCh(m, c.book, c.chapter);
    }
    const okc = seenNext.size > 1;
    console.log(`      ${String(u.seq).padStart(2)}회차 (${chs.length}장) → ${seenNext.size}가지 ${okc ? "✓" : "✗ 고정"}`);
    if (!okc) fail(`(c) ${u.seq}회차에서 nextChapter 가 고정점입니다`);
  }
}

// (g) 완전 중복 — 마태 26·27은 절 분할이 아니라 통째로 겹친다.
//     46회차만 읽은 상태에서 74회차(마태 전권) 진입 장이 1장이어야 한다.
{
  const m = read();
  for (let s = 1; s <= 73; s++) if (s !== 74) addUnit(m, s);
  // 46회차에서 마태 26·27을 이미 읽었고 74회차는 손대지 않은 상태
  const p = computeUnitProgress(YEBOM91, m, new Set());
  const en = p.entryChapter!;
  const nx = p.nextChapter!;
  console.log(`  (g) 46회차만 읽고 74회차 진입 — 지금 ${p.currentSeq}회차 · 진입 ${NAME[en.book]} ${en.chapter}장 · 다음 ${NAME[nx.book]} ${nx.chapter}장`);
  if (p.currentSeq !== 74) fail(`(g) currentSeq 가 74 가 아닙니다 (${p.currentSeq})`);
  if (!(en.book === "mat" && en.chapter === 1)) fail("(g) 마태복음 진입 장이 1장이 아닙니다");
  if (!(nx.book === "mat" && nx.chapter === 1)) fail("(g) 마태복음 다음 장이 1장이 아닙니다");
}

// (d) 수동 체크
{
  const p = computeUnitProgress(YEBOM91, read(), new Set([1, 2]));
  console.log(`  (d) 수동 1·2    완료 ${p.doneCount} · 지금 ${p.currentSeq}회차 · manual ${p.units[0].manual}`);
  if (!(p.doneCount === 2 && p.currentSeq === 3 && p.units[0].manual)) fail("(d) 수동 체크 판정 오류");
}

// (e) 전부 완료 — 완주 센티널에서 엉뚱한 다음 장이 뜨지 않아야 한다
{
  const m = read();
  for (let s = 1; s <= 91; s++) addUnit(m, s);
  const p = computeUnitProgress(YEBOM91, m, new Set());
  console.log(`  (e) 전부 완료   완료 ${p.doneCount}/91 · 지금 ${p.currentSeq}회차 · 다음 ${p.nextChapter} · 진입 ${p.entryChapter}`);
  if (!(p.doneCount === 91 && p.currentSeq === 91 && p.nextChapter === null && p.entryChapter === null)) {
    fail("(e) 완주 상태에서 nextChapter/entryChapter 가 null 이 아닙니다");
  }
}

// (f) 순서 밖 완료 — 뒤 회차를 먼저 끝내도 currentSeq 는 앞의 미완료
{
  const m = addUnit(read(), 50);
  const p = computeUnitProgress(YEBOM91, m, new Set());
  console.log(`  (f) 50회차만    완료 ${p.doneCount} · 지금 ${p.currentSeq}회차 (기대 1)`);
  if (p.currentSeq !== 1) fail("(f) 순서 밖 완료가 currentSeq 를 밀었습니다");
}

// ───────────────────────── 8. 절 단위 읽기 순서 ─────────────────────────
// 진도표는 한 장을 두 토막으로 나눠 **다른 순서로** 읽히기도 한다.
// 장 이동은 장 단위(unitChapters)로 하되, 진입 절과 낭독은 절 단위(unitSegments)를 따른다.
h("8. 절 단위 읽기 순서");

{
  const segs10 = chapterSegments(YEBOM91.units[9], "num", 9);
  console.log(`  10회차 민수기 9장  ${segs10.map((x) => `${x.fromVs}-${x.toVs}`).join(" → ")}`);
  if (
    segs10.length !== 2 ||
    segs10[0].fromVs !== 15 || segs10[0].toVs !== 23 ||
    segs10[1].fromVs !== 1 || segs10[1].toVs !== 14
  ) {
    fail("10회차 민수기 9장이 15-23 → 1-14 순서가 아닙니다");
  }

  const flat = flattenPlan(YEBOM91);
  const i = findPlanIndex(flat, 10, "exo", 40);
  const nx = planStep(flat, i, 1);
  const v = nx ? chapterEntryVerse(YEBOM91.units[nx.seq - 1], nx.book, nx.chapter) : undefined;
  console.log(`  출애굽기 40장 다음  ${nx ? `${NAME[nx.book]} ${nx.chapter}${v ? ":" + v : ""}` : "없음"}`);
  if (!nx || nx.book !== "num" || nx.chapter !== 9 || v !== 15) {
    fail("출애굽기 40장 다음이 민수기 9:15 가 아닙니다");
  }

  if (chapterEntryVerse(YEBOM91.units[38], "2ki", 11) !== undefined) {
    fail("장 전체를 읽는 39회차 왕하 11장에 진입 절이 붙었습니다");
  }
  const k15 = chapterSegments(YEBOM91.units[38], "2ki", 15);
  const k12 = chapterSegments(YEBOM91.units[38], "2ki", 12);
  if (k15.length !== 1 || k15[0].toVs !== 22) fail("39회차 왕하 15장 끝 절이 22 가 아닙니다");
  if (k12.length !== 1 || k12[0].toVs !== undefined) {
    fail("구간 끝 절이 중간 장(왕하 12장)에도 붙었습니다");
  }
  console.log(`  39회차 왕하 15장    끝 절 ${k15[0]?.toVs} · 중간 장 12장 끝 절 ${k12[0]?.toVs ?? "없음"}`);
}

// 절 단위로 펼쳐도 장 목록을 잃으면 안 된다 — 낭독이 통째로 빠지는 장이 생긴다
{
  let bad = 0;
  for (const u of YEBOM91.units) {
    const chs = new Set(unitChapters(u).map((c) => `${c.book}:${c.chapter}`));
    const segs = new Set(unitSegments(u).map((c) => `${c.book}:${c.chapter}`));
    if (chs.size !== segs.size || ![...chs].every((k) => segs.has(k))) {
      fail(`${u.seq}회차 — 절 단위 펼침이 장 목록과 다릅니다`);
      bad++;
    }
  }
  console.log(`  장 목록 일치        ${91 - bad} / 91 회차`);
}

// 같은 장을 두 토막으로 읽는 회차에서 절이 새지 않는가
{
  let holes = 0;
  let split = 0;
  for (const u of YEBOM91.units) {
    const byCh = new Map<string, { fromVs?: number; toVs?: number }[]>();
    for (const sg of unitSegments(u)) {
      const k = `${sg.book}:${sg.chapter}`;
      byCh.set(k, [...(byCh.get(k) ?? []), sg]);
    }
    for (const [k, list] of byCh) {
      if (list.length < 2) continue;
      split++;
      const sorted = [...list].sort((a, b) => (a.fromVs ?? 1) - (b.fromVs ?? 1));
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = sorted[i - 1].toVs;
        const curStart = sorted[i].fromVs ?? 1;
        if (prevEnd !== undefined && curStart > prevEnd + 1) {
          fail(`${u.seq}회차 ${k} — ${prevEnd}절 다음이 ${curStart}절 (틈)`);
          holes++;
        }
      }
    }
  }
  console.log(`  한 장을 두 토막으로 읽는 자리 ${split}곳 · 절이 새는 곳 ${holes}곳`);
}

// ───────────────────────── 결과 ─────────────────────────
h(failures === 0 ? "검증 통과 — 실패 0건" : `검증 실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
