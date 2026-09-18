/**
 * 성경 질문 — 답에 나온 구절 주소를 검증하고 본문을 붙인다
 *
 * docs/BIBLE_QA_DOCTRINE.md
 *  - §B-5 **구절 검증**: 답에서 `책 장:절` 을 뽑아 `bible_verses` 와 맞춰 보고, 없는 주소는 표시를 지운다.
 *    없는 구절은 프롬프트로 다 막지 못한다.
 *  - §B-9 **본문은 앱이 붙인다**: 답에는 주소만 오고, 본문은 교인이 보고 있는 역본에서 가져와 붙인다.
 *
 * 왜 서버에서 하는가 — `bible_verses` 조회가 필요하고, 화면이 없는 주소를 그대로 보이면
 * 교인은 그것을 성경에 있는 말로 읽는다.
 */
import { getBookByName, CHAPTER_COUNTS } from "@/lib/books";
import { stripNotes } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export interface VerseRef {
  /** 답에 적혀 있던 그대로 — 지울 때 이 글자를 찾는다 */
  raw: string;
  bookCode: string;
  bookName: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

export interface ResolvedRef extends VerseRef {
  /** 붙일 본문. 절마다 한 줄. */
  text: string;
}

/**
 * 한글 낱말 + `장:절`(범위 가능)을 찾는다.
 *
 * 앞말이 붙어 있을 수 있어(…따라서요한복음 3:16) 한글 덩이를 넉넉히 잡고,
 * **뒤에서부터 짧게 줄여** 책 이름을 맞춰 본다. §4 가 책 이름을 줄여 쓰지 말라고 했으니
 * 정식 이름이 먼저 맞는다.
 */
const REF_RE = /([가-힣]{2,9})\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–—~]\s*(\d{1,3}))?/g;

/** 가장 긴 책 이름이 5자(고린도전서·데살로니가전서는 6자)라 6부터 줄여 본다. */
function resolveBookFromRun(run: string) {
  for (let len = Math.min(run.length, 6); len >= 2; len -= 1) {
    const candidate = run.slice(run.length - len);
    const book = getBookByName(candidate);
    if (book) return { book, name: candidate };
  }
  return null;
}

/** 답 글에서 구절 주소를 뽑는다. 같은 주소가 여러 번 나오면 한 번만 돌려준다. */
export function extractRefs(text: string): VerseRef[] {
  const out: VerseRef[] = [];
  const seen = new Set<string>();
  if (!text) return out;

  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text)) !== null) {
    const hit = resolveBookFromRun(m[1]);
    if (!hit) continue;
    const chapter = Number(m[2]);
    const verseStart = Number(m[3]);
    const verseEnd = m[4] ? Number(m[4]) : verseStart;
    if (chapter < 1 || verseStart < 1 || verseEnd < verseStart) continue;

    // 원문에서 이 주소가 차지한 글자 — 책 이름 앞의 붙은 말은 뺀다.
    const matched = m[0];
    const raw = matched.slice(matched.length - (matched.length - (m[1].length - hit.name.length)));

    const key = `${hit.book.code}:${chapter}:${verseStart}-${verseEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      raw,
      bookCode: hit.book.code,
      bookName: hit.name,
      chapter,
      verseStart,
      verseEnd,
    });
  }
  return out;
}

/** 장 수를 넘는 주소는 DB 를 묻기 전에 걸러 낸다. */
function withinBook(ref: VerseRef): boolean {
  const chapters = CHAPTER_COUNTS[ref.bookCode] ?? 0;
  return chapters > 0 && ref.chapter <= chapters;
}

export interface VerifyResult {
  /** DB 에 있는 주소 + 붙일 본문 */
  resolved: ResolvedRef[];
  /** DB 에 없던 주소(표시를 지운다) */
  missing: VerseRef[];
}

/**
 * 주소를 `bible_verses` 로 확인하고 본문을 붙인다.
 * 한 번의 조회로 끝낸다 — 주소가 3개까지라 `or` 로 묶어도 짧다.
 */
export async function verifyRefs(
  refs: VerseRef[],
  version: string,
): Promise<VerifyResult> {
  const candidates = refs.filter(withinBook);
  const outOfRange = refs.filter((r) => !withinBook(r));
  if (candidates.length === 0) {
    return { resolved: [], missing: outOfRange };
  }

  const resolved: ResolvedRef[] = [];
  const missing: VerseRef[] = [...outOfRange];

  // 주소마다 한 번씩 묻는다(최대 3개). 한 조회로 묶으면 절 범위가 겹칠 때 섞인다.
  await Promise.all(
    candidates.map(async (ref) => {
      const { data, error } = await supabaseAdmin
        .from("bible_verses")
        .select("verse, text")
        .eq("version", version)
        .eq("book_code", ref.bookCode)
        .eq("chapter", ref.chapter)
        .gte("verse", ref.verseStart)
        .lte("verse", ref.verseEnd)
        .order("verse");
      if (error || !data || data.length === 0) {
        missing.push(ref);
        return;
      }
      const text = data
        .map((v) => `${v.verse} ${stripNotes(v.text ?? "")}`.trim())
        .join("\n");
      resolved.push({ ...ref, text });
    }),
  );

  // 답에 나온 순서대로
  const order = new Map(candidates.map((r, i) => [`${r.bookCode}:${r.chapter}:${r.verseStart}`, i]));
  resolved.sort(
    (a, b) =>
      (order.get(`${a.bookCode}:${a.chapter}:${a.verseStart}`) ?? 0) -
      (order.get(`${b.bookCode}:${b.chapter}:${b.verseStart}`) ?? 0),
  );
  return { resolved, missing };
}

/**
 * 없는 주소의 **표시만** 지운다(§B-5). 글을 다시 쓰지 않는다 —
 * 모델의 말을 앱이 고쳐 쓰기 시작하면 무엇이 모델의 말인지 알 수 없게 된다.
 * 괄호로 감싼 주소는 괄호까지, 그 밖은 주소만 지운다.
 */
export function stripMissingRefs(text: string, missing: VerseRef[]): string {
  let out = text;
  for (const ref of missing) {
    const escaped = ref.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "(로마서 99:1)" · "(로마서 99:1, 야고보서 1:13)" 의 앞뒤 구두점을 함께 걷어낸다
    out = out.replace(new RegExp(`\\s*\\(\\s*${escaped}\\s*\\)`, "g"), "");
    out = out.replace(new RegExp(`\\s*,\\s*${escaped}`, "g"), "");
    out = out.replace(new RegExp(`${escaped}\\s*,\\s*`, "g"), "");
    out = out.replace(new RegExp(escaped, "g"), "");
  }
  // 주소를 지우고 남은 빈 괄호와 겹공백을 정리한다
  return out
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,。])/g, "$1")
    .trim();
}
