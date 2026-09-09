/**
 * 말씀의삶 — 예봄교회 성경읽기진도표 91회차 (플랜 층).
 *
 * 이 파일은 **본문 위에 얹는 얇은 순서 정의**다. 성경 본문·역본·TTS·글꼴은 건드리지 않는다.
 * 회차 완료는 저장하지 않고 기존 `reading_progress`(장 단위 자동 기록)에서 **파생 계산**한다.
 *
 * 데이터 원칙 — **종이 진도표 그대로 옮긴다.**
 * 정경 순으로 고치거나, 중복을 지우거나, 누락을 채우지 않는다. 이상한 곳은
 * `scripts/verify-plan-yebom91.ts` 가 드러내고 사람이 판단한다.
 *
 * 실측(검증 스크립트): 1,188 / 1,189장 커버 · 범위 오류 0건 · 경계 장 10개.
 * 미수록 1장은 시편 18 인데, 삼하 22(31회차)와 병행이라 내용은 읽힌다.
 */

import { CHAPTER_COUNTS } from "../books";

// ───────────────────────── 타입 ─────────────────────────

export interface PlanRange {
  /** lib/books.ts 의 code */
  book: string;
  fromCh: number;
  toCh: number;
  /** 절 경계 표기용. **판정에는 쓰지 않는다** (판정은 장 단위) */
  fromVs?: number;
  toVs?: number;
}

export interface PlanUnit {
  seq: number;
  /** 종이 진도표 문구 그대로 */
  label: string;
  ranges: PlanRange[];
}

export interface ReadingPlan {
  id: "yebom91";
  name: string;
  units: PlanUnit[];
}

export interface PlanChapterRef {
  book: string;
  chapter: number;
}

export interface PlanChapter extends PlanChapterRef {
  seq: number;
  /** flattenPlan 배열에서의 위치 */
  idx: number;
}

export type UnitStatus = "done" | "partial" | "todo";

export interface UnitProgress {
  seq: number;
  status: UnitStatus;
  readCount: number;
  total: number;
  manual: boolean;
}

export interface PlanProgress {
  units: UnitProgress[];
  /** 완료 회차 수 */
  doneCount: number;
  /** 가장 낮은 미완료 seq. 전부 완료면 91 */
  currentSeq: number;
  /** currentSeq 안에서 안 읽은 첫 장. 표시("다음 읽을 장")에 쓴다 */
  nextChapter: (PlanChapterRef & { seq: number }) | null;
  /** 진입용(행 탭·플랜 모드 진입). 아래 규칙 참조 */
  entryChapter: (PlanChapterRef & { seq: number }) | null;
}

// ───────────────────────── 헬퍼 ─────────────────────────

const ch = (book: string, from: number, to: number = from): PlanRange => ({
  book,
  fromCh: from,
  toCh: to,
});

const whole = (book: string): PlanRange => ch(book, 1, CHAPTER_COUNTS[book]);

/** 경계 장 집합의 키 */
export const chapterKey = (book: string, chapter: number): string => `${book}:${chapter}`;

// ───────────────────────── 파생 유틸 ─────────────────────────

const unitChaptersCache = new WeakMap<PlanUnit, PlanChapterRef[]>();

/**
 * 회차의 장 목록. 같은 회차 안 중복 장(예: 10회차 민수기 9)은 1회만, 등장 순서 유지.
 * 절 범위(fromVs/toVs)는 무시한다 — 판정이 장 단위이기 때문이다.
 */
export function unitChapters(unit: PlanUnit): PlanChapterRef[] {
  const hit = unitChaptersCache.get(unit);
  if (hit) return hit;

  const out: PlanChapterRef[] = [];
  const seen = new Set<string>();
  for (const r of unit.ranges) {
    for (let c = r.fromCh; c <= r.toCh; c++) {
      const k = chapterKey(r.book, c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ book: r.book, chapter: c });
    }
  }
  unitChaptersCache.set(unit, out);
  return out;
}

const flattenCache = new WeakMap<ReadingPlan, PlanChapter[]>();

/**
 * 플랜 전체를 읽기 순서대로 펼친 배열.
 * **경계 장은 회차마다 다시 등장한다**(양쪽 회차에 속하므로). 그래서 길이는 1,199다.
 */
export function flattenPlan(plan: ReadingPlan): PlanChapter[] {
  const hit = flattenCache.get(plan);
  if (hit) return hit;

  const out: PlanChapter[] = [];
  for (const unit of plan.units) {
    for (const c of unitChapters(unit)) {
      out.push({ seq: unit.seq, book: c.book, chapter: c.chapter, idx: out.length });
    }
  }
  flattenCache.set(plan, out);
  return out;
}

/** 현재 위치의 플랜 인덱스. 경계 장은 seq 로 구분한다. 없으면 -1 */
export function findPlanIndex(
  flat: PlanChapter[],
  seq: number,
  book: string,
  chapter: number,
): number {
  return flat.findIndex((c) => c.seq === seq && c.book === book && c.chapter === chapter);
}

const boundaryCache = new WeakMap<ReadingPlan, Set<string>>();

/**
 * 경계 장 — 두 회차 이상에 등장하는 장. 실측 10개.
 * 절 단위로 쪼갠 회차(왕하 15:22 / 15:23)와 완전 중복(마태 26·27)이 섞여 있다.
 */
export function boundaryChapters(plan: ReadingPlan): Set<string> {
  const hit = boundaryCache.get(plan);
  if (hit) return hit;

  const owners = new Map<string, Set<number>>();
  for (const unit of plan.units) {
    for (const c of unitChapters(unit)) {
      const k = chapterKey(c.book, c.chapter);
      const s = owners.get(k) ?? new Set<number>();
      s.add(unit.seq);
      owners.set(k, s);
    }
  }
  const out = new Set<string>();
  for (const [k, seqs] of owners) if (seqs.size > 1) out.add(k);
  boundaryCache.set(plan, out);
  return out;
}

/**
 * 플랜 순서로 한 칸 이동. **도착 항목이 출발 항목과 같은 장이면 한 칸 더 간다(방향 무관).**
 *
 * 53회차 끝(역대상 9)과 54회차 첫 장(역대상 9)이 맞붙어 있어, 그냥 두면 "다음"을 눌러도
 * 본문이 그대로이고 헤더만 바뀐다. 플랜 전체에서 이런 지점은 이 한 곳뿐이지만,
 * 한쪽 방향만 처리하면 반대로 갈 때 같은 장이 두 번 나온다.
 *
 * 범위를 벗어나면 null.
 */
export function planStep(
  flat: PlanChapter[],
  idx: number,
  delta: 1 | -1,
): PlanChapter | null {
  const from = flat[idx];
  if (!from) return null;
  let i = idx + delta;
  if (flat[i] && flat[i].book === from.book && flat[i].chapter === from.chapter) i += delta;
  return flat[i] ?? null;
}

// ───────────────────────── 판정 ─────────────────────────

/**
 * 회차 진행 상황. 순수 함수 — 상태를 기억하지 않는다.
 *
 * @param readByBook lib/reading-progress 의 computeProgress().readByBook 그대로
 * @param manualSeqs reading_unit_checks 에 행이 있는 seq (종이로 읽음)
 */
export function computeUnitProgress(
  plan: ReadingPlan,
  readByBook: Record<string, Set<number>>,
  manualSeqs: Set<number>,
): PlanProgress {
  const isRead = (c: PlanChapterRef) => readByBook[c.book]?.has(c.chapter) ?? false;

  const units: UnitProgress[] = plan.units.map((unit) => {
    const chs = unitChapters(unit);
    const readCount = chs.reduce((n, c) => n + (isRead(c) ? 1 : 0), 0);
    const manual = manualSeqs.has(unit.seq);
    const done = manual || readCount === chs.length;
    return {
      seq: unit.seq,
      status: done ? "done" : readCount > 0 ? "partial" : "todo",
      readCount,
      total: chs.length,
      manual,
    };
  });

  const doneCount = units.filter((u) => u.status === "done").length;
  const firstIncomplete = units.find((u) => u.status !== "done");
  const lastSeq = plan.units[plan.units.length - 1]?.seq ?? 91;
  const currentSeq = firstIncomplete ? firstIncomplete.seq : lastSeq;

  // 전부 완료면 currentSeq 가 마지막 회차를 가리키는데 그 회차는 이미 done 이다.
  // 이때 다음 장을 내놓으면 완주 화면에 엉뚱한 장이 뜬다 — 둘 다 null 로 둔다.
  // (수동 완료 회차를 건너뛴다는 규칙이 실제로 작동하는 지점이 여기다)
  if (!firstIncomplete) {
    return { units, doneCount, currentSeq, nextChapter: null, entryChapter: null };
  }

  const unit = plan.units.find((u) => u.seq === currentSeq)!;
  const chs = unitChapters(unit);
  const first = chs.find((c) => !isRead(c)) ?? null;
  const nextChapter = first ? { seq: currentSeq, ...first } : null;

  // entryChapter — 왜 nextChapter 와 나누는가
  //
  // 39회차에서 왕하 15장을 읽으면 3초 트리거가 15장 **전체**를 읽음 처리한다.
  // 40회차(왕하 15:23-17)의 nextChapter 는 15장을 건너뛰고 16장을 가리키므로,
  // 그대로 진입시키면 15:23-끝을 영영 읽지 않고 40회차가 완료된다.
  // 경계 장이 회차 맨 앞에 오는 6개 회차(40·50·54·69·83·84)가 전부 해당한다.
  //
  // 반대로 "경계 장은 읽음이어도 건너뛰지 않는다"를 nextChapter 규칙에 넣으면
  // 순수 함수라 '이미 제시했음'을 기억할 수 없어 **같은 장이 영원히 반환되는 고정점**이 된다
  // (83회차에서 고린도후서를 다 읽는 내내 "다음 읽을 장: 사도행전 19장"이 굳는다).
  // 그래서 진입과 표시를 필드로 나눈다.
  const boundary = boundaryChapters(plan);
  const readInUnit = chs.filter(isRead);
  // 빈 배열의 every 는 true — "읽은 장이 하나도 없는 경우"도 이 조건에 포함된다
  const onlyBoundaryRead = readInUnit.every((c) => boundary.has(chapterKey(c.book, c.chapter)));
  const entry = onlyBoundaryRead ? chs[0] : first;
  const entryChapter = entry ? { seq: currentSeq, ...entry } : null;

  return { units, doneCount, currentSeq, nextChapter, entryChapter };
}

// ───────────────────────── 데이터 (종이 진도표 그대로) ─────────────────────────

export const YEBOM91: ReadingPlan = {
  id: "yebom91",
  name: "말씀의삶 성경읽기진도표",
  units: [
    { seq: 1, label: "욥기 1-13", ranges: [ch("job", 1, 13)] },
    { seq: 2, label: "욥기 14-27", ranges: [ch("job", 14, 27)] },
    { seq: 3, label: "욥기 28-42", ranges: [ch("job", 28, 42)] },
    { seq: 4, label: "창세기 1-13", ranges: [ch("gen", 1, 13)] },
    { seq: 5, label: "창세기 14-27", ranges: [ch("gen", 14, 27)] },
    { seq: 6, label: "창세기 28-40", ranges: [ch("gen", 28, 40)] },
    { seq: 7, label: "창세기 41-50, 출애굽기 1-4", ranges: [ch("gen", 41, 50), ch("exo", 1, 4)] },
    { seq: 8, label: "출애굽기 5-19", ranges: [ch("exo", 5, 19)] },
    { seq: 9, label: "출애굽기 20-31", ranges: [ch("exo", 20, 31)] },
    {
      seq: 10,
      label: "출애굽기 32-40, 민수기 9:15-23, 9:1-14",
      ranges: [
        ch("exo", 32, 40),
        { book: "num", fromCh: 9, fromVs: 15, toCh: 9, toVs: 23 },
        { book: "num", fromCh: 9, fromVs: 1, toCh: 9, toVs: 14 },
      ],
    },
    { seq: 11, label: "민수기 1-8", ranges: [ch("num", 1, 8)] },
    { seq: 12, label: "민수기 10-19", ranges: [ch("num", 10, 19)] },
    { seq: 13, label: "민수기 20-36", ranges: [ch("num", 20, 36)] },
    { seq: 14, label: "레위기 1-10", ranges: [ch("lev", 1, 10)] },
    { seq: 15, label: "레위기 11-27", ranges: [ch("lev", 11, 27)] },
    { seq: 16, label: "신명기 1-13", ranges: [ch("deu", 1, 13)] },
    { seq: 17, label: "신명기 14-27", ranges: [ch("deu", 14, 27)] },
    { seq: 18, label: "신명기 28-34, 여호수아 1-5", ranges: [ch("deu", 28, 34), ch("jos", 1, 5)] },
    { seq: 19, label: "여호수아 6-19", ranges: [ch("jos", 6, 19)] },
    { seq: 20, label: "여호수아 20-24, 사사기 1-5", ranges: [ch("jos", 20, 24), ch("jdg", 1, 5)] },
    { seq: 21, label: "사사기 6-16", ranges: [ch("jdg", 6, 16)] },
    { seq: 22, label: "사사기 17-21, 룻기 1-4", ranges: [ch("jdg", 17, 21), ch("rut", 1, 4)] },
    { seq: 23, label: "사무엘상 1-6", ranges: [ch("1sa", 1, 6)] },
    { seq: 24, label: "사무엘상 7-20", ranges: [ch("1sa", 7, 20)] },
    {
      seq: 25,
      label: "시편 1-2, 4-17, 59",
      ranges: [ch("psa", 1, 2), ch("psa", 4, 17), ch("psa", 59)],
    },
    {
      seq: 26,
      label: "사무엘상 21-24, 시편 52, 54, 56, 57, 63",
      ranges: [
        ch("1sa", 21, 24),
        ch("psa", 52),
        ch("psa", 54),
        ch("psa", 56),
        ch("psa", 57),
        ch("psa", 63),
      ],
    },
    {
      seq: 27,
      label: "사무엘상 25-사무엘하 1, 시편 19-30",
      ranges: [ch("1sa", 25, 31), ch("2sa", 1), ch("psa", 19, 30)],
    },
    { seq: 28, label: "사무엘하 2-7, 시편 31-41", ranges: [ch("2sa", 2, 7), ch("psa", 31, 41)] },
    {
      seq: 29,
      label: "사무엘하 8-12, 시편 60, 51",
      ranges: [ch("2sa", 8, 12), ch("psa", 60), ch("psa", 51)],
    },
    {
      seq: 30,
      label: "시편 42-50, 사무엘하 13-15, 시편 3",
      ranges: [ch("psa", 42, 50), ch("2sa", 13, 15), ch("psa", 3)],
    },
    {
      seq: 31,
      label: "사무엘하 16-24, 시편 53, 55, 58, 61-62",
      ranges: [
        ch("2sa", 16, 24),
        ch("psa", 53),
        ch("psa", 55),
        ch("psa", 58),
        ch("psa", 61, 62),
      ],
    },
    { seq: 32, label: "시편 64-71, 열왕기상 1-6", ranges: [ch("psa", 64, 71), ch("1ki", 1, 6)] },
    { seq: 33, label: "시편 72, 잠언 1-15", ranges: [ch("psa", 72), ch("pro", 1, 15)] },
    { seq: 34, label: "열왕기상 7-11, 아가 1-8", ranges: [ch("1ki", 7, 11), ch("sng", 1, 8)] },
    { seq: 35, label: "잠언 16-31", ranges: [ch("pro", 16, 31)] },
    { seq: 36, label: "전도서 1-12", ranges: [ch("ecc", 1, 12)] },
    { seq: 37, label: "열왕기상 12-22", ranges: [ch("1ki", 12, 22)] },
    { seq: 38, label: "열왕기하 1-10, 오바댜 1", ranges: [ch("2ki", 1, 10), ch("oba", 1)] },
    {
      seq: 39,
      label: "열왕기하 11-15:22, 요엘 1-3, 요나 1-4, 아모스 1-9",
      ranges: [
        { book: "2ki", fromCh: 11, toCh: 15, toVs: 22 },
        ch("jol", 1, 3),
        ch("jon", 1, 4),
        ch("amo", 1, 9),
      ],
    },
    {
      seq: 40,
      label: "열왕기하 15:23-17, 이사야 1-4",
      ranges: [{ book: "2ki", fromCh: 15, fromVs: 23, toCh: 17 }, ch("isa", 1, 4)],
    },
    { seq: 41, label: "호세아 1-14", ranges: [ch("hos", 1, 14)] },
    { seq: 42, label: "이사야 5-24", ranges: [ch("isa", 5, 24)] },
    { seq: 43, label: "이사야 25-35", ranges: [ch("isa", 25, 35)] },
    { seq: 44, label: "미가 1-7, 열왕기하 18-20", ranges: [ch("mic", 1, 7), ch("2ki", 18, 20)] },
    { seq: 45, label: "이사야 36-52", ranges: [ch("isa", 36, 52)] },
    {
      seq: 46,
      label: "이사야 53-66, 마태복음 26-27",
      ranges: [ch("isa", 53, 66), ch("mat", 26, 27)],
    },
    {
      seq: 47,
      label: "열왕기하 21, 나훔 1-3, 열왕기하 22-23:34, 스바냐 1-3",
      ranges: [
        ch("2ki", 21),
        ch("nam", 1, 3),
        { book: "2ki", fromCh: 22, toCh: 23, toVs: 34 },
        ch("zep", 1, 3),
      ],
    },
    { seq: 48, label: "예레미야 1-15", ranges: [ch("jer", 1, 15)] },
    { seq: 49, label: "예레미야 16-34", ranges: [ch("jer", 16, 34)] },
    {
      seq: 50,
      label: "열왕기하 23:35-37, 예레미야 35-40:6, 열왕기하 24, 예레미야 52:1-11",
      ranges: [
        { book: "2ki", fromCh: 23, fromVs: 35, toCh: 23, toVs: 37 },
        { book: "jer", fromCh: 35, toCh: 40, toVs: 6 },
        ch("2ki", 24),
        { book: "jer", fromCh: 52, fromVs: 1, toCh: 52, toVs: 11 },
      ],
    },
    {
      seq: 51,
      label: "열왕기하 25, 예레미야 43-51, 예레미야 40:7-42, 52:12-34",
      ranges: [
        ch("2ki", 25),
        ch("jer", 43, 51),
        { book: "jer", fromCh: 40, fromVs: 7, toCh: 42 },
        { book: "jer", fromCh: 52, fromVs: 12, toCh: 52, toVs: 34 },
      ],
    },
    { seq: 52, label: "예레미야애가 1-5, 하박국 1-3", ranges: [ch("lam", 1, 5), ch("hab", 1, 3)] },
    { seq: 53, label: "역대상 1-9:34", ranges: [{ book: "1ch", fromCh: 1, toCh: 9, toVs: 34 }] },
    { seq: 54, label: "역대상 9:34-14", ranges: [{ book: "1ch", fromCh: 9, fromVs: 34, toCh: 14 }] },
    {
      seq: 55,
      label: "역대상 15-16, 시편 105, 73-83",
      ranges: [ch("1ch", 15, 16), ch("psa", 105), ch("psa", 73, 83)],
    },
    { seq: 56, label: "시편 84-89, 역대상 17-21", ranges: [ch("psa", 84, 89), ch("1ch", 17, 21)] },
    { seq: 57, label: "시편 90-104, 106", ranges: [ch("psa", 90, 104), ch("psa", 106)] },
    {
      seq: 58,
      label: "역대상 22-26, 시편 107-117",
      ranges: [ch("1ch", 22, 26), ch("psa", 107, 117)],
    },
    {
      seq: 59,
      label: "시편 118-134, 역대상 27-29",
      ranges: [ch("psa", 118, 134), ch("1ch", 27, 29)],
    },
    { seq: 60, label: "시편 135-150", ranges: [ch("psa", 135, 150)] },
    { seq: 61, label: "역대하 1-10", ranges: [ch("2ch", 1, 10)] },
    { seq: 62, label: "역대하 11-21", ranges: [ch("2ch", 11, 21)] },
    { seq: 63, label: "역대하 22-36", ranges: [ch("2ch", 22, 36)] },
    { seq: 64, label: "다니엘 1-12", ranges: [ch("dan", 1, 12)] },
    { seq: 65, label: "에스겔 1-10", ranges: [ch("ezk", 1, 10)] },
    { seq: 66, label: "에스겔 11-28", ranges: [ch("ezk", 11, 28)] },
    { seq: 67, label: "에스겔 29-42", ranges: [ch("ezk", 29, 42)] },
    { seq: 68, label: "에스겔 43-48", ranges: [ch("ezk", 43, 48)] },
    {
      seq: 69,
      label: "역대하 36:22-23(에스라 1:1-3), 에스라 1-10",
      ranges: [
        { book: "2ch", fromCh: 36, fromVs: 22, toCh: 36, toVs: 23 },
        ch("ezr", 1, 10),
      ],
    },
    { seq: 70, label: "학개 1-2, 스가랴 1-7", ranges: [ch("hag", 1, 2), ch("zec", 1, 7)] },
    { seq: 71, label: "스가랴 8-14, 말라기 1-4", ranges: [ch("zec", 8, 14), ch("mal", 1, 4)] },
    { seq: 72, label: "에스더 1-10", ranges: [ch("est", 1, 10)] },
    { seq: 73, label: "느헤미야 1-13", ranges: [ch("neh", 1, 13)] },
    { seq: 74, label: "마태복음", ranges: [whole("mat")] },
    { seq: 75, label: "마가복음", ranges: [whole("mrk")] },
    { seq: 76, label: "누가복음", ranges: [whole("luk")] },
    { seq: 77, label: "요한복음", ranges: [whole("jhn")] },
    { seq: 78, label: "사도행전 1-12", ranges: [ch("act", 1, 12)] },
    {
      seq: 79,
      label: "사도행전 13-15:35, 갈라디아서, 사도행전 15:36-16",
      ranges: [
        { book: "act", fromCh: 13, toCh: 15, toVs: 35 },
        whole("gal"),
        { book: "act", fromCh: 15, fromVs: 36, toCh: 16 },
      ],
    },
    { seq: 80, label: "사도행전 17-19:22", ranges: [{ book: "act", fromCh: 17, toCh: 19, toVs: 22 }] },
    { seq: 81, label: "데살로니가전·후서", ranges: [whole("1th"), whole("2th")] },
    { seq: 82, label: "고린도전서", ranges: [whole("1co")] },
    {
      seq: 83,
      label: "사도행전 19:23-20:1, 고린도후서",
      ranges: [{ book: "act", fromCh: 19, fromVs: 23, toCh: 20, toVs: 1 }, whole("2co")],
    },
    {
      seq: 84,
      label: "사도행전 20:2-3, 로마서 1-6",
      ranges: [{ book: "act", fromCh: 20, fromVs: 2, toCh: 20, toVs: 3 }, ch("rom", 1, 6)],
    },
    {
      seq: 85,
      label: "로마서 7-16, 사도행전 20:3-28",
      ranges: [ch("rom", 7, 16), { book: "act", fromCh: 20, fromVs: 3, toCh: 28 }],
    },
    { seq: 86, label: "골로새서, 빌레몬서, 에베소서", ranges: [whole("col"), whole("phm"), whole("eph")] },
    {
      seq: 87,
      label: "빌립보서, 디모데전서, 디도서, 디모데후서",
      ranges: [whole("php"), whole("1ti"), whole("tit"), whole("2ti")],
    },
    {
      seq: 88,
      label: "야고보서, 유다서, 베드로전·후서",
      ranges: [whole("jas"), whole("jud"), whole("1pe"), whole("2pe")],
    },
    { seq: 89, label: "히브리서", ranges: [whole("heb")] },
    { seq: 90, label: "요한1·2·3서", ranges: [whole("1jn"), whole("2jn"), whole("3jn")] },
    { seq: 91, label: "요한계시록", ranges: [whole("rev")] },
  ],
};
