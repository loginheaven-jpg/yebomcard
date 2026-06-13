// 한국어 성경 본문 띄어쓰기 AI 교정 (gemini-flash via AI Gateway) + 무변경 검증 가드 + 재시도.
// 교정하는 즉시 DB(bible_verses.text)에 반영(inline) → 중간에 멈춰도 손실 최소. 재실행하면 이어서.
//
// 실행:  node scripts/fix-spacing.mjs <easy|rnksv> [--limit=N]
//   - 각 절: AI 교정 → 검증(공백 외 글자 동일) → 바뀌었으면 즉시 DB UPDATE.
//   - 변경/실패/처리한 id 를 spacing-fix-<version>.json 에 500마다 체크포인트(감사·재개용).
//   - 재실행: 이미 처리한 절 건너뜀 + 이전 로그의 미반영(applied=false) 변경분을 시작 시 DB 반영.
//
// 안전장치: norm(원본)===norm(교정) 일 때만 채택 → 글자·문장부호·내용 0 변경. 잘림(preview)은 재시도 5회.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFileSync, readFileSync, existsSync } from "fs";
config({ path: ".env.local" });

const version = process.argv[2];
const limArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limArg ? parseInt(limArg.split("=")[1]) : 0;
if (!["easy", "rnksv"].includes(version)) {
  console.error("usage: node scripts/fix-spacing.mjs <easy|rnksv> [--limit=N]");
  process.exit(1);
}

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// 직접 Anthropic Claude Haiku 호출 (게이트웨이 우회). 키: .env.local 의 claude-haiku-4-5.
const ANTHROPIC_KEY = process.env["claude-haiku-4-5"] || process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
if (!ANTHROPIC_KEY) {
  console.error("[FATAL] Anthropic 키 없음 — .env.local 의 claude-haiku-4-5 확인");
  process.exit(1);
}
const SYS =
  "너는 한국어 성경 본문의 띄어쓰기만 표준 맞춤법으로 교정하는 도구다. 규칙: (1) 공백(띄어쓰기)만 고친다. " +
  "(2) 글자·문장부호·숫자·괄호·따옴표·내용은 절대 바꾸지 않는다(추가·삭제·수정 금지). " +
  "(3) 고유명사와 조사는 붙여 쓴다(예: '아브라함 의'→'아브라함의'). " +
  "(4) 붙은 단어와 문장부호 뒤는 띄운다(예: '아들인셈과'→'아들인 셈과', '이러합니다.홍수가'→'이러합니다. 홍수가'). " +
  "(5) 설명·따옴표 없이 교정된 본문만 출력한다.";
const norm = (s) => s.replace(/\s/g, "");
const CONC = Number(process.env.CONC) || 12;
const logFile = `spacing-fix-${version}.json`;

async function once(text) {
  // 직접 Anthropic Claude Haiku 호출. 멈춤 방지 30s 타임아웃 → abort 후 재시도.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, temperature: 0, system: SYS, messages: [{ role: "user", content: text }] }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return ((j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "").trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function fix(text) {
  for (let i = 0; i < 5; i++) {
    const c = await once(text);
    if (c && norm(c) === norm(text)) return c;
  }
  return null;
}
async function dbUpdate(id, after) {
  for (let i = 0; i < 3; i++) {
    const { error } = await supa.from("bible_verses").update({ text: after }).eq("id", id);
    if (!error) return true;
  }
  return false;
}

// 전체 절 수집
const rows = [];
const page = 1000;
for (let from = 0; ; from += page) {
  const { data, error } = await supa
    .from("bible_verses").select("id,book_code,chapter,verse,text")
    .eq("version", version).order("id", { ascending: true }).range(from, from + page - 1);
  if (error) throw error;
  rows.push(...data);
  if (data.length < page) break;
  if (LIMIT && rows.length >= LIMIT) break;
}
const all = LIMIT ? rows.slice(0, LIMIT) : rows;

// 재개: 기존 로그 로드
const changes = [], fails = [];
const processedIds = new Set();
if (existsSync(logFile)) {
  try {
    const prev = JSON.parse(readFileSync(logFile, "utf-8"));
    // 이전 실패는 재시도 대상 — processedIds 에 넣지 않고 fails 도 새로 시작(회복 구간마다 수렴)
    const prevFailIds = new Set((prev.fails || []).map((f) => f.id));
    (prev.changes || []).forEach((c) => { changes.push(c); processedIds.add(c.id); });
    (prev.processedIds || []).forEach((id) => { if (!prevFailIds.has(id)) processedIds.add(id); });
    console.log(`[RESUME] 처리(성공/무변경) ${processedIds.size}, 변경 ${changes.length}, 재시도(이전 실패) ${prevFailIds.size}`);
  } catch { /* 손상 로그 무시 */ }
}

function save() {
  writeFileSync(logFile, JSON.stringify({
    version, total: all.length, processed: processedIds.size,
    changed: changes.length, failed: fails.length,
    changes, fails, processedIds: [...processedIds],
  }, null, 2));
}

// 시작 시: 이전 로그의 미반영(applied!=true) 변경분을 DB에 먼저 반영 (dry-run 단계 산출분 흡수)
const unapplied = changes.filter((c) => !c.applied);
if (unapplied.length) {
  console.log(`[APPLY-PENDING] 미반영 변경 ${unapplied.length}건 DB 반영...`);
  let n = 0;
  for (const c of unapplied) { if (await dbUpdate(c.id, c.after)) c.applied = true; if (++n % 500 === 0) { save(); console.log(`  ${n}/${unapplied.length}`); } }
  save();
  console.log(`[APPLY-PENDING] 완료`);
}

const work = all.filter((r) => !processedIds.has(r.id));
console.log(`[INFO] ${version} 전체 ${all.length} / 남은 ${work.length}, conc ${CONC}, inline DB 반영`);

let done = 0;
const queue = [...work];
async function worker() {
  while (queue.length) {
    const row = queue.shift();
    const fixed = await fix(row.text);
    if (fixed == null) {
      // 실패 — processedIds 에 넣지 않음 → 다음 회복 구간에 재처리(영구 실패 방지)
      fails.push({ id: row.id, ref: `${row.book_code} ${row.chapter}:${row.verse}`, text: row.text });
    } else {
      if (fixed !== row.text) {
        const ok = await dbUpdate(row.id, fixed);
        changes.push({ id: row.id, ref: `${row.book_code} ${row.chapter}:${row.verse}`, before: row.text, after: fixed, applied: ok });
        if (!ok) console.error(`[DB-FAIL] ${row.id}`);
      }
      processedIds.add(row.id); // 성공/무변경만 처리완료
    }
    done++;
    if (done % 500 === 0) {
      save();
      console.log(`[PROG] +${done}/${work.length} (누적처리 ${processedIds.size}) ch=${changes.length} f=${fails.length}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
save();

const unchanged = processedIds.size - changes.length;
const notApplied = changes.filter((c) => !c.applied).length;
console.log(`\n[DONE] 전체 ${all.length} | 변경(DB반영) ${changes.length}${notApplied ? ` (반영실패 ${notApplied})` : ""} | 정상 ${unchanged} | 실패(재시도대상) ${fails.length}`);
console.log(`[LOG] ${logFile} (감사·롤백용 before/after 보존)`);
