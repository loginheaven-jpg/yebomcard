/**
 * 성경 질문 — 프롬프트 조립
 *
 * 원칙 문서의 자리(docs/BIBLE_QA_DOCTRINE.md §B-11, 지휘부 2026-09-18):
 *  - **교리 기준 본문(§1~§10)은 저장소 문서에서 읽는다.** 재가받은 글이라 아무 때나 바뀌면 안 되고,
 *    누가 언제 무엇을 고쳤는지 git 에 남아야 한다. 마커 사이만 잘라 쓴다.
 *  - **자주 바뀌는 네 목록(이단·가정교회·위기창구·삶공부)은 DB(`qa_lists`)에 두고 관리자 화면에서 고친다.**
 *    이 파일은 그 목록을 받아 블록으로 붙이는 일만 한다.
 *
 * 문서 파일이 서버리스 번들에 들어가야 한다 — `next.config.ts` 의 `outputFileTracingIncludes`
 * (음원 쪽 `voice/*.py` 와 같은 방식). 빠뜨리면 로컬에서는 되고 배포에서만 조용히 빈 프롬프트가 된다.
 */
import { readFile } from "fs/promises";
import path from "path";

/**
 * 기록에 함께 남기는 판 번호. 교리 문서의 마커 안쪽을 고쳤으면 올린다(§B-10).
 *  - v1 — 첫 판(2026-09-18)
 *  - v2 — 마지막 줄을 '목회자와 나눠 볼 질문' → '더 깊은 묵상' 으로. 교인이 스스로 묵상하거나
 *         목장에서 나눌 수 있는 물음으로 바꿨다(지휘부 2026-09-18)
 */
export const PROMPT_VERSION = "v3"; // 어려운 해석의 선별 기준 확장(2026-09-27)

const DOCTRINE_FILE = "docs/BIBLE_QA_DOCTRINE.md";
const DOCTRINE_START = "<!-- 프롬프트 시작 -->";
const DOCTRINE_END = "<!-- 프롬프트 끝 -->";

const GATE_HEADING = "## §A.";
const GATE_END_HEADING = "## §B.";

/** 한 번 읽으면 인스턴스가 살아 있는 동안 다시 읽지 않는다(문서는 배포 때만 바뀐다). */
let cachedDoctrine: string | null = null;
let cachedGate: string | null = null;

/** 저장소가 CRLF 다. 줄바꿈을 먼저 고르지 않으면 코드펜스 정규식이 조용히 빗나간다. */
function toLf(raw: string): string {
  return raw.split("\r\n").join("\n");
}

async function readDoc(): Promise<string> {
  // process.cwd() 는 Vercel 서버리스에서도 프로젝트 루트다(voice-studio 라우트가 같은 방식으로 .py 를 읽는다).
  return toLf(await readFile(path.join(process.cwd(), DOCTRINE_FILE), "utf-8"));
}

/**
 * 마커 **한 줄**을 찾아 그 사이를 자른다.
 *
 * `indexOf` 로 찾으면 안 된다 — 문서 서두의 안내 표가 마커를 글자로 적어 두었고
 * 그 한 줄에 시작·끝이 다 있어서, 잘라 낸 것이 5자가 된다. 2026-09-18 에 실제로 그렇게 깨졌다.
 */
function sliceBetweenMarkers(raw: string, start: string, end: string): string | null {
  const lines = raw.split("\n");
  const from = lines.findIndex((l) => l.trim() === start);
  if (from < 0) return null;
  const to = lines.findIndex((l, i) => i > from && l.trim() === end);
  if (to < 0) return null;
  return lines.slice(from + 1, to).join("\n").trim();
}

/**
 * 세 모델 공통 시스템 프롬프트(§1~§10).
 * 마커를 못 찾으면 **빈 문자열이 아니라 예외**다 — 기준 없이 답하는 것이 가장 나쁜 실패다.
 */
export async function loadDoctrinePrompt(): Promise<string> {
  if (cachedDoctrine) return cachedDoctrine;
  const raw = await readDoc();
  const body = sliceBetweenMarkers(raw, DOCTRINE_START, DOCTRINE_END);
  if (body === null) {
    throw new Error(`DOCTRINE_MARKER_MISSING: ${DOCTRINE_FILE}`);
  }
  if (body.length < 500) {
    throw new Error(`DOCTRINE_TOO_SHORT: ${body.length}`);
  }
  cachedDoctrine = body;
  return body;
}

/**
 * 선별 프롬프트(§A). **답변 프롬프트와 한 파일로 넣지 않는다** — "한 낱말만 출력" 이
 * 답변 지시를 덮어쓴다(§A 첫 줄). 문서에서는 §A 안의 코드 블록 하나가 그 전문이다.
 */
export async function loadGatePrompt(): Promise<string> {
  if (cachedGate) return cachedGate;
  const raw = await readDoc();
  const from = raw.indexOf(GATE_HEADING);
  const to = raw.indexOf(GATE_END_HEADING, from + 1);
  if (from < 0 || to < 0) throw new Error(`GATE_SECTION_MISSING: ${DOCTRINE_FILE}`);
  const section = raw.slice(from, to);
  const fence = /```\n([\s\S]*?)\n```/.exec(section);
  if (!fence) throw new Error("GATE_BLOCK_MISSING");
  const body = fence[1].trim();
  if (body.length < 200) throw new Error(`GATE_TOO_SHORT: ${body.length}`);
  cachedGate = body;
  return body;
}

// ─── DB 에서 오는 목록 블록 ────────────────────────────────────────

export interface QaListRow {
  kind: string;
  title: string;
  body: string | null;
  sort_order: number;
}

/**
 * 이단 목록 블록. **AI 는 스스로 어떤 단체도 이단으로 규정하지 않는다** —
 * 기억으로 답하면 사실오류와 명예훼손이 된다(§9). 앱이 준 목록만 쓴다.
 * 총회 회기·연도는 넣지 않는다 — 주면 답에서 틀리게 인용한다.
 */
export function heresyBlock(rows: QaListRow[]): string {
  const items = rows.filter((r) => r.kind === "heresy");
  if (items.length === 0) return "";
  const lines = items.map((r) => `- ${r.title} — ${r.body ?? ""}`.trimEnd());
  return [
    "[교단이 규정한 단체 목록]",
    "",
    "아래는 예봄교회가 속한 교단과 한국의 주요 장로교 교단이 이단 또는 비기독교로 규정한 단체다.",
    "이 목록에 있는 것만 그렇게 말할 수 있다. 목록에 없는 단체·교회·사람을 이단이라 말하지 않는다.",
    "회기·연도를 적지 않는다. 그 단체에 속한 사람을 비하하지 않고, 그 가르침을 자세히 옮기지 않는다.",
    "",
    ...lines,
  ].join("\n");
}

/** 위기 상담 창구 — 번호는 앱이 화면에 직접 그린다. 모델에게는 주지 않는다(§B-1). */
export function crisisLines(rows: QaListRow[]): QaListRow[] {
  return rows.filter((r) => r.kind === "crisis").sort((a, b) => a.sort_order - b.sort_order);
}

/** 삶공부 과정 이름 — 가정교회 낱말 판별에 쓴다(§B-12). */
export function lifeStudyNames(rows: QaListRow[]): string[] {
  return rows.filter((r) => r.kind === "lifestudy").map((r) => r.title);
}

/**
 * 가정교회 자료 블록. 모델은 웹을 보지 못한다 — 사역원 사이트 주소만 적어 주면 기억으로 지어낸다(§B-12).
 *
 * 블록은 두 몫이다 — **자료**(말과 뜻, 세 축, 네 기둥)와 **쓰는 규칙**(다른 교회 방식과 견주지 않는다,
 * 교회 살림은 지어내지 않는다 …).
 *  - 자료는 DB(`qa_lists`, kind `housechurch`)에 있으면 그것을 쓴다 — 수퍼어드민이 편집 화면에서 고친다.
 *    DB 가 비었으면 저장소 문서의 기본 자료를 쓴다.
 *  - **규칙은 언제나 문서에서 붙인다.** 예전에는 DB 에 한 줄이라도 있으면 문서 블록을 통째로 대신해
 *    규칙까지 빠졌다(2026-09-19 편집 화면을 만들며 발견) — 목사님이 한 줄 더하는 순간 규칙이 사라지는 구조였다.
 */
const HOUSECHURCH_FILE = "docs/BIBLE_QA_HOUSECHURCH.md";
const HC_START = "<!-- 가정교회 블록 시작 -->";
const HC_END = "<!-- 가정교회 블록 끝 -->";
/** 문서 블록 안에서 규칙 절이 시작되는 줄 — 여기부터 끝까지가 규칙이다 */
const HC_RULES_HEAD = "이 블록을 쓰는 규칙";
let cachedHouseChurch: string | null = null;

async function houseChurchDocBlock(): Promise<string> {
  if (cachedHouseChurch) return cachedHouseChurch;
  const raw = toLf(await readFile(path.join(process.cwd(), HOUSECHURCH_FILE), "utf-8"));
  const body = sliceBetweenMarkers(raw, HC_START, HC_END);
  if (body === null || body.length < 200) throw new Error("HOUSECHURCH_MARKER_MISSING");
  cachedHouseChurch = body;
  return body;
}

export async function loadHouseChurchBlock(rows: QaListRow[] = []): Promise<string> {
  const doc = await houseChurchDocBlock();
  const fromDb = rows.filter((r) => r.kind === "housechurch");
  if (fromDb.length === 0) return doc;

  // 규칙 절은 문서에서 — 줄 머리가 정확히 그 제목인 곳부터 끝까지(서두에 같은 말이 글자로 나와도 헷갈리지 않게).
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => l.trim() === HC_RULES_HEAD);
  if (at < 0) throw new Error("HOUSECHURCH_RULES_MISSING");
  const rules = lines.slice(at).join("\n").trim();

  return [
    "[가정교회]",
    "",
    "예봄교회는 가정교회사역원의 가정교회 철학을 받는 교회다. 아래는 교인이 쓰는 말과 그 뜻이다.",
    "'세 축' 은 가정교회가 굴러가는 세 가지 모임, '네 기둥' 은 초대교회의 정신이다.",
    "",
    ...fromDb
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => `- ${r.title} — ${r.body ?? ""}`.trimEnd()),
    "",
    rules,
  ].join("\n");
}

// ─── 가정교회 자료를 언제 붙이는가 (§B-12, 지휘부 2026-09-18) ──────────

/** 이 말이 있으면 붙인다 — 우리 교회 말이 분명하다. */
const HC_CLEAR_WORDS = [
  "가정교회",
  "연합교회",
  "주일연합예배",
  "삶공부",
  "목녀",
  "목원",
  "목장모임",
  "목장예배",
  "VIP",
];

/**
 * `목장` · `목자` **단독은 붙이지 않는다** — 성경에 늘 나오는 말이다(선한 목자, 주의 목장의 양).
 * 위의 분명한 말이 함께 있거나, 우리 교회를 가리키는 꼴일 때만 붙인다.
 * 이 한 줄이 없으면 시편 23편을 읽는 교인마다 가정교회 자료를 받는다.
 */
const HC_OURS_PATTERNS = [/(우리|저희)\s*목장/, /목자님/, /목녀님/, /목장\s*식구/];

export function needsHouseChurch(question: string, lifeStudy: string[] = []): boolean {
  const q = question ?? "";
  if (HC_CLEAR_WORDS.some((w) => q.includes(w))) return true;
  if (lifeStudy.some((name) => name && q.includes(name))) return true;
  return HC_OURS_PATTERNS.some((re) => re.test(q));
}

// ─── 한 질문의 시스템 프롬프트 조립 ────────────────────────────────

export interface BuildPromptInput {
  /** 교인이 보고 있던 구절 표기. 예: "누가복음 5:1-11" */
  versesRef: string;
  /** 그 절의 본문. 답이 아니라 **질문의 배경**으로 넣는다(§4). */
  versesText: string;
  /** 교인이 보던 역본 이름. 예: "새번역" */
  versionName: string;
  question: string;
  lists: QaListRow[];
}

export interface BuiltPrompt {
  systemPrompt: string;
  /** 가정교회 블록을 붙였는가 — 기록에 남긴다 */
  housechurch: boolean;
  promptVersion: string;
}

export async function buildAnswerPrompt(input: BuildPromptInput): Promise<BuiltPrompt> {
  const doctrine = await loadDoctrinePrompt();
  const parts: string[] = [doctrine];

  const heresy = heresyBlock(input.lists);
  if (heresy) parts.push(heresy);

  const housechurch = needsHouseChurch(input.question, lifeStudyNames(input.lists));
  if (housechurch) parts.push(await loadHouseChurchBlock(input.lists));

  // 고른 본문은 마지막에 둔다 — 바로 위 문단이 질문과 가장 가깝게 읽힌다.
  parts.push(
    [
      "[교인이 보고 있는 본문]",
      "",
      `${input.versesRef} (${input.versionName})`,
      input.versesText,
      "",
      "질문에 다른 구절이 나오지 않으면 이 본문을 두고 묻는 것으로 읽는다.",
      "본문을 답에 그대로 옮겨 적지 않는다 — 화면에는 이미 보이고 있다.",
    ].join("\n"),
  );

  return {
    systemPrompt: parts.join("\n\n---\n\n"),
    housechurch,
    promptVersion: PROMPT_VERSION,
  };
}
