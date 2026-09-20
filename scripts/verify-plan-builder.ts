/**
 * 진도표 만들기 로직 점검 — `npm run verify:planbuilder`
 *
 * 화면과 서버가 같은 함수를 쓰므로(`lib/plans/builder.ts`) 여기서 한 번 조이면 양쪽이 같이 맞는다.
 * 외부 호출이 없다 — DB 도 AI 도 부르지 않는다.
 */
import { CHAPTER_COUNTS } from "../lib/books";
import {
  MAX_UNITS,
  MAX_UNIT_LABEL,
  autoUnits,
  chaptersOf,
  compressRanges,
  expandChapters,
  formatRanges,
  labelOf,
  mergeWithNext,
  parsePlanLine,
  planStats,
  renumber,
  sanitizeUnits,
  scopeBooks,
  splitUnit,
  sumVerses,
  unitsForVersesPerDay,
  validateUnits,
} from "../lib/plans/builder";
import { YEBOM91 } from "../lib/plans/yebom91";
import { computeUnitProgress, unitChapters } from "../lib/plans/engine";
import { verseCount } from "../lib/plans/verseCounts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "실패"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function main() {
  console.log("── 1. 범위 고르기 ──");
  const all = scopeBooks("all");
  const nt = scopeBooks("new");
  const ot = scopeBooks("old");
  check("성경 전체 66권", all.length === 66, `${all.length}권`);
  check("구약 39권 · 신약 27권", ot.length === 39 && nt.length === 27);
  check("책 고르기는 성경 순서로", scopeBooks("custom", ["rev", "gen", "mat"]).join(",") === "gen,mat,rev");
  const ntChapters = chaptersOf(nt);
  check("신약 260장", ntChapters.length === 260, `${ntChapters.length}장`);
  // 새번역(rnksv) 기준 실측값이다 — 역본마다 절 분할이 달라 KJV 등과 숫자가 다르다.
  check("신약 절 수 7,942(새번역)", sumVerses(ntChapters) === 7942, `${sumVerses(ntChapters)}절`);

  console.log("\n── 2. 자동 분배 ──");
  for (const [books, count] of [
    [nt, 30],
    [nt, 90],
    [all, 365],
    [scopeBooks("custom", ["psa"]), 30],
  ] as const) {
    const units = autoUnits([...books], count);
    const stats = planStats(units);
    const chapters = chaptersOf([...books]);
    check(`${books.length}권 → ${count}회차가 정확히 나온다`, units.length === count, `${units.length}회차`);
    check(
      `${count}회차가 장을 하나도 빠뜨리지 않는다`,
      stats.chapterCount === chapters.length,
      `${stats.chapterCount}/${chapters.length}장`,
    );
    // 분량 고르기 — 가장 긴 회차가 평균의 3배를 넘지 않는다(한 장이 통째로 큰 경우는 어쩔 수 없다)
    const avg = stats.verseCount / units.length;
    check(
      `${count}회차 분량이 고르다`,
      stats.maxVerses <= Math.max(avg * 3, 180),
      `평균 ${avg.toFixed(0)}절 · 최대 ${stats.maxVerses}절 · 최소 ${stats.minVerses}절`,
    );
    check(`${count}회차에 빈 회차가 없다`, units.every((u) => u.ranges.length > 0));
    const seqs = units.map((u) => u.seq);
    check(`${count}회차 번호가 1..n`, seqs[0] === 1 && seqs[seqs.length - 1] === units.length);
  }

  const daily = unitsForVersesPerDay(nt, 100);
  check("하루 100절쯤 → 80회차 안팎", Math.abs(daily.length - 80) <= 2, `${daily.length}회차`);

  const tooMany = autoUnits(scopeBooks("custom", ["jud"]), 50); // 유다서는 1장뿐
  check("장보다 회차가 많으면 장 수만큼만", tooMany.length === 1, `${tooMany.length}회차`);
  check("회차 상한", autoUnits(all, 9999).length <= MAX_UNITS, `${autoUnits(all, 9999).length}회차`);

  console.log("\n── 3. 줄 읽기 ──");
  const okCases: [string, string][] = [
    ["창세기 1-3", "gen 1-3"],
    ["창 1-3", "gen 1-3"],
    ["창1-3", "gen 1-3"],
    ["히브리서", "heb 1-13"],
    ["마태복음 5:1-20", "mat 5-5"],
    ["요한복음 3장", "jhn 3-3"],
    ["창 50, 출 1-2", "gen 50-50|exo 1-2"],
    ["시편 119", "psa 119-119"],
    ["사무엘상 1-3", "1sa 1-3"],
  ];
  for (const [line, expect] of okCases) {
    const r = parsePlanLine(line);
    const got = r.ranges.map((x) => `${x.book} ${x.fromCh}-${x.toCh}`).join("|");
    check(`"${line}"`, !r.error && got === expect, r.error ?? got);
  }
  const badCases = ["창세기 60", "없는책 1", "창 5-2", "그냥 글"];
  for (const line of badCases) {
    const r = parsePlanLine(line);
    check(`"${line}" 은 오류로 잡는다`, !!r.error, r.error ?? "통과해 버림");
  }
  check("빈 줄은 오류가 아니다", parsePlanLine("  ").error === null);

  console.log("\n── 4. 글로 옮기고 다시 읽기(왕복) ──");
  let roundTripFails = 0;
  for (const unit of YEBOM91.units) {
    const text = formatRanges(unit.ranges);
    const back = parsePlanLine(text);
    const same =
      !back.error &&
      back.ranges.length === unit.ranges.length &&
      back.ranges.every(
        (r, i) => r.book === unit.ranges[i].book && r.fromCh === unit.ranges[i].fromCh && r.toCh === unit.ranges[i].toCh,
      );
    if (!same) {
      roundTripFails++;
      if (roundTripFails <= 3) console.log(`      ${unit.seq}회차: "${text}" → ${back.error ?? "다름"}`);
    }
  }
  check("표준진도표 91회차를 글로 옮겼다가 그대로 읽는다", roundTripFails === 0, `${roundTripFails}건 어긋남`);

  console.log("\n── 5. 회차 손질 ──");
  const base = autoUnits(scopeBooks("custom", ["jhn"]), 5);
  const split = splitUnit(base, 0);
  check("나누면 한 회차가 는다", split.length === base.length + 1);
  check(
    "나눠도 장은 그대로",
    planStats(split).chapterCount === planStats(base).chapterCount,
  );
  const merged = mergeWithNext(split, 0);
  check("합치면 되돌아온다", merged.length === base.length);
  check("합쳐도 장은 그대로", planStats(merged).chapterCount === planStats(base).chapterCount);
  check("마지막 회차는 합칠 것이 없다", mergeWithNext(base, base.length - 1).length === base.length);
  check("번호를 다시 매긴다", renumber(base.slice(1)).map((u) => u.seq).join(",") === "1,2,3,4");
  check("압축은 이어진 장을 묶는다", compressRanges(expandChapters(base[0].ranges)).length <= base[0].ranges.length);

  console.log("\n── 6. 검사 ──");
  const good = validateUnits(autoUnits(nt, 30), nt);
  check("바른 진도표는 오류 0", good.errors.length === 0, good.errors[0] ?? "");
  check("바른 진도표는 경고 0", good.warnings.length === 0, good.warnings[0] ?? "");
  check("빈 회차는 오류", validateUnits([{ seq: 1, label: "빈", ranges: [] }]).errors.length > 0);
  check(
    "장 수를 넘는 범위는 오류",
    validateUnits([{ seq: 1, label: "x", ranges: [{ book: "gen", fromCh: 1, toCh: 99 }] }]).errors.length > 0,
  );
  check(
    "모르는 책은 오류",
    validateUnits([{ seq: 1, label: "x", ranges: [{ book: "zzz", fromCh: 1, toCh: 1 }] }]).errors.length > 0,
  );
  const dup = validateUnits([
    { seq: 1, label: "a", ranges: [{ book: "gen", fromCh: 1, toCh: 2 }] },
    { seq: 2, label: "b", ranges: [{ book: "gen", fromCh: 2, toCh: 3 }] },
  ]);
  check("겹치는 장은 경고(오류가 아니다)", dup.errors.length === 0 && dup.warnings.length > 0, dup.warnings[0]);
  const missing = validateUnits([{ seq: 1, label: "a", ranges: [{ book: "jhn", fromCh: 1, toCh: 3 }] }], ["jhn"]);
  check("빠진 장은 경고", missing.warnings.some((w) => w.includes("빠졌")), missing.warnings[0] ?? "");

  // 표준진도표 자체는 중복·누락이 있다 — 경고는 나오되 **오류는 없어야** 한다
  const yebom = validateUnits(YEBOM91.units);
  check("표준진도표는 오류 0(경고는 있다)", yebom.errors.length === 0, yebom.errors[0] ?? "");
  check("표준진도표 경고에 겹치는 장", yebom.warnings.length > 0, yebom.warnings[0] ?? "");

  console.log("\n── 7. 믿을 수 없는 값 거르기(DB · AI) ──");
  const hostile = sanitizeUnits([
    { label: "좋음", ranges: [{ book: "gen", fromCh: 1, toCh: 3 }] },
    { label: "없는 책", ranges: [{ book: "hack", fromCh: 1, toCh: 1 }] },
    { label: "범위 넘음", ranges: [{ book: "jud", fromCh: 1, toCh: 500 }] },
    { label: "거꾸로", ranges: [{ book: "gen", fromCh: 9, toCh: 2 }] },
    "문자열",
    null,
    { label: "x".repeat(200), ranges: [{ book: "psa", fromCh: 1, toCh: 1 }] },
  ]);
  check("없는 책 줄은 버린다", hostile.every((u) => u.ranges.every((r) => !!CHAPTER_COUNTS[r.book])));
  check("장 수를 넘으면 잘라 맞춘다", hostile.some((u) => u.ranges.some((r) => r.book === "jud" && r.toCh === 1)));
  check("거꾸로 된 범위는 바로잡는다", hostile.every((u) => u.ranges.every((r) => r.toCh >= r.fromCh)));
  check("이름 길이를 자른다", hostile.every((u) => u.label.length <= MAX_UNIT_LABEL));
  check("번호를 1부터 다시 매긴다", hostile.map((u) => u.seq).join(",") === hostile.map((_, i) => i + 1).join(","));
  check("빈 값은 빈 배열", sanitizeUnits(null).length === 0 && sanitizeUnits("x").length === 0);

  console.log("\n── 8. 엔진과 함께 (만든 진도표로 진도 계산) ──");
  const made = autoUnits(scopeBooks("custom", ["jud", "phm", "2jn"]), 3);
  const readAll: Record<string, Set<number>> = { jud: new Set([1]), phm: new Set([1]) };
  const progress = computeUnitProgress({ id: "p1", name: "시험", units: made }, readAll, new Set());
  check("만든 진도표도 엔진이 읽는다", progress.units.length === made.length);
  check("읽은 회차가 완료로", progress.doneCount >= 1, `완료 ${progress.doneCount}`);
  check(
    "회차의 장 목록이 비지 않는다",
    made.every((u) => unitChapters(u).length > 0),
  );
  check("절 수 표가 엔진과 맞물린다", verseCount("psa", 119) === 176, `시편 119 = ${verseCount("psa", 119)}절`);
  check("이름 자동 생성", labelOf([{ book: "gen", fromCh: 1, toCh: 3 }]) === "창세기 1-3");
  check("책 전체는 책 이름만", labelOf([{ book: "heb", fromCh: 1, toCh: 13 }]) === "히브리서");

  console.log(`\n${failures === 0 ? "모두 통과" : `실패 ${failures}건`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
