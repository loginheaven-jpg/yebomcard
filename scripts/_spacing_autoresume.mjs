// 게이트웨이(gemini-flash) 회복을 폴링하다 정상화되면 띄어쓰기 교정을 자동 재개·수렴.
// 게이트웨이가 회복↔악화를 반복하므로: 회복 구간마다 easy·rnksv 를 (실패 재시도 포함) 돌리고,
// 잔여 실패가 0 이 되거나 더는 줄지 않을 때(영구 실패 추정)까지 반복한다.
// 회복 판정: provider gemini-flash 호출이 200 + 응답 model 이 gemini 계열(폴백 gpt-5.1 아님) + 8s 미만.
// CONC=16. 일회성 운영 스크립트(미커밋 대상이었으나 수렴 로직 반영 위해 커밋).
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const GW = (process.env.AI_GATEWAY_URL || "https://ai-gateway20251125.up.railway.app") + "/api/ai/chat";
const PAYLOAD = JSON.stringify({
  messages: [{ role: "user", content: "아브라함 의 자손 이삭 의 아들" }],
  system_prompt: "한국어 본문의 띄어쓰기만 교정해 본문만 출력한다.",
  provider: "gemini-flash",
  temperature: 0,
  max_tokens: 120,
  caller: "autoresume-probe",
});
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const start = Date.now();
  try {
    const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: PAYLOAD, signal: ctrl.signal });
    const ms = Date.now() - start;
    let model = "?";
    try { model = (await r.json()).model || "?"; } catch {}
    return { ok: r.ok, ms, model };
  } catch {
    return { ok: false, ms: Date.now() - start, model: "err" };
  } finally {
    clearTimeout(timer);
  }
}

async function waitHealthy() {
  while (true) {
    const { ok, ms, model } = await probe();
    const healthy = ok && /gemini/i.test(model) && ms < 8000;
    console.log(`[autoresume] ${ts()} ok=${ok} ${ms}ms model=${model}${healthy ? " ← 회복" : ""}`);
    if (healthy) return;
    await sleep(180000); // 3분
  }
}

function run(version) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["scripts/fix-spacing.mjs", version], {
      stdio: "inherit",
      env: { ...process.env, CONC: "16" },
    });
    p.on("close", (code) => resolve(code));
  });
}

function failsOf(version) {
  try { return JSON.parse(readFileSync(`spacing-fix-${version}.json`, "utf8")).fails.length; } catch { return 0; }
}

console.log(`[autoresume] 시작 ${ts()} — 게이트웨이 gemini-flash 회복 대기(3분 간격), 회복 시 easy·rnksv 수렴 실행`);
let prevTotal = Infinity;
let noProgress = 0;
let pass = 0;
while (true) {
  await waitHealthy();
  pass++;
  console.log(`[autoresume] === pass ${pass} 시작 ${ts()} ===`);
  await run("easy");
  await waitHealthy(); // rnksv 전 재확인 — 악화 시 회복까지 대기
  await run("rnksv");
  const ef = failsOf("easy");
  const rf = failsOf("rnksv");
  const total = ef + rf;
  console.log(`[autoresume] pass ${pass} 종료 ${ts()} — easy실패 ${ef} rnksv실패 ${rf} (합 ${total})`);
  if (total === 0) { console.log(`[autoresume] ✅ 완료 — 잔여 실패 0 ${ts()}`); break; }
  if (total >= prevTotal) noProgress++; else noProgress = 0;
  prevTotal = total;
  if (noProgress >= 3) { console.log(`[autoresume] ⚠ 수렴 — 3회 연속 실패 ${total} 감소 없음(영구 실패 추정) → 종료 ${ts()}`); break; }
}
