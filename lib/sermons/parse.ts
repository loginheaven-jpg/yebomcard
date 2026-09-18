/**
 * 설교 .txt 파서 (docs/BIBLE_QA_SERMONS.md §1)
 *
 * 드라이브의 주일설교 파일은 머리글이 정해진 꼴로 들어 있다 — 본문 구절을 사람이 이미
 * 적어 두었으니 기계가 추측할 일이 없다. **다만 키 이름이 해마다 바뀌었다**(2026-09-18 확인):
 *   2025 년: `날짜` · `설교말씀` · `설교자` · `설교본문` · `영상`
 *   2026 년: `날짜` · `제목`     · `설교자` · `본문`     · `영상링크`
 * 두 이름을 모두 받아야 하고, 못 읽은 파일은 **조용히 버리지 않고** 까닭과 함께 돌려준다.
 *
 * 구절 파싱은 lib/parseReference.ts 를 쓴다. 다만 '본문 : 누가복음 5:1-11' 을 그대로 넣으면
 * null 이라(접두어까지 책 이름으로 읽는다) 값만 떼어 넣는다.
 */
import { parseReference } from "@/lib/parseReference";
import { CHAPTER_COUNTS, getBookByCode } from "@/lib/books";

export interface SermonRef {
  kind: "main" | "quoted";
  bookCode: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
}

export interface ParsedSermon {
  preachedOn: string; // YYYY-MM-DD
  title: string;
  preacher: string | null;
  videoUrl: string | null;
  summary: string | null;
  applications: string[];
  refs: SermonRef[];
}

export interface ParseFailure {
  reason: string;
  detail?: string;
}

/** 머리글 키의 두 이름을 모두 받는다. 앞엣것이 먼저다. */
const KEYS = {
  date: ["날짜"],
  title: ["제목", "설교말씀"],
  preacher: ["설교자"],
  passage: ["본문", "설교본문"],
  video: ["영상링크", "영상"],
} as const;

/** `키 : 값` 한 줄에서 값을 뽑는다. 파일이 마크다운 이스케이프(`\-`)를 섞어 쓴다. */
function headerValue(lines: string[], names: readonly string[]): string | null {
  for (const name of names) {
    // 이름이 겹치는 것을 피한다 — '본문' 이 '설교본문' 의 일부라 정확히 그 키로 시작해야 한다.
    const re = new RegExp(`^\\s*${name}\\s*[:：]\\s*(.+)$`);
    for (const line of lines) {
      const m = re.exec(line.replace(/\\/g, ""));
      if (m) {
        const v = m[1].trim();
        if (v) return v;
      }
    }
  }
  return null;
}

/** "2026년 9월 6일 주일설교" → 2026-09-06 */
function parseKoreanDate(raw: string): string | null {
  const m = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${y}-${two(mo)}-${two(d)}`;
}

/**
 * `-요약-` 과 `-적용-` 사이를 가른다.
 * 파일이 `\-요약-` 처럼 이스케이프를 섞어 쓰므로 역슬래시를 먼저 지운다.
 */
function splitSections(body: string): { summary: string | null; applications: string[] } {
  const clean = body.replace(/\\/g, "");
  // **머리글 뒤에서 자른다.** `search` 로 얻은 위치는 `^\s*` 가 앞 빈 줄까지 삼켜
  // 머리글보다 앞을 가리킬 수 있어, 그대로 쓰면 '-요약-' · '-적용-' 이 본문에 섞인다
  // (2026-09-18 시험에서 실제로 '-적용-' 이 적용 항목 1번으로 들어갔다).
  const sumM = /^[ \t]*-[ \t]*요약[ \t]*-[ \t]*/m.exec(clean);
  const appM = /^[ \t]*-[ \t]*적용[ \t]*-[ \t]*/m.exec(clean);
  const sumIdx = sumM ? sumM.index : -1;
  const appIdx = appM ? appM.index : -1;

  let summary: string | null = null;
  if (sumM) {
    const from = sumM.index + sumM[0].length;
    const to = appIdx > sumIdx ? appIdx : clean.length;
    summary = clean.slice(from, to).trim() || null;
  }

  const applications: string[] = [];
  if (appM) {
    const tail = clean.slice(appM.index + appM[0].length);
    // "1. …" 로 시작하는 토막들. 번호가 없으면 줄 단위로 받는다.
    const numbered = tail.split(/^\s*\d+\s*\.\s*/m).map((t) => t.trim()).filter(Boolean);
    if (numbered.length > 1) {
      applications.push(...numbered);
    } else {
      applications.push(
        ...tail
          .split("\n")
          .map((t) => t.trim())
          .filter((t) => t.length > 10),
      );
    }
  }
  return { summary, applications };
}

/** 구절 주소 하나를 표에 넣을 꼴로 바꾼다. 장 수를 넘으면 버린다. */
function toRef(token: string, kind: "main" | "quoted"): SermonRef | null {
  const parsed = parseReference(token);
  if (!parsed) return null;
  if (!getBookByCode(parsed.bookCode)) return null;
  const chapters = CHAPTER_COUNTS[parsed.bookCode] ?? 0;
  if (parsed.chapter < 1 || parsed.chapter > chapters) return null;
  if (parsed.verses.length === 0) {
    // 장만 지정 — '장 전체' 로 둔다
    return { kind, bookCode: parsed.bookCode, chapter: parsed.chapter, verseStart: null, verseEnd: null };
  }
  return {
    kind,
    bookCode: parsed.bookCode,
    chapter: parsed.chapter,
    verseStart: parsed.verses[0],
    verseEnd: parsed.verses[parsed.verses.length - 1],
  };
}

/**
 * 본문에서 인용 구절을 긁는다(`kind: "quoted"`).
 * 요약·적용에 나오는 '로마서 10장 14절' · '야고보서 1:13' 두 꼴을 모두 받는다.
 * 머리글의 본문 구절(main)과 겹치면 뒤에서 걸러진다.
 */
function scanQuotedRefs(text: string): SermonRef[] {
  const out: SermonRef[] = [];
  const seen = new Set<string>();
  const clean = text.replace(/\\/g, "");

  // "책 3:16" · "책 3:16-18"
  const colon = /([가-힣]{2,6})\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–—~]\s*(\d{1,3}))?/g;
  // "책 3장 16절" · "책 3장 16절로 20절"
  const korean = /([가-힣]{2,6})\s*(\d{1,3})\s*장\s*(\d{1,3})\s*절(?:\s*(?:로|~|-)\s*(\d{1,3})\s*절)?/g;

  for (const re of [colon, korean]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      const token = m[4]
        ? `${m[1]} ${m[2]}:${m[3]}-${m[4]}`
        : `${m[1]} ${m[2]}:${m[3]}`;
      const ref = toRef(token, "quoted");
      if (!ref) continue;
      const key = `${ref.bookCode}:${ref.chapter}:${ref.verseStart}-${ref.verseEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/**
 * 설교 .txt 한 편을 읽는다.
 * 읽지 못하면 **예외를 던지지 않고** 까닭을 돌려준다 — 한 파일 때문에 들여오기 전체가
 * 멈추면 그 주의 설교가 통째로 사라진다.
 */
export function parseSermon(
  raw: string,
  fileName: string,
): { ok: true; sermon: ParsedSermon } | { ok: false; failure: ParseFailure } {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  // 머리글은 파일 앞쪽에 있다. 본문에 '본문:' 같은 말이 나와도 머리글로 읽지 않게 앞 20줄만 본다.
  const head = lines.slice(0, 20);

  const dateRaw = headerValue(head, KEYS.date) ?? fileName;
  const preachedOn = parseKoreanDate(dateRaw);
  if (!preachedOn) {
    return { ok: false, failure: { reason: "날짜를 읽지 못했다", detail: dateRaw.slice(0, 60) } };
  }

  const title = headerValue(head, KEYS.title);
  if (!title) {
    return { ok: false, failure: { reason: "제목을 읽지 못했다(제목·설교말씀 모두 없음)" } };
  }

  const preacher = headerValue(head, KEYS.preacher);
  const videoUrl = headerValue(head, KEYS.video);
  const passage = headerValue(head, KEYS.passage);

  const refs: SermonRef[] = [];
  if (passage) {
    // "누가복음 5:1-11" 하나거나, 쉼표·세미콜론으로 여럿일 수 있다.
    for (const token of passage.split(/[;,]/).map((t) => t.trim()).filter(Boolean)) {
      const ref = toRef(token.replace(/[~∼〜]/g, "-"), "main");
      if (ref) refs.push(ref);
    }
  }

  const { summary, applications } = splitSections(text);

  // 요약·적용에 인용된 구절까지 색인한다 — main 만이면 카드가 거의 뜨지 않는다.
  const quotedSource = [summary ?? "", ...applications].join("\n");
  for (const ref of scanQuotedRefs(quotedSource)) {
    const dup = refs.some(
      (r) =>
        r.bookCode === ref.bookCode &&
        r.chapter === ref.chapter &&
        r.verseStart === ref.verseStart &&
        r.verseEnd === ref.verseEnd,
    );
    if (!dup) refs.push(ref);
  }

  if (refs.length === 0) {
    return {
      ok: false,
      failure: {
        reason: "구절을 하나도 읽지 못했다",
        detail: passage ? `본문 값: ${passage.slice(0, 60)}` : "본문 줄이 없다",
      },
    };
  }

  return {
    ok: true,
    sermon: { preachedOn, title, preacher, videoUrl, summary, applications, refs },
  };
}
