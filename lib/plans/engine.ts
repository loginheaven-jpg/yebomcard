/**
 * 말씀의삶 — 진도표 엔진 (데이터 없는 순수 로직)
 *
 * **여기에는 어떤 진도표의 내용도 없다.** `ReadingPlan` 하나를 받아 회차·장·진행을 계산하는 함수뿐이다.
 * 그래서 파일에 박힌 표준진도표(`yebom91.ts`)와 교인이 만들어 DB 에 둔 진도표가
 * **같은 코드로 같게** 계산된다(지휘부 2026-09-20 — 그룹마다 다른 진도표).
 *
 * 모두 순수 함수다. 상태를 기억하지 않으며, 무거운 파생값만 WeakMap 으로 기억한다.
 * 규칙의 근거(경계 장 · entryChapter 와 nextChapter 를 나눈 까닭)는 docs/READING_PLAN.md 에 있다.
 */
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
  /** 진도표 키 — 파일 진도표는 'yebom91', 교인이 만든 것은 'p12' 꼴(DB) */
  id: string;
  name: string;
  units: PlanUnit[];
}

export interface PlanChapterRef {
  book: string;
  chapter: number;
}

/** 절 경계까지 살린 읽기 단위. 같은 장이 두 번 나올 수 있다(10·79회차) */
export interface PlanSegment extends PlanChapterRef {
  fromVs?: number;
  toVs?: number;
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

/** 경계 장 집합의 키 */
export const chapterKey = (book: string, chapter: number): string => `${book}:${chapter}`;

// ───────────────────────── 파생 유틸 ─────────────────────────

const unitChaptersCache = new WeakMap<PlanUnit, PlanChapterRef[]>();
const unitSegmentsCache = new WeakMap<PlanUnit, PlanSegment[]>();

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

/**
 * 회차의 읽기 순서를 **절 단위**로 펼친다.
 *
 * `unitChapters` 는 장 단위라 같은 장을 한 번만 낸다 — 장 이동에는 그것이 맞다
 * (같은 장으로 두 번 넘어가면 제자리걸음으로 보인다). 그러나 진도표는 한 장을
 * 두 토막으로 나눠 **다른 순서로** 읽히기도 한다:
 *
 *   10회차  출애굽기 32-40, 민수기 9:15-23, 9:1-14
 *   79회차  사도행전 13-15:35, 갈라디아서, 사도행전 15:36-16
 *
 * 낭독은 이 순서를 따라야 한다. 민수기 9장을 1절부터 읽으면 진도표와 다른 본문이다.
 * 그래서 낭독·진입 절에는 이 함수를 쓰고, 장 이동에는 `unitChapters` 를 쓴다.
 *
 * 절 경계는 **구간의 양 끝 장에만** 붙는다. "열왕기하 11-15:22" 는 11~14장이 통째이고
 * 15장만 22절까지다.
 */
export function unitSegments(unit: PlanUnit): PlanSegment[] {
  const hit = unitSegmentsCache.get(unit);
  if (hit) return hit;

  const out: PlanSegment[] = [];
  for (const r of unit.ranges) {
    for (let c = r.fromCh; c <= r.toCh; c++) {
      out.push({
        book: r.book,
        chapter: c,
        fromVs: c === r.fromCh ? r.fromVs : undefined,
        toVs: c === r.toCh ? r.toVs : undefined,
      });
    }
  }
  unitSegmentsCache.set(unit, out);
  return out;
}

/**
 * 그 회차에서 이 장을 읽는 순서. 장 전체를 통째로 읽으면 `[{fromVs:undefined,toVs:undefined}]`,
 * 회차에 없는 장이면 빈 배열.
 */
export function chapterSegments(unit: PlanUnit, book: string, chapter: number): PlanSegment[] {
  return unitSegments(unit).filter((s) => s.book === book && s.chapter === chapter);
}

/** 그 회차에서 이 장을 펼칠 때 놓일 절. 장 전체면 undefined(맨 위) */
export function chapterEntryVerse(
  unit: PlanUnit,
  book: string,
  chapter: number,
): number | undefined {
  return chapterSegments(unit, book, chapter)[0]?.fromVs;
}

/** 절 번호가 이 회차의 해당 장 구간에 드는가 */
export function verseInSegments(segments: PlanSegment[], verse: number): boolean {
  if (segments.length === 0) return true;
  return segments.some(
    (s) => verse >= (s.fromVs ?? 1) && verse <= (s.toVs ?? Number.MAX_SAFE_INTEGER),
  );
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
