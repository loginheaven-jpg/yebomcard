/**
 * 성경 질문 — 조립된 프롬프트가 실제로 규격대로 답하는지 확인한다.
 *
 *   npx tsc scripts/verify-bible-qa-prompt.ts lib/bibleQa/prompt.ts \
 *     --outDir .verify --module commonjs --target es2022 --skipLibCheck \
 *     --esModuleInterop --moduleResolution node
 *   node .verify/scripts/verify-bible-qa-prompt.js
 *
 * 무엇을 보는가
 *  1. 교리 문서의 마커 블록과 선별 프롬프트가 실제로 잘려 나오는가(배포 번들 사고의 예방)
 *  2. 가정교회 블록이 붙는 조건이 문서대로인가 — 특히 `목장`·`목자` 단독은 붙지 않아야 한다
 *  3. 그 프롬프트로 실제 모델을 불러 §4 의 네 줄 틀이 나오는가
 *
 * 3번은 외부 호출이라 `--live` 를 줄 때만 한다.
 */
import {
  buildAnswerPrompt,
  loadDoctrinePrompt,
  loadGatePrompt,
  needsHouseChurch,
} from "../lib/bibleQa/prompt";

const LIVE = process.argv.includes("--live");
const GATEWAY =
  process.env.AI_GATEWAY_URL || "https://ai-gateway20251125.up.railway.app";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}${detail ? " — " + detail : ""}`);
}

async function main() {
  // ── 1. 문서에서 잘라 오기 ────────────────────────────────────────
  const doctrine = await loadDoctrinePrompt();
  check("교리 본문을 마커 사이에서 잘라 왔다", doctrine.length > 3000, `${doctrine.length}자`);
  check(
    "본문에 소속 교단이 들어 있다",
    doctrine.includes("합신"),
    doctrine.includes("합신") ? "" : "합신 없음",
  );
  check("본문에 위기 절차가 들어 있다", /위기/.test(doctrine));
  check(
    "본문에 §B(앱의 몫)가 섞여 들어오지 않았다",
    !doctrine.includes("앱이 맡는 몫"),
  );
  check(
    "본문에 선별 프롬프트가 섞여 들어오지 않았다",
    !doctrine.includes("한 낱말만 출력"),
  );

  const gate = await loadGatePrompt();
  check("선별 프롬프트를 잘라 왔다", gate.length > 400, `${gate.length}자`);
  check(
    "선별 프롬프트에 세 낱말이 모두 있다",
    ["crisis", "allow", "deny"].every((w) => gate.includes(w)),
  );
  check("선별 프롬프트에 교리 본문이 섞이지 않았다", !gate.includes("합신"));

  // ── 2. 가정교회 블록을 붙이는 조건 ───────────────────────────────
  const HC_ON = [
    "삶공부는 몇 주 하나요",
    "목녀는 무슨 일을 하나요",
    "우리 목장 모임에서 뭘 하나요",
    "목자님께 어떻게 말씀드려야 할까요",
    "VIP 를 초대하려면",
    "가정교회가 무엇인가요",
  ];
  const HC_OFF = [
    "선한 목자란 무슨 뜻인가요",
    "주의 목장의 양이라는 말이 무엇인가요",
    "시편 23편이 왜 위로가 되나요",
    "하나님은 왜 악인을 용인하시나요",
  ];
  for (const q of HC_ON) {
    check(`가정교회 붙임: ${q}`, needsHouseChurch(q));
  }
  for (const q of HC_OFF) {
    check(`가정교회 안 붙임: ${q}`, !needsHouseChurch(q));
  }

  // ── 3. 실제 조립 ────────────────────────────────────────────────
  const built = await buildAnswerPrompt({
    versesRef: "누가복음 5:1-11",
    versesText:
      "1 예수께서 게네사렛 호숫가에 서 계시는데, 무리가 그에게 밀려들었다.\n" +
      "5 시몬이 대답하였다. 선생님, 우리가 밤새도록 애를 썼으나, 아무것도 잡지 못하였습니다.",
    versionName: "새번역",
    question: "밤새 애썼는데 아무것도 안 되는 때는 어떻게 버텨야 하나요?",
    lists: [
      { kind: "heresy", title: "신천지예수교 증거장막성전", body: "교주를 구원의 자리에 둔다", sort_order: 1 },
    ],
  });
  check("조립된 프롬프트에 교리 본문이 들어 있다", built.systemPrompt.includes("합신"));
  check("조립된 프롬프트에 이단 목록이 들어 있다", built.systemPrompt.includes("신천지"));
  check("조립된 프롬프트에 고른 본문이 들어 있다", built.systemPrompt.includes("누가복음 5:1-11"));
  check("이 질문에는 가정교회 블록이 붙지 않았다", built.housechurch === false);
  console.log(`       조립 길이 ${built.systemPrompt.length}자 · 판 ${built.promptVersion}`);

  if (!LIVE) {
    console.log("\n(외부 호출은 건너뜀 — 실제 답을 보려면 --live)");
  } else {
    console.log("\n── 실제 모델 호출(claude-sonnet) ──");
    const t0 = Date.now();
    const res = await fetch(`${GATEWAY}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-sonnet",
        messages: [{ role: "user", content: "밤새 애썼는데 아무것도 안 되는 때는 어떻게 버텨야 하나요?" }],
        system_prompt: built.systemPrompt,
        max_tokens: 4096,
        temperature: 0.7,
        use_fallback: false,
        use_cache: false,
        caller: "yebom-card:qa-verify",
      }),
    });
    const json = (await res.json()) as {
      content?: string;
      model?: string;
      detail?: string;
      usage?: { output_tokens?: number };
    };
    if (!res.ok) {
      check("모델 호출", false, `${res.status} ${json.detail ?? ""}`);
    } else {
      const text = json.content ?? "";
      console.log(`       ${Date.now() - t0}ms · ${json.model} · ${json.usage?.output_tokens}토큰`);
      console.log("       ────────────────");
      console.log(
        text
          .split("\n")
          .map((l) => "       " + l)
          .join("\n"),
      );
      console.log("       ────────────────");
      check("모델이 답을 돌려줬다", text.length > 50);
      // §4 네 줄 틀
      for (const head of ["한 줄 요약", "성경이 말하는 것", "조심할 점", "목회자와 나눠 볼 질문"]) {
        check(`§4 네 줄 틀: ${head}`, text.includes(head));
      }
      // §4 구절 주소는 3개까지
      const refs = text.match(/[가-힣]+(?:전서|후서|기|서|음|록|가|엘|야|서)?\s*\d+:\d+/g) ?? [];
      check(`구절 주소 3개 이하 (${refs.length}개)`, refs.length <= 3, refs.join(", "));
      // §B-2 면책은 앱이 붙인다 — 모델이 쓰면 두 번 나온다
      check(
        "모델이 면책 문구를 쓰지 않았다(앱이 붙인다)",
        !text.includes("교회의 공식 가르침이 아니"),
      );
    }
  }

  console.log(`\n${failures === 0 ? "모두 통과" : `실패 ${failures}건`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
