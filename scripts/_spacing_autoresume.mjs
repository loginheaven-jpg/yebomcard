// 게이트웨이(provider=claude-haiku)로 easy·rnksv 를 잔여 실패 0 까지 수렴 실행.
// 게이트웨이가 회복↔다운을 반복하므로 각 pass 전 헬스체크(빠른 200, <8s) → 정상일 때만 실행.
// 다운/저속 구간엔 3분 대기(30s 타임아웃 헛돌이 방지). 잔여 0 또는 3회 미감소까지 반복.
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const GW = (process.env.AI_GATEWAY_URL || "https://ai-gateway20251125.up.railway.app") + "/api/ai/chat";
const PAYLOAD = JSON.stringify({
  messages: [{ role: "user", content: "아브라함 의 자손 이삭 의 아들" }],
  system_prompt: "한국어 본문의 띄어쓰기만 교정해 본문만 출력한다.",
  provider: "claude-haiku",
  temperature: 0,
  max_tokens: 120,
  caller: "autoresume-probe",
});
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const s = Date.now();
  try {
    const r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json" }, body: PAYLOAD, signal: ctrl.signal });
    const ms = Date.now() - s;
    let model = "?";
    try { model = (await r.json()).model || "?"; } catch {}
    return { ok: r.ok, ms, model };
  } catch {
    return { ok: false, ms: Date.now() - s, model: "err" };
  } finally {
    clearTimeout(timer);
  }
}
async function waitHealthy() {
  while (true) {
    const { ok, ms, model } = await probe();
    const healthy = ok && ms < 8000; // 빠른 정상 200만 (저속/다운 구간 회피)
    console.log(`[run] ${ts()} ok=${ok} ${ms}ms model=${model}${healthy ? " ← 정상" : ""}`);
    if (healthy) return;
    await sleep(180000); // 3분
  }
}
function run(version) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["scripts/fix-spacing.mjs", version], {
      stdio: "inherit",
      env: { ...process.env, CONC: process.env.CONC || "12" },
    });
    p.on("close", (code) => resolve(code));
  });
}
function failsOf(version) {
  try { return JSON.parse(readFileSync(`spacing-fix-${version}.json`, "utf8")).fails.length; } catch { return 0; }
}

console.log(`[run] 게이트웨이(claude-haiku) 헬스게이트 수렴 실행 시작 ${ts()} (CONC=${process.env.CONC || "12"})`);
let prevTotal = Infinity;
let noProgress = 0;
let pass = 0;
while (true) {
  await waitHealthy();
  pass++;
  console.log(`[run] === pass ${pass} 시작 ${ts()} ===`);
  await run("easy");
  await waitHealthy();
  await run("rnksv");
  const ef = failsOf("easy");
  const rf = failsOf("rnksv");
  const total = ef + rf;
  console.log(`[run] pass ${pass} 종료 ${ts()} — easy실패 ${ef} rnksv실패 ${rf} (합 ${total})`);
  if (total === 0) { console.log(`[run] ✅ 완료 — 잔여 실패 0 ${ts()}`); break; }
  if (total >= prevTotal) noProgress++; else noProgress = 0;
  prevTotal = total;
  if (noProgress >= 3) { console.log(`[run] ⚠ 수렴 — 3회 연속 미감소 → 종료. 잔여 ${total} ${ts()}`); break; }
}
