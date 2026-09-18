/**
 * 위기 안전망 시험 — 선별이 실패했을 때 막을 것과 통과시킬 것을 제대로 가르는가.
 *
 *   npm run verify:crisis
 *
 * 기준은 docs/BIBLE_QA_DOCTRINE.md §A 의 보기다. 특히 **'자살한 사람은 지옥에 갑니까' 는 allow** 다 —
 * 주제로 묻는 말을 막으면 교인은 다시 묻지 않는다. 안전망은 1인칭·지금의 고통만 잡아야 한다.
 */
import { hasCrisisSignal } from "../lib/bibleQa/crisisSignal";
import { decide } from "../lib/bibleQa/gate";

let failures = 0;
function check(label: string, ok: boolean) {
  if (!ok) failures += 1;
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}`);
}

// ── 선별이 실패해도 막아야 하는 말(§A 의 crisis 보기 + 같은 꼴) ─────────
const MUST_SIGNAL = [
  "저도 그냥 사라지고 싶어요",
  "남편이 때립니다",
  "약을 끊었는데 기도로 이길 수 있나요",
  "딸이 자해를 했어요",
  "요즘 죽고 싶다는 생각이 들어요",
  "더는 살고 싶지 않습니다",
  "자살하고 싶은 마음이 들 때 어떤 말씀을 붙들까요",
  "아빠한테 맞고 있어요",
  "밤마다 환청이 들립니다",
  "어릴 때 학대를 당했는데 용서해야 하나요",
  "살 이유가 없는 것 같아요",
];

// ── 막으면 안 되는 말(주제로 묻는 신앙 질문) ────────────────────────────
const MUST_NOT_SIGNAL = [
  "자살한 사람은 지옥에 갑니까",
  "하나님은 왜 악인을 용인하시나",
  "십일조를 꼭 해야 하나요",
  "요한복음 3:16 이 무슨 뜻인가요",
  "목사님이 미워요, 어떻게 하죠",
  "베드로는 왜 예수님을 세 번 부인했나요",
  "시편 23편이 왜 위로가 되나요",
  "사람들이 예수님을 때린 이유는 무엇인가요",
  "성경은 학대에 대해 무엇이라 말하나요",
  "빌립의 이 말은 불신의 표현인가?",
];

function main() {
  console.log("── 막아야 하는 말");
  for (const q of MUST_SIGNAL) check(`신호 있음: ${q}`, hasCrisisSignal(q));
  console.log("── 막으면 안 되는 말");
  for (const q of MUST_NOT_SIGNAL) check(`신호 없음: ${q}`, !hasCrisisSignal(q));

  console.log("── 판정 규칙");
  // 선별이 제때 답하면 선별을 따른다 — 안전망 말이 있어도
  check("선별 allow + 신호 → allow(선별을 따른다: '욥은 왜 죽고 싶다고 했나요')", decide("allow", true) === "allow");
  check("선별 crisis + 신호 없음 → crisis", decide("crisis", false) === "crisis");
  check("선별 deny + 신호 없음 → deny", decide("deny", false) === "deny");
  // 선별이 실패했을 때만 안전망이 가른다
  check("선별 실패 + 신호 → crisis(막는다)", decide("error", true) === "crisis");
  check("선별 실패 + 신호 없음 → error(통과)", decide("error", false) === "error");

  console.log(`\n${failures === 0 ? "모두 통과" : `실패 ${failures}건`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
