/**
 * 성경 질문 — 답을 네 줄로 나눈다
 *
 * 답은 `한 줄 요약 / 성경이 말하는 것 / 조심할 점 / 더 깊은 묵상` 네 줄로 온다
 * (docs/BIBLE_QA_DOCTRINE.md §4). 화면은 그 네 칸을 따로 그려야 하고,
 * **모델이 틀을 어겼을 때 글을 잃어버리지 않아야 한다** — 못 나누면 통째로 한 덩이로 보인다.
 *
 * 서버·클라이언트 어디서나 쓸 수 있게 다른 것을 import 하지 않는다.
 */

export const ANSWER_HEADINGS = [
  "한 줄 요약",
  "성경이 말하는 것",
  "조심할 점",
  "더 깊은 묵상",
] as const;

export type AnswerHeading = (typeof ANSWER_HEADINGS)[number];

/**
 * 옛 제목 → 지금 제목. 2026-09-18 에 마지막 줄을 '목회자와 나눠 볼 질문' 에서
 * '더 깊은 묵상' 으로 바꿨다(지휘부). 이미 저장된 답과, 모델이 옛 꼴로 쓰는 경우를 함께 읽는다.
 */
const LEGACY_HEADINGS: Record<string, AnswerHeading> = {
  "목회자와 나눠 볼 질문": "더 깊은 묵상",
};

/** 지금 제목과 옛 제목을 모두 — 긴 것부터 맞춘다 */
const ALL_HEADINGS: { text: string; heading: AnswerHeading }[] = [
  ...ANSWER_HEADINGS.map((h) => ({ text: h as string, heading: h })),
  ...Object.entries(LEGACY_HEADINGS).map(([text, heading]) => ({ text, heading })),
].sort((a, b) => b.text.length - a.text.length);

export interface AnswerSection {
  heading: AnswerHeading;
  body: string;
}

export interface ParsedAnswer {
  sections: AnswerSection[];
  /** 네 줄 틀 밖의 글(머리말·꼬리말). 버리지 않고 보인다. */
  extra: string;
  /** 네 칸이 다 있는가 — 아니면 화면이 통째로 보여 준다 */
  wellFormed: boolean;
}

/**
 * `**한 줄 요약**` · `## 한 줄 요약` · `한 줄 요약 —` · `한 줄 요약:` 을 모두 받는다.
 * 맞춘 **글자**(`text`)도 함께 돌려준다 — 옛 제목으로 온 줄은 옛 글자를 기준으로 본문을 잘라야 한다.
 */
function headingAt(line: string): { heading: AnswerHeading; text: string } | null {
  const bare = line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\d+\.\s*/, "")
    .trim();
  for (const { text, heading } of ALL_HEADINGS) {
    if (bare === text) return { heading, text };
    // "한 줄 요약 — 본문" 처럼 한 줄에 붙어 오는 것이 기본이다
    const re = new RegExp(`^${text}\\s*[—–\\-:·]`);
    if (re.test(bare)) return { heading, text };
  }
  return null;
}

function bodyAfterHeading(line: string, headingText: string): string {
  const bare = line
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
  const idx = bare.indexOf(headingText);
  if (idx < 0) return "";
  return bare
    .slice(idx + headingText.length)
    .replace(/^\s*[—–\-:·]\s*/, "")
    .trim();
}

export function parseAnswer(text: string): ParsedAnswer {
  const raw = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return { sections: [], extra: "", wellFormed: false };

  const lines = raw.split("\n");
  const sections: AnswerSection[] = [];
  const before: string[] = [];
  let current: { heading: AnswerHeading; body: string[] } | null = null;

  for (const line of lines) {
    const hit = headingAt(line);
    if (hit) {
      if (current) sections.push({ heading: current.heading, body: current.body.join("\n").trim() });
      current = { heading: hit.heading, body: [bodyAfterHeading(line, hit.text)].filter(Boolean) };
      continue;
    }
    if (current) current.body.push(line);
    else before.push(line);
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join("\n").trim() });

  // 같은 머리가 두 번 나오면 뒤엣것을 앞엣것에 붙인다(모델이 되풀이해도 글이 사라지지 않게)
  const merged: AnswerSection[] = [];
  for (const s of sections) {
    const found = merged.find((m) => m.heading === s.heading);
    if (found) found.body = `${found.body}\n${s.body}`.trim();
    else merged.push({ ...s });
  }

  const wellFormed =
    merged.length === ANSWER_HEADINGS.length &&
    ANSWER_HEADINGS.every((h) => merged.some((m) => m.heading === h && m.body.length > 0));

  return {
    // 문서에 적힌 순서로 그린다 — 모델이 뒤바꿔 보내도 화면은 한 꼴이다
    sections: ANSWER_HEADINGS.map((h) => merged.find((m) => m.heading === h)).filter(
      (s): s is AnswerSection => !!s,
    ),
    extra: before.join("\n").trim(),
    wellFormed,
  };
}

/**
 * 다른 AI 로 이어갈 때 들고 가는 글.
 * 주소창에 실어 보내는 쪽은 길이 제한이 있어 짧게 자른다 — 전문은 클립보드로 함께 간다.
 */
export function handoffText(input: {
  versesRef: string;
  versionName: string;
  versesText: string;
  question: string;
  answer: string;
  label: string;
}): string {
  return [
    `[예봄성경에서 이어온 이야기]`,
    "",
    `본문 ${input.versesRef} (${input.versionName})`,
    input.versesText,
    "",
    `내 질문`,
    input.question,
    "",
    `${input.label} 의 답`,
    input.answer,
    "",
    `위 이야기를 이어서 묻고 싶습니다.`,
  ].join("\n");
}

/** 주소창 길이 한도. 넘으면 끝을 자르고 안내를 붙인다(클립보드에는 전문이 있다). */
const URL_TEXT_LIMIT = 1500;

export function handoffUrl(column: string, text: string): string | null {
  const short =
    text.length > URL_TEXT_LIMIT
      ? text.slice(0, URL_TEXT_LIMIT) + "\n…(뒷부분은 붙여넣기 해 주세요)"
      : text;
  const q = encodeURIComponent(short);
  switch (column) {
    case "chatgpt":
      return `https://chatgpt.com/?q=${q}`;
    case "claude":
      return `https://claude.ai/new?q=${q}`;
    case "gemini":
      // Gemini 는 주소로 질문을 미리 넣는 길이 없다 — 창만 열고 붙여넣기를 안내한다.
      return "https://gemini.google.com/app";
    default:
      return null;
  }
}

/** 그 AI 가 주소로 질문을 받아 주는가 — 화면 안내 문구가 갈린다. */
export function supportsPrefill(column: string): boolean {
  return column === "chatgpt" || column === "claude";
}

/** 주소창에 다 못 싣고 앞부분만 채우는가 — 그러면 '전체는 붙여넣기' 를 안내해야 한다. */
export function isHandoffTruncated(text: string): boolean {
  return text.length > URL_TEXT_LIMIT;
}
