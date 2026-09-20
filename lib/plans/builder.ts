/**
 * 말씀의삶 — 진도표 만들기 (순수 로직)
 *
 * 화면(만들기 창)과 서버(AI 초안 검사)가 **같은 함수**를 쓴다. 한쪽에만 규칙이 있으면
 * 화면에서 통과한 것이 서버에서 막히거나 그 반대가 된다.
 *
 * 정한 것(지휘부 2026-09-20)
 *  - 분량은 **절 수 기준**으로 고르게 나눈다. 장 수로 나누면 시편 119(176절)와 117(2절)이 같은 무게가 된다.
 *  - **장은 쪼개지 않는다.** 읽음 판정이 장 단위라, 절로 쪼갠 회차는 끝내도 완료가 안 될 수 있다
 *    (docs/READING_PLAN.md §2). 손으로 적을 때만 절 표기를 허용하고 그것은 **표시용**이다.
 *  - 자동은 초안만 만든다 — 그 자리에서 사람이 고친다.
 */
import { BOOKS, CHAPTER_COUNTS, getBookByCode } from "../books";
import { resolveBookCode } from "../parseReference";
import { verseCount } from "./verseCounts";
import type { PlanRange, PlanUnit, ReadingPlan } from "./engine";

// ───────────────────────── 상한 ─────────────────────────
// 실수로 쌓이는 것을 막는 선이다. 91회차(표준진도표)가 한참 아래에 들어온다.

export const MAX_UNITS = 400;
export const MIN_UNITS = 1;
export const MAX_RANGES_PER_UNIT = 20;
export const MAX_PLAN_NAME = 30;
export const MAX_PLAN_DESC = 200;
/**
 * 회차 이름 길이. 표준진도표의 50회차가 50자라(“열왕기하 23:34-25, 예레미야 40·52, 예레미야애가”)
 * 40자로 두면 **교회 진도표 자체가 검사에 걸린다** — 2026-09-20 검증에서 드러나 60자로 잡았다.
 */
export const MAX_UNIT_LABEL = 60;
/** 한 사람이 가질 수 있는 진도표 수(지휘부 2026-09-19) */
export const MAX_PLANS_PER_USER = 20;

// ───────────────────────── 범위 고르기 ─────────────────────────

export type ScopeKind = "all" | "old" | "new" | "custom";

export const SCOPES: { key: ScopeKind; label: string }[] = [
  { key: "all", label: "성경 전체" },
  { key: "old", label: "구약" },
  { key: "new", label: "신약" },
  { key: "custom", label: "책 고르기" },
];

export function scopeBooks(scope: ScopeKind, custom: string[] = []): string[] {
  if (scope === "custom") {
    // 고른 순서가 아니라 **성경 순서**로 읽는다.
    const want = new Set(custom);
    return BOOKS.filter((b) => want.has(b.code)).map((b) => b.code);
  }
  return BOOKS.filter(
    (b) => scope === "all" || (scope === "old" ? b.testament === "old" : b.testament === "new"),
  ).map((b) => b.code);
}

export interface ChapterWeight {
  book: string;
  chapter: number;
  /** 그 장의 절 수 — 분배의 무게 */
  verses: number;
}

/** 고른 책들의 장을 성경 순서로 펼친다. */
export function chaptersOf(books: string[]): ChapterWeight[] {
  const out: ChapterWeight[] = [];
  for (const code of books) {
    const n = CHAPTER_COUNTS[code] ?? 0;
    for (let ch = 1; ch <= n; ch++) out.push({ book: code, chapter: ch, verses: verseCount(code, ch) });
  }
  return out;
}

export function sumVerses(chapters: ChapterWeight[]): number {
  return chapters.reduce((s, c) => s + c.verses, 0);
}

// ───────────────────────── 자동 분배 ─────────────────────────

/**
 * 절 수가 고르게 되도록 장 경계에서 자른다. **정확히 `unitCount` 회차**가 나온다.
 *
 * 욕심껏 채우는 방식(목표를 넘으면 자르기)은 마지막 회차에 남는 것이 몰린다.
 * 그래서 회차마다 **이상적인 누적 절 수**(전체 × i / 회차수)를 정하고, 그 지점에 가장 가까운
 * 장 경계를 고른다. 각 회차에 장이 최소 하나는 가도록 고를 수 있는 구간을 좁힌다.
 */
export function autoUnits(books: string[], unitCount: number): PlanUnit[] {
  const chapters = chaptersOf(books);
  const count = Math.max(MIN_UNITS, Math.min(MAX_UNITS, Math.floor(unitCount) || 1));
  if (chapters.length === 0) return [];
  // 장보다 회차가 많을 수는 없다 — 한 회차에 적어도 한 장은 있어야 한다.
  const units = Math.min(count, chapters.length);

  const cum: number[] = [];
  let run = 0;
  for (const c of chapters) {
    run += c.verses;
    cum.push(run);
  }
  const total = run;

  const cuts: number[] = []; // 각 회차의 마지막 장 인덱스(0-based)
  let prev = -1;
  for (let i = 1; i <= units; i++) {
    if (i === units) {
      cuts.push(chapters.length - 1);
      break;
    }
    const ideal = (total * i) / units;
    const lo = prev + 1; // 이 회차에 최소 한 장
    const hi = chapters.length - (units - i) - 1; // 남은 회차마다 최소 한 장
    let best = lo;
    let bestDiff = Infinity;
    for (let j = lo; j <= hi; j++) {
      const diff = Math.abs(cum[j] - ideal);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = j;
      } else if (cum[j] > ideal) {
        // 누적은 단조 증가라, 목표를 넘어서면서 차이가 커지기 시작하면 더 볼 것이 없다.
        break;
      }
    }
    cuts.push(best);
    prev = best;
  }

  const out: PlanUnit[] = [];
  let start = 0;
  cuts.forEach((end, i) => {
    const slice = chapters.slice(start, end + 1);
    const ranges = compressRanges(slice);
    out.push({ seq: i + 1, label: labelOf(ranges), ranges });
    start = end + 1;
  });
  return out;
}

/** "하루 몇 절쯤" 으로 회차 수를 정한다. */
export function unitsForVersesPerDay(books: string[], versesPerUnit: number): PlanUnit[] {
  const total = sumVerses(chaptersOf(books));
  const per = Math.max(1, Math.floor(versesPerUnit) || 1);
  return autoUnits(books, Math.max(1, Math.round(total / per)));
}

/** 이어지는 장을 한 범위로 묶는다. 책이 바뀌면 새 범위. */
export function compressRanges(chapters: ChapterWeight[] | { book: string; chapter: number }[]): PlanRange[] {
  const out: PlanRange[] = [];
  for (const c of chapters) {
    const last = out[out.length - 1];
    if (last && last.book === c.book && last.toCh === c.chapter - 1) last.toCh = c.chapter;
    else out.push({ book: c.book, fromCh: c.chapter, toCh: c.chapter });
  }
  return out;
}

// ───────────────────────── 이름 붙이기 · 글로 옮기기 ─────────────────────────

function bookName(code: string): string {
  return getBookByCode(code)?.nameKr ?? code;
}

/**
 * 범위 한 개를 글로. **다시 읽을 수 있는 꼴이어야 한다**(`parsePlanLine` 왕복).
 *
 * 절이 붙은 범위는 `열왕기하 15:23-17:41` 처럼 **양 끝을 장:절로** 적는다.
 * 예전에는 `열왕기하 15-17:23-끝` 처럼 적었는데 되읽지 못했다(2026-09-20 검증에서 드러남).
 * 끝 절을 모르면 그 장의 마지막 절 번호를 적는다 — '끝' 이라는 글자는 기계가 읽지 못한다.
 */
function rangeText(r: PlanRange, withName = true): string {
  const name = withName ? bookName(r.book) : "";
  const whole = r.fromCh === 1 && r.toCh === (CHAPTER_COUNTS[r.book] ?? 0);
  if (r.fromVs || r.toVs) {
    const from = `${r.fromCh}:${r.fromVs ?? 1}`;
    const to = `${r.toCh}:${r.toVs ?? verseCount(r.book, r.toCh)}`;
    return `${name} ${from}-${to}`.trim();
  }
  if (whole) return name;
  const chs = r.fromCh === r.toCh ? `${r.fromCh}` : `${r.fromCh}-${r.toCh}`;
  return `${name} ${chs}`.trim();
}

/** 회차 이름 자동 — "창세기 1-3" · "창세기 50 · 출애굽기 1-2" · "히브리서" */
export function labelOf(ranges: PlanRange[]): string {
  return ranges.map((r) => rangeText(r)).join(" · ").slice(0, MAX_UNIT_LABEL);
}

/** 편집 칸에 보여 줄 글. `parsePlanLine` 이 다시 읽을 수 있는 꼴이어야 한다. */
export function formatRanges(ranges: PlanRange[]): string {
  return ranges.map((r) => rangeText(r)).join(", ");
}

// ───────────────────────── 손으로 적은 줄 읽기 ─────────────────────────

export interface ParsedLine {
  ranges: PlanRange[];
  error: string | null;
}

/**
 * 한 회차를 적은 줄을 읽는다. 쉼표·가운뎃점으로 여러 범위를 적을 수 있다.
 *
 *   창세기 1-3 · 창 1-3 · 창1-3      → 창세기 1~3장
 *   히브리서                          → 책 전체
 *   마태복음 5:1-20                   → 5장(절은 표시용)
 *   창 50, 출 1-2                     → 두 범위
 */
export function parsePlanLine(line: string): ParsedLine {
  const text = (line || "").trim();
  if (!text) return { ranges: [], error: null };
  const parts = text.split(/[,·]/).map((p) => p.trim()).filter(Boolean);
  const ranges: PlanRange[] = [];

  for (const part of parts) {
    // 책 이름(한글·숫자 접두) 과 나머지(장·절)를 가른다
    const m = /^([0-9]?\s*[가-힣]+)\s*(.*)$/.exec(part);
    if (!m) return { ranges: [], error: `읽지 못했습니다: ${part}` };
    const book = resolveBookCode(m[1].replace(/\s+/g, ""));
    if (!book) return { ranges: [], error: `책 이름을 알 수 없습니다: ${m[1].trim()}` };
    const total = CHAPTER_COUNTS[book] ?? 0;
    const tail = m[2].replace(/\s+/g, "").replace(/장$/, "");

    if (!tail) {
      ranges.push({ book, fromCh: 1, toCh: total });
      continue;
    }

    // 5:1-20 · 5:1-6:3 · 5:1 (절은 표시용)
    const verse = /^(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/.exec(tail);
    if (verse) {
      const fromCh = Number(verse[1]);
      const toCh = verse[3] ? Number(verse[3]) : fromCh;
      const fromVs = Number(verse[2]);
      const toVs = verse[4] ? Number(verse[4]) : undefined;
      if (fromCh < 1 || toCh > total || toCh < fromCh) {
        return { ranges: [], error: `${bookName(book)} 는 ${total}장까지입니다` };
      }
      ranges.push({ book, fromCh, toCh, fromVs, toVs });
      continue;
    }

    // 1-3 · 1~3 · 1
    const chapter = /^(\d+)(?:[-~](\d+))?$/.exec(tail);
    if (!chapter) return { ranges: [], error: `장을 읽지 못했습니다: ${part}` };
    const fromCh = Number(chapter[1]);
    const toCh = chapter[2] ? Number(chapter[2]) : fromCh;
    if (fromCh < 1 || toCh < fromCh) return { ranges: [], error: `장 번호가 거꾸로입니다: ${part}` };
    if (toCh > total) return { ranges: [], error: `${bookName(book)} 는 ${total}장까지입니다` };
    ranges.push({ book, fromCh, toCh });
  }

  if (ranges.length > MAX_RANGES_PER_UNIT) {
    return { ranges: [], error: `한 회차에 범위는 ${MAX_RANGES_PER_UNIT}개까지입니다` };
  }
  return { ranges, error: null };
}

// ───────────────────────── 회차 손질 ─────────────────────────

/** seq 를 1부터 다시 매긴다. 회차를 더하거나 뺀 뒤에는 반드시 부른다. */
export function renumber(units: PlanUnit[]): PlanUnit[] {
  return units.map((u, i) => ({ ...u, seq: i + 1 }));
}

/** 한 회차를 장 기준 절반으로 나눈다. 장이 하나뿐이면 그대로 둔다. */
export function splitUnit(units: PlanUnit[], index: number): PlanUnit[] {
  const unit = units[index];
  if (!unit) return units;
  const chapters = expandChapters(unit.ranges);
  if (chapters.length < 2) return units;
  const half = Math.ceil(chapters.length / 2);
  const a = compressRanges(chapters.slice(0, half));
  const b = compressRanges(chapters.slice(half));
  const next = [...units];
  next.splice(index, 1, { seq: 0, label: labelOf(a), ranges: a }, { seq: 0, label: labelOf(b), ranges: b });
  return renumber(next);
}

/** 다음 회차와 합친다. 마지막 회차면 그대로 둔다. */
export function mergeWithNext(units: PlanUnit[], index: number): PlanUnit[] {
  if (index < 0 || index >= units.length - 1) return units;
  const ranges = compressRanges([
    ...expandChapters(units[index].ranges),
    ...expandChapters(units[index + 1].ranges),
  ]);
  const next = [...units];
  next.splice(index, 2, { seq: 0, label: labelOf(ranges), ranges });
  return renumber(next);
}

/** 범위를 장 목록으로 편다(절 표기는 버린다 — 손질은 장 단위다). */
export function expandChapters(ranges: PlanRange[]): { book: string; chapter: number }[] {
  const out: { book: string; chapter: number }[] = [];
  const seen = new Set<string>();
  for (const r of ranges) {
    for (let c = r.fromCh; c <= r.toCh; c++) {
      const k = `${r.book}:${c}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ book: r.book, chapter: c });
    }
  }
  return out;
}

// ───────────────────────── 검사 ─────────────────────────

export interface PlanStats {
  unitCount: number;
  /** 서로 다른 장 수(중복 제외) */
  chapterCount: number;
  verseCount: number;
  /** 회차 분량(절) — 가장 적은 회차와 가장 많은 회차 */
  minVerses: number;
  maxVerses: number;
}

export function planStats(units: PlanUnit[]): PlanStats {
  const seen = new Set<string>();
  let verses = 0;
  let min = Infinity;
  let max = 0;
  for (const u of units) {
    let unitVerses = 0;
    for (const c of expandChapters(u.ranges)) {
      const v = verseCount(c.book, c.chapter);
      unitVerses += v;
      const k = `${c.book}:${c.chapter}`;
      if (!seen.has(k)) {
        seen.add(k);
        verses += v;
      }
    }
    if (units.length > 0) {
      min = Math.min(min, unitVerses);
      max = Math.max(max, unitVerses);
    }
  }
  return {
    unitCount: units.length,
    chapterCount: seen.size,
    verseCount: verses,
    minVerses: min === Infinity ? 0 : min,
    maxVerses: max,
  };
}

export interface PlanIssues {
  /** 고치지 않으면 저장할 수 없다 */
  errors: string[];
  /** 저장은 되지만 알려 준다 — 표준진도표에도 중복·누락이 있다 */
  warnings: string[];
}

export function validateUnits(units: PlanUnit[], scopeBookCodes: string[] = []): PlanIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (units.length === 0) errors.push("회차가 하나도 없습니다");
  if (units.length > MAX_UNITS) errors.push(`회차는 ${MAX_UNITS}개까지입니다 (지금 ${units.length}개)`);

  const owners = new Map<string, number[]>();
  units.forEach((u, i) => {
    const no = i + 1;
    if (!u.ranges || u.ranges.length === 0) {
      errors.push(`${no}회차가 비어 있습니다`);
      return;
    }
    if (u.ranges.length > MAX_RANGES_PER_UNIT) {
      errors.push(`${no}회차의 범위가 너무 많습니다 (${MAX_RANGES_PER_UNIT}개까지)`);
    }
    if ((u.label ?? "").length > MAX_UNIT_LABEL) {
      errors.push(`${no}회차 이름이 깁니다 (${MAX_UNIT_LABEL}자까지)`);
    }
    for (const r of u.ranges) {
      const total = CHAPTER_COUNTS[r.book];
      if (!total) {
        errors.push(`${no}회차에 모르는 책이 있습니다: ${r.book}`);
        continue;
      }
      if (r.fromCh < 1 || r.toCh < r.fromCh) {
        errors.push(`${no}회차의 장 번호가 거꾸로입니다: ${rangeText(r)}`);
        continue;
      }
      if (r.toCh > total) {
        errors.push(`${no}회차 — ${bookName(r.book)} 는 ${total}장까지입니다`);
        continue;
      }
      for (let c = r.fromCh; c <= r.toCh; c++) {
        const k = `${r.book}:${c}`;
        const arr = owners.get(k) ?? [];
        if (!arr.includes(no)) arr.push(no);
        owners.set(k, arr);
      }
    }
  });

  const dup = [...owners.entries()].filter(([, seqs]) => seqs.length > 1);
  if (dup.length > 0) {
    warnings.push(
      `${dup.length}개 장이 여러 회차에 들어 있습니다 (${dup
        .slice(0, 3)
        .map(([k, seqs]) => `${bookName(k.split(":")[0])} ${k.split(":")[1]}장 → ${seqs.join("·")}회차`)
        .join(", ")}${dup.length > 3 ? " …" : ""})`,
    );
  }

  if (scopeBookCodes.length > 0) {
    const missing = chaptersOf(scopeBookCodes).filter((c) => !owners.has(`${c.book}:${c.chapter}`));
    if (missing.length > 0) {
      warnings.push(
        `고른 범위에서 ${missing.length}개 장이 빠졌습니다 (${missing
          .slice(0, 3)
          .map((c) => `${bookName(c.book)} ${c.chapter}장`)
          .join(", ")}${missing.length > 3 ? " …" : ""})`,
      );
    }
  }

  const stats = planStats(units);
  if (stats.unitCount > 0 && stats.minVerses > 0 && stats.maxVerses > stats.minVerses * 4) {
    warnings.push(
      `회차마다 분량 차이가 큽니다 (가장 적은 회차 ${stats.minVerses}절 · 가장 많은 회차 ${stats.maxVerses}절)`,
    );
  }

  return { errors, warnings };
}

/** 저장된 units(jsonb)를 엔진이 읽는 꼴로. 믿을 수 없는 값(DB·AI)을 받을 때 쓴다. */
export function sanitizeUnits(raw: unknown): PlanUnit[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanUnit[] = [];
  for (const item of raw.slice(0, MAX_UNITS)) {
    const u = item as Partial<PlanUnit>;
    if (!u || !Array.isArray(u.ranges)) continue;
    const ranges: PlanRange[] = [];
    for (const r0 of u.ranges.slice(0, MAX_RANGES_PER_UNIT)) {
      const r = r0 as Partial<PlanRange>;
      const book = typeof r.book === "string" ? r.book : "";
      const total = CHAPTER_COUNTS[book];
      if (!total) continue;
      const fromCh = Math.max(1, Math.min(total, Math.floor(Number(r.fromCh) || 0)));
      const toCh = Math.max(fromCh, Math.min(total, Math.floor(Number(r.toCh) || fromCh)));
      if (!fromCh) continue;
      const range: PlanRange = { book, fromCh, toCh };
      if (Number(r.fromVs) > 0) range.fromVs = Math.floor(Number(r.fromVs));
      if (Number(r.toVs) > 0) range.toVs = Math.floor(Number(r.toVs));
      ranges.push(range);
    }
    if (ranges.length === 0) continue;
    const label = String(u.label ?? "").slice(0, MAX_UNIT_LABEL) || labelOf(ranges);
    out.push({ seq: out.length + 1, label, ranges });
  }
  return out;
}

export function toPlan(id: string, name: string, units: PlanUnit[]): ReadingPlan {
  return { id, name, units };
}
