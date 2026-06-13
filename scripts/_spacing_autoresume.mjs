// fix-spacing.mjs(현재 게이트웨이 claude-haiku 경유)로 easy·rnksv 를 잔여 실패 0 까지 수렴 실행.
// 각 pass: easy(체크포인트 이어서·실패 재시도) → rnksv → 잔여 실패 집계.
// 잔여 0 이면 완료, 3회 연속 미감소면 영구 실패 추정 종료. pass 사이 20s(rate-limit 창 완화).
// 일회성 운영 스크립트.
import { spawn } from "child_process";
import { readFileSync } from "fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);

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

console.log(`[run] 게이트웨이(claude-haiku) 수렴 실행 시작 ${ts()} (CONC=${process.env.CONC || "12"})`);
let prevTotal = Infinity;
let noProgress = 0;
let pass = 0;
while (true) {
  pass++;
  console.log(`[run] === pass ${pass} 시작 ${ts()} ===`);
  await run("easy");
  await run("rnksv");
  const ef = failsOf("easy");
  const rf = failsOf("rnksv");
  const total = ef + rf;
  console.log(`[run] pass ${pass} 종료 ${ts()} — easy실패 ${ef} rnksv실패 ${rf} (합 ${total})`);
  if (total === 0) { console.log(`[run] ✅ 완료 — 잔여 실패 0 ${ts()}`); break; }
  if (total >= prevTotal) noProgress++; else noProgress = 0;
  prevTotal = total;
  if (noProgress >= 3) { console.log(`[run] ⚠ 수렴 — 3회 연속 실패 ${total} 미감소(영구 실패 추정) → 종료 ${ts()}`); break; }
  await sleep(20000);
}
