/**
 * 새번역 짝 없는 ')' 잔재 일괄 정정.
 *
 *   node scripts/fix-rnksv-stray-parens.mjs           # dry-run (기본)
 *   node scripts/fix-rnksv-stray-parens.mjs --apply   # 실제 수정
 *   node scripts/fix-rnksv-stray-parens.mjs --restore backup/rnksv-paren-backup-<타임스탬프>.json
 *
 * 왜 필요한가
 *   scripts/restore-rnksv-notes.ts 가 bskorea 를 재크롤링해 각주를 "(주: ...)" 로 붙일 때,
 *   각주 마커("1)" "2)")를 지우는 정규식이 숫자만 먹고 ')' 를 남겼다.
 *   그 결과 새번역 31,075절 중 322절에 여는 괄호 없는 ')' 가 남았다.
 *   다른 역본은 0~26건뿐이라 새번역 고유 문제다.
 *
 *   화면에서도 그대로 보이므로 낭독만의 문제가 아니다. 음원 생성기는 이 절들을
 *   "주석 잔재 의심" 으로 보류하는데, 그것이 보류 큐의 대부분을 차지한다.
 *
 * 왜 일괄 ')' 삭제가 아닌가
 *   322건 중 ')' 하나만 지우면 되는 것은 230건뿐이다.
 *     - 89건은 각주 **본문**이 절 안으로 흘러들어왔다. ')' 만 지우면 각주 문장이
 *       성경 본문으로 남는다. 예: 시편 119:1 "…복이 있다.으로 시작됨)"
 *     - 3건은 **정상 본문**이다. 여는 괄호가 앞 절에 있는 절 경계 괄호다.
 *       예: 사사기 20:27 "…(그 때는 언약궤가 베델에 있었고," / 20:28 "…때였다.) …"
 *       지우면 멀쩡한 본문이 깨진다.
 *
 * 판정 근거
 *   scripts/data/rnksv-paren-fix.json — 절마다 before/after/판정/근거.
 *   16개 에이전트가 8덩이로 나눠 판정하고 각 덩이를 적대적으로 재검증한 결과다.
 *
 * 안전장치
 *   - **삭제만 한다.** after 는 반드시 before 의 부분수열이어야 한다(글자 생성 금지).
 *   - 수정 후 괄호 균형이 맞아야 한다.
 *   - 적용 전 현재 DB 본문을 backup/ 에 통째로 저장한다. --restore 로 되돌린다.
 *   - DB 에 담긴 현재 본문이 before 와 다르면 그 절은 건너뛴다(그 사이 누가 고쳤다는 뜻).
 *
 * 부수 효과
 *   본문이 바뀌면 sha1 이 바뀌므로 그 절의 TTS 공유 캐시가 자동 무효화된다.
 *   기존 음원은 옛 키에 남아 고아가 되고, 다음 생성 때 새 키로 다시 만들어진다.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");
const RESTORE_IDX = process.argv.indexOf("--restore");
const RESTORE = RESTORE_IDX >= 0 ? process.argv[RESTORE_IDX + 1] : null;
// 정정 묶음은 여러 개다(짝 없는 ')' / 절 안에 박힌 소제목 …). 같은 안전장치를 공유한다.
const PLAN_IDX = process.argv.indexOf("--plan");
const PLAN_FILE = PLAN_IDX >= 0 ? process.argv[PLAN_IDX + 1] : "scripts/data/rnksv-paren-fix.json";

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error(".env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const norm = (s) => (s || "").replace(/\s+/g, "");

/** after 가 before 에서 글자를 빼기만 해서 나오는가 */
function isSubsequence(small, big) {
  let i = 0;
  for (const ch of big) if (i < small.length && ch === small[i]) i++;
  return i === small.length;
}

/**
 * 편집자 주석 — 서버(lib/tts/verseText.ts)·스튜디오(voice/engine.py)와 문자 단위로 같은 규칙.
 * "(주:" 부터 절 끝까지가 주석이며 닫는 괄호 유무와 무관하다.
 */
const NOTE_RE = /\s*\(\s*주\s*[:：][\s\S]*$/;

/** [짝 없는 닫힘, 안 닫힌 열림] */
function parenBalance(t) {
  let depth = 0, stray = 0;
  for (const ch of t) {
    if (ch === "(") depth++;
    else if (ch === ")") depth ? depth-- : stray++;
  }
  return [stray, depth];
}

async function getVerse(book, chapter, verse) {
  const q = `${URL_}/rest/v1/bible_verses?version=eq.rnksv&book_code=eq.${book}&chapter=eq.${chapter}&verse=eq.${verse}&select=id,text`;
  const rows = await fetch(q, { headers: H }).then((r) => r.json());
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function setVerse(id, text) {
  const res = await fetch(`${URL_}/rest/v1/bible_verses?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`복원 ${backup.rows.length}건 — ${file}`);
  let n = 0;
  for (const r of backup.rows) {
    await setVerse(r.id, r.text);
    n++;
    if (n % 50 === 0) console.log(`  ${n}/${backup.rows.length}`);
  }
  console.log(`복원 완료 ${n}건`);
}

async function main() {
  if (RESTORE) return restore(RESTORE);

  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, PLAN_FILE), "utf8"));
  console.log(`계획 파일: ${PLAN_FILE}`);
  console.log(`계획 ${plan.apply.length}건 적용 · ${plan.skip.length}건 제외 (${plan.source})`);
  console.log(APPLY ? "모드: 실제 적용\n" : "모드: dry-run (실제 수정 없음). --apply 로 실행\n");

  const ok = [];
  const drift = [];
  const blocked = [];

  for (const item of plan.apply) {
    // 안전장치 — 계획 자체를 다시 검사한다. 파일이 손상되었을 수도 있다.
    if (!isSubsequence(norm(item.after), norm(item.before))) {
      blocked.push({ ...item, why: "삭제만 하지 않음" });
      continue;
    }
    // 괄호 균형은 **주석을 뗀 성경 본문**에서만 따진다.
    // "(주: 히, '발랄(뒤섞다)" 처럼 닫는 괄호가 유실된 주석이 따로 91건 있는데,
    // 그것은 낭독에서 제외되는 표기상 문제라 이번 정정의 대상이 아니다.
    const [stray, open] = parenBalance(item.after.replace(NOTE_RE, ""));
    if (stray || open) {
      blocked.push({ ...item, why: `수정 후 본문 괄호 불균형 ${stray}/${open}` });
      continue;
    }
    const row = await getVerse(item.book, item.chapter, item.verse);
    if (!row) {
      blocked.push({ ...item, why: "DB 에 해당 절이 없음" });
      continue;
    }
    if (norm(row.text) !== norm(item.before)) {
      // 판정한 이후 본문이 바뀌었다 — 사람이 봐야 한다
      drift.push({ ...item, db: row.text });
      continue;
    }
    if (APPLY) await setVerse(row.id, item.after);
    ok.push({ id: row.id, ...item });
    if (ok.length % 50 === 0) console.log(`  ${ok.length}/${plan.apply.length}`);
  }

  if (APPLY && ok.length) {
    const dir = path.join(ROOT, "backup");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tag = path.basename(PLAN_FILE, ".json");
    const file = path.join(dir, `${tag}-backup-${stamp}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ note: "정정 전 원본 본문", rows: ok.map((o) => ({ id: o.id, ref: o.ref, text: o.before })) }, null, 1),
    );
    console.log(`\n백업 저장: ${path.relative(ROOT, file)}`);
  }

  console.log(`\n${APPLY ? "적용" : "적용 가능"} ${ok.length}건`);
  const byVerdict = {};
  for (const o of ok) byVerdict[o.verdict] = (byVerdict[o.verdict] || 0) + 1;
  console.log(`  ${JSON.stringify(byVerdict)}`);
  if (drift.length) {
    console.log(`\n건너뜀 — 판정 이후 본문이 바뀜 ${drift.length}건`);
    for (const d of drift.slice(0, 10)) console.log(`  ${d.ref}`);
  }
  if (blocked.length) {
    console.log(`\n차단 ${blocked.length}건`);
    for (const b of blocked) console.log(`  ${b.ref} — ${b.why}`);
  }
  console.log(`\n제외(판정: 손대지 않음) ${plan.skip.length}건`);
  for (const s of plan.skip) console.log(`  ${s.ref} [${s.verdict}]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
