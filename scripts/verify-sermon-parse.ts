/**
 * 설교 .txt 파서 시험 — 드라이브에 실제로 있는 두 꼴을 모두 읽는가.
 *
 *   npm run verify:sermon
 *
 * (속으로는 tsc -p tsconfig.verify.json 뒤에 verify-alias.cjs 를 물려 돈다 —
 *  tsc CLI 로는 @/ 별칭을 줄 수 없어 설정 파일과 require 훅이 필요하다.)
 *
 * 표본은 2026-09-18 에 드라이브에서 직접 읽은 파일의 머리글·요약을 줄인 것이다.
 * 2025 년 파일과 2026 년 파일의 **키 이름이 다르다** — 그것을 놓치면 절반이 조용히 사라진다.
 */
import { parseSermon } from "../lib/sermons/parse";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}${detail ? " — " + detail : ""}`);
}

// ── 2026 년 꼴 (제목 · 본문 · 영상링크) ─────────────────────────────
const Y2026 = `날짜 : 2026년 9월 6일 주일설교
제목 : 빈 배의 축복
설교자 : 최병희 목사님
본문 : 누가복음 5:1-11
영상링크 : https://youtu.be/SJIf\\_V0eniU

\\-요약-
오늘 우리는 게네사렛 호숫가에서 일어난 베드로의 기적 사건을 살펴보았습니다.
베드로는 밤새도록 애를 썼으나 물고기를 한 마리도 잡지 못하고 깊은 좌절 속에 그물을 씻고 있었습니다.
믿음은 내 생각보다 주님의 말씀을 더 신뢰하고 나아가는 것입니다 (누가복음 5:5).

\\-적용-

1\\. 내 삶에 나의 계획과 경험대로 되지 않아 낙심했던 '빈 배'의 순간은 언제였나요?
2\\. 말씀을 의지해 깊은 곳에 그물을 내린 베드로처럼 새롭게 순종해야 할 영역은 무엇인가요?
3\\. "사람을 낚는 어부"라는 주님의 어명을 따라 무엇을 실천할 수 있을까요?`;

// ── 2025 년 꼴 (설교말씀 · 설교본문 · 영상) ──────────────────────────
const Y2025 = `날짜 : 2025년 9월 7일 주일설교
설교말씀 : 누가 그들에게 전하리요
설교자 : 최병희 목사님
설교본문 : 로마서 10:13-15
영상 : https://youtu.be/5LX3o7JcgWQ

\\-요약- 사랑하는 성도 여러분, 하나님은 그 아들을 세상에 보내신 것이 세상을 심판하려 하심이 아닙니다.
또한, 로마서 10장 14절은 "선포하는 사람이 없으면 어떻게 들을 수 있겠느냐"고 묻습니다.
에스겔 3장 18절은 악인을 깨우쳐 주지 않아 죽게 하면 그 책임이 우리에게 있다고 경고합니다.
마태복음 28장 18절로 20절에 나오는 예수님의 지상명령에 순종하지 않는 것입니다.
\\-적용-
1\\. 내 삶에서 영혼 구원의 중요성을 진정으로 깨닫고 있는지 점검해 봅시다.`;

// ── 깨진 것들 — 조용히 사라지면 안 되고 까닭이 나와야 한다 ────────────
const NO_DATE = `제목 : 날짜가 없는 설교\n본문 : 요한복음 3:16`;
const NO_TITLE = `날짜 : 2026년 1월 4일 주일설교\n본문 : 요한복음 3:16`;
const NO_REF = `날짜 : 2026년 1월 4일 주일설교\n제목 : 구절이 없는 설교\n본문 : 없음`;
const BAD_CHAPTER = `날짜 : 2026년 1월 4일 주일설교\n제목 : 없는 장\n본문 : 요한복음 99:1`;

function main() {
  // 2026
  const a = parseSermon(Y2026, "2026년 9월 6일 주일설교.txt");
  check("2026 꼴을 읽었다", a.ok, a.ok ? "" : a.failure.reason);
  if (a.ok) {
    const s = a.sermon;
    check("날짜", s.preachedOn === "2026-09-06", s.preachedOn);
    check("제목", s.title === "빈 배의 축복", s.title);
    check("설교자", s.preacher === "최병희 목사님", String(s.preacher));
    check("영상(이스케이프 제거)", s.videoUrl === "https://youtu.be/SJIf_V0eniU", String(s.videoUrl));
    check("요약을 담았다", !!s.summary && s.summary.includes("게네사렛"), `${s.summary?.length ?? 0}자`);
    check("적용 3개", s.applications.length === 3, String(s.applications.length));
    check(
      "요약이 적용을 삼키지 않았다",
      !!s.summary && !s.summary.includes("빈 배'의 순간은 언제였나요"),
    );
    check("요약에 '-요약-' 머리글이 섞이지 않았다", !!s.summary && !s.summary.includes("요약-"), s.summary?.slice(0, 20));
    check(
      "적용에 '-적용-' 머리글이 섞이지 않았다",
      s.applications.every((a) => !a.includes("적용-")),
      s.applications[0]?.slice(0, 20),
    );
    const main1 = s.refs.find((r) => r.kind === "main");
    check(
      "본문 = 누가복음 5:1-11",
      !!main1 && main1.bookCode === "luk" && main1.chapter === 5 && main1.verseStart === 1 && main1.verseEnd === 11,
      JSON.stringify(main1),
    );
    check(
      "요약의 인용 구절도 색인",
      s.refs.some((r) => r.kind === "quoted" && r.bookCode === "luk" && r.verseStart === 5),
      s.refs.map((r) => `${r.kind}:${r.bookCode}${r.chapter}:${r.verseStart}`).join(" "),
    );
  }

  // 2025 — 키 이름이 다르다
  const b = parseSermon(Y2025, "2025년 9월 7일 주일설교.txt");
  check("2025 꼴을 읽었다(설교말씀·설교본문·영상)", b.ok, b.ok ? "" : b.failure.reason);
  if (b.ok) {
    const s = b.sermon;
    check("날짜", s.preachedOn === "2025-09-07", s.preachedOn);
    check("제목(설교말씀)", s.title === "누가 그들에게 전하리요", s.title);
    check("영상(영상)", s.videoUrl === "https://youtu.be/5LX3o7JcgWQ", String(s.videoUrl));
    const main1 = s.refs.find((r) => r.kind === "main");
    check(
      "본문 = 로마서 10:13-15",
      !!main1 && main1.bookCode === "rom" && main1.chapter === 10 && main1.verseStart === 13 && main1.verseEnd === 15,
      JSON.stringify(main1),
    );
    // '로마서 10장 14절' 꼴
    check(
      "'N장 M절' 꼴 인용도 색인",
      s.refs.some((r) => r.kind === "quoted" && r.bookCode === "rom" && r.chapter === 10 && r.verseStart === 14),
      s.refs.filter((r) => r.kind === "quoted").map((r) => `${r.bookCode}${r.chapter}:${r.verseStart}`).join(" "),
    );
    check(
      "에스겔 3장 18절도 색인",
      s.refs.some((r) => r.bookCode === "ezk" && r.chapter === 3 && r.verseStart === 18),
    );
    check(
      "'18절로 20절' 범위도 읽었다(마태복음 28:18-20)",
      s.refs.some((r) => r.bookCode === "mat" && r.chapter === 28 && r.verseStart === 18 && r.verseEnd === 20),
      s.refs.filter((r) => r.bookCode === "mat").map((r) => `${r.chapter}:${r.verseStart}-${r.verseEnd}`).join(" "),
    );
    check("요약이 한 줄에 붙어 있어도 읽었다", !!s.summary && s.summary.includes("심판하려"));
  }

  // 깨진 것 — 까닭이 나와야 한다
  const c = parseSermon(NO_DATE, "x.txt");
  check("날짜 없으면 실패로 보고", !c.ok && c.failure.reason.includes("날짜"), c.ok ? "통과됨" : c.failure.reason);
  const d = parseSermon(NO_TITLE, "x.txt");
  check("제목 없으면 실패로 보고", !d.ok && d.failure.reason.includes("제목"), d.ok ? "통과됨" : d.failure.reason);
  const e = parseSermon(NO_REF, "x.txt");
  check("구절 없으면 실패로 보고", !e.ok && e.failure.reason.includes("구절"), e.ok ? "통과됨" : e.failure.reason);
  const f = parseSermon(BAD_CHAPTER, "x.txt");
  check("없는 장은 버린다", !f.ok, f.ok ? "통과됨" : f.failure.reason);

  // 파일 이름으로도 날짜를 건진다
  const g = parseSermon(`제목 : 머리글에 날짜가 없다\n본문 : 시편 23:1`, "2026년 3월 1일 주일설교.txt");
  check("머리글에 날짜가 없으면 파일 이름에서 찾는다", g.ok && g.sermon.preachedOn === "2026-03-01",
    g.ok ? g.sermon.preachedOn : g.failure.reason);

  console.log(`\n${failures === 0 ? "모두 통과" : `실패 ${failures}건`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
