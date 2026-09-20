/**
 * 말씀의삶 — 예봄교회 성경읽기진도표 91회차. 화면 이름은 **표준진도표**(지휘부 2026-09-20).
 *
 * 이 파일은 **데이터만** 담는다. 계산은 `engine.ts` 가 한다(2026-09-20 분리) —
 * 교인이 만든 진도표도 같은 엔진을 쓴다. 옛 import 경로를 지키려고 엔진을 다시 내보낸다.
 *
 * 데이터 원칙 — **종이 진도표 그대로 옮긴다.**
 * 정경 순으로 고치거나, 중복을 지우거나, 누락을 채우지 않는다. 이상한 곳은
 * `scripts/verify-plan-yebom91.ts` 가 드러내고 사람이 판단한다.
 *
 * 실측(검증 스크립트): 1,188 / 1,189장 커버 · 범위 오류 0건 · 경계 장 10개.
 * 미수록 1장은 시편 18 인데, 삼하 22(31회차)와 병행이라 내용은 읽힌다.
 *
 * **DB 에 두지 않는 까닭**: 재가받은 데이터라 git 이력과 검증 스크립트가 붙어 있어야 한다.
 */
import { CHAPTER_COUNTS } from "../books";
import type { PlanRange, ReadingPlan } from "./engine";

export * from "./engine";

/** 이 진도표의 키. 그룹·체크 기록이 이 값으로 참조한다(옛 기록과 같아야 해서 바꾸지 않는다). */
export const YEBOM91_ID = "yebom91";

const ch = (book: string, from: number, to: number = from): PlanRange => ({
  book,
  fromCh: from,
  toCh: to,
});

const whole = (book: string): PlanRange => ch(book, 1, CHAPTER_COUNTS[book]);

// ───────────────────────── 데이터 (종이 진도표 그대로) ─────────────────────────

export const YEBOM91: ReadingPlan = {
  id: YEBOM91_ID,
  // 화면에 보이는 이름(지휘부 2026-09-20). 탭 이름 '말씀의삶' 과 겹치지 않게 지었다.
  name: "표준진도표",
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
