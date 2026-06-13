// 게이트웨이(gemini-flash) 회복을 폴링하다 정상화되면 띄어쓰기 교정을 자동 재개.
// 회복 판정: provider gemini-flash 호출이 200 + 응답 model 이 gemini 계열(=폴백 gpt-5.1 아님).
// 회복 시 easy(체크포인트 이어서) → rnksv 순으로 CONC=16 실행. 일회성 운영 스크립트(미커밋).
import { spawn } from "child_process";
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

async function probe() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const start = Date.now();
  try {
    const r = await fetch(GW, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: PAYLOAD,
      signal: ctrl.signal,
    });
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

function run(version) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["scripts/fix-spacing.mjs", version], {
      stdio: "inherit",
      env: { ...process.env, CONC: "16" },
    });
    p.on("close", (code) => resolve(code));
  });
}

console.log(`[autoresume] 시작 ${ts()} — 게이트웨이 gemini-flash 회복 대기(3분 간격 폴링)`);
let n = 0;
while (true) {
  const { ok, ms, model } = await probe();
  n++;
  const healthy = ok && /gemini/i.test(model) && ms < 8000;
  console.log(`[autoresume] #${n} ${ts()} ok=${ok} ${ms}ms model=${model}${healthy ? " ← 회복" : ""}`);
  if (healthy) {
    console.log(`[autoresume] easy 재개(CONC=16)…`);
    await run("easy");
    console.log(`[autoresume] easy 종료 → rnksv 시작(CONC=16)…`);
    await run("rnksv");
    console.log(`[autoresume] 완료 — easy·rnksv 교정 종료 ${ts()}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 180000));
}
