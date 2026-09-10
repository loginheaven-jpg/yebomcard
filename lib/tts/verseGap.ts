/**
 * 절과 절 사이의 쉼.
 *
 * 왜 필요한가
 *   절 하나가 곧 음원 파일 하나다. 모델은 발화가 끝나면 곧바로 멈추므로 파일 꼬리에
 *   무음이 거의 없다 — 실측 중앙값 50ms, 아예 0ms 인 절도 있다. 반면 **절 안에서**
 *   문장이 끝날 때는 모델이 스스로 460ms 를 쉰다.
 *
 *   그런데 재생기는 `onended` 에서 곧바로 다음 절을 튼다. 그래서 절 사이는
 *   꼬리 50ms + 다음 절 머리 128ms ≈ 178ms 밖에 안 된다. 절 안의 460ms 에 견주면
 *   1/3 도 안 되니, 마지막 글자가 급하게 맺히거나 살짝 잘린 것처럼 들린다.
 *   (파형은 멀쩡하다 — 절 끝 음절은 오히려 절 안 문장 끝보다 길게 맺힌다.)
 *
 *   그래서 재생할 때 쉼을 준다. 음원을 다시 만들지 않아도 되고, 영희뿐 아니라
 *   김단아·Chirp 등 **모든 성우**에 함께 적용된다.
 *
 * 규칙은 스튜디오(voice/prosody.py)의 is_terminal / gap_after 와 같아야 한다.
 * 두 곳이 어긋나면 미리듣기와 실제 재생의 호흡이 달라진다.
 */

/** 개역체 절 끝 어미 — 구두점이 없는 본문(개역개정)의 종결/연결 판정에 쓴다 */
const TERMINAL_TAIL = ["라", "다", "까", "냐", "자"];
const CONNECTIVE_TAIL = ["요", "와", "고", "며", "나", "니", "면", "만", "서"];

/** 편집자 주석 — 화면엔 두되 낭독에서 빼는 부분. 쉼 판정도 이걸 뺀 본문으로 한다 */
const NOTE_RE = /\s*\(\s*주\s*[:：][\s\S]*$/;

/**
 * 문장이 끝났는가.
 * 구두점이 있는 본문(새번역)은 부호로, 없는 본문(개역)은 어미로 판정한다.
 */
export function isTerminalVerse(text: string): boolean {
  let t = (text || "").replace(NOTE_RE, "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  // **닫는 따옴표·괄호를 먼저 뗀다.** 새번역은 인용으로 끝나는 절이 매우 많아
  // (…다." 꼴이 31,075절 중 4,381절), 부호를 먼저 보면 그 절이 전부 연결로 잘못 잡힌다.
  t = t.replace(/["')\]”’]+$/, "");
  if (!t) return true;
  const last = t[t.length - 1];
  if (".!?".includes(last)) return true;
  if (",;:".includes(last)) return false;
  // 구두점이 없는 본문(개역개정)은 어미로 판정한다
  const ends = (list: string[]) => list.some((x) => t.endsWith(x));
  if (ends(CONNECTIVE_TAIL) && !ends(TERMINAL_TAIL)) return false;
  return ends(TERMINAL_TAIL);
}

/** 설정에서 고르는 쉼 길이 */
export type VerseGap = "short" | "normal" | "long";

export const VERSE_GAP_LABELS: Record<VerseGap, string> = {
  short: "짧게",
  normal: "보통",
  long: "길게",
};

/**
 * [문장이 끝난 절, 이어지는 절] 뒤에 둘 쉼(ms).
 *
 * `normal` 은 스튜디오 기본값(0.55s / 0.15s)과 같다 — 장 단위 미리듣기와 호흡이 맞는다.
 */
const GAP_MS: Record<VerseGap, [number, number]> = {
  short: [300, 100],
  normal: [550, 150],
  long: [900, 250],
};

/**
 * 이 절 뒤에 둘 쉼(ms).
 *
 * 배속으로 들으면 쉼도 같이 줄인다 — 말이 빨라졌는데 쉼만 그대로면 뚝뚝 끊긴다.
 */
export function verseGapMs(text: string, gap: VerseGap, speed = 1): number {
  const [terminal, connective] = GAP_MS[gap] ?? GAP_MS.normal;
  const base = isTerminalVerse(text) ? terminal : connective;
  return Math.round(base / Math.max(0.5, speed));
}
