/**
 * 말씀의삶 단계 4 인수 확인 — 계정 2개로 생성 → 참여 → 순위.
 *
 *   npx next build && npx next start -p 3100        (다른 터미널)
 *   node scripts/verify-reading-groups.mjs
 *   node scripts/verify-reading-groups.mjs --keep   # 테스트 데이터 남김
 *
 * 왜 이렇게 하는가
 *   그룹은 세션이 있어야 아무것도 못 한다. 그래서 iron-session 으로 실제 서버가 여는 것과
 *   같은 쿠키를 두 개 만들어 붙인다(SESSION_SECRET 을 그대로 쓴다).
 *   순위는 진도에서 파생되므로 두 계정에 서로 다른 회차만큼 reading_progress 를 넣고,
 *   **회차 수가 같은 세 번째 계정**을 넣어 동률 정렬이 이름순인지까지 본다.
 *
 * 확인 항목
 *   1. 생성 — 초대코드 6자리, 생성자 자동 참여
 *   2. 참여 — 대소문자·하이픈 무시, 없는 코드 404
 *   3. 순위 — 완료 회차 내림차순, 동률은 이름 가나다순, 동점은 같은 등수
 *   4. 격리 — 멤버가 아닌 계정의 standings 는 403
 *   5. 탈퇴 — 다른 멤버가 있으면 생성자 탈퇴 거부, 마지막 멤버면 그룹 삭제
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sealData } from "iron-session";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BASE = process.env.BASE || "http://localhost:3100";
const KEEP = process.argv.includes("--keep");

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = env.SESSION_SECRET;
if (!SB || !KEY || !SECRET) {
  console.error(".env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SESSION_SECRET 이 필요합니다");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// 이름을 일부러 가나다 역순으로 준다 — 동률이 이름순으로 뒤집히는지 보려면 이래야 한다.
const USERS = [
  { id: "__grp_test_a__", name: "가유진" },
  { id: "__grp_test_b__", name: "나서준" },
  { id: "__grp_test_c__", name: "다혜원" },
  { id: "__grp_test_x__", name: "라비회원" }, // 어느 그룹에도 안 넣는다
];

async function cookieFor(u) {
  const sealed = await sealData(
    {
      user_id: u.id,
      name: u.name,
      email: `${u.id}@test.local`,
      permission_level: "user",
      is_approved: true,
      member_id: null,
      group_id: null,
      group_role: null,
      finance_role: "none",
      isLoggedIn: true,
    },
    { password: SECRET },
  );
  return `saint_record_session=${sealed}`;
}

async function api(cookie, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const sbGet = (q) => fetch(`${SB}/rest/v1/${q}`, { headers: H }).then((r) => r.json());
const sbDel = (q) => fetch(`${SB}/rest/v1/${q}`, { method: "DELETE", headers: H });

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * 진도 심기 — 회차 1..n 을 확실히 완료시키려면 그 회차가 덮는 장을 다 넣어야 한다.
 * 여기서는 간단히 reading_unit_checks(종이 체크)로 n 회차를 만든다.
 * 완료 판정 경로가 reading_progress 와 동일하고(computeUnitProgress), 심을 행이 훨씬 적다.
 */
async function seedUnits(userId, n) {
  await sbDel(`reading_unit_checks?user_id=eq.${userId}`);
  if (n === 0) return;
  const rows = Array.from({ length: n }, (_, i) => ({
    user_id: userId,
    plan_id: "yebom91",
    seq: i + 1,
  }));
  const res = await fetch(`${SB}/rest/v1/reading_unit_checks`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`seed 실패 ${await res.text()}`);
}

async function cleanup() {
  const ids = USERS.map((u) => u.id);
  const inList = `in.(${ids.join(",")})`;
  // 그룹은 members 를 지우기 전에 찾아야 한다
  const mine = await sbGet(`reading_group_members?user_id=${inList}&select=group_id`);
  const gids = [...new Set((mine || []).map((m) => m.group_id))];
  await sbDel(`reading_group_members?user_id=${inList}`);
  for (const g of gids) await sbDel(`reading_groups?id=eq.${g}`);
  await sbDel(`reading_unit_checks?user_id=${inList}`);
  // 이름으로 남은 잔여물도 쓸어낸다(생성 도중 죽었을 때)
  await sbDel(`reading_groups?name=like.__grp_test*`);
}

async function main() {
  console.log(`대상 ${BASE}\n`);
  await cleanup();

  const ck = {};
  for (const u of USERS) ck[u.id] = await cookieFor(u);

  // 회차: 나서준 40, 가유진 40(동률), 다혜원 12
  //   → 동률 40 은 이름순으로 '가유진' 이 위여야 한다(먼저 심은 순서가 아니라).
  await seedUnits("__grp_test_b__", 40);
  await seedUnits("__grp_test_a__", 40);
  await seedUnits("__grp_test_c__", 12);

  console.log("1. 생성");
  const created = await api(ck.__grp_test_b__, "POST", "/api/reading-groups", {
    name: "__grp_test 말씀의삶1기",
  });
  check("201/200 생성", created.status === 200, `status=${created.status} ${JSON.stringify(created.json)}`);
  const grp = created.json.group;
  check("초대코드 6자리", !!grp && /^[A-Z0-9]{6}$/.test(grp.inviteCode), grp?.inviteCode);
  check("헷갈리는 문자 없음(O·0·I·1)", !!grp && !/[O0I1]/.test(grp.inviteCode), grp?.inviteCode);
  check("생성자 자동 참여(1명)", grp?.memberCount === 1, String(grp?.memberCount));
  check("isOwner", grp?.isOwner === true);
  if (!grp) return finish();

  const list = await api(ck.__grp_test_b__, "GET", "/api/reading-groups");
  check("내 그룹 목록에 보임", (list.json.groups || []).some((g) => g.id === grp.id));

  console.log("\n2. 참여");
  const lower = await api(ck.__grp_test_a__, "POST", "/api/reading-groups/join", {
    code: grp.inviteCode.toLowerCase(),
  });
  check("소문자 코드로 참여", lower.status === 200, `status=${lower.status}`);
  const hyphen = await api(ck.__grp_test_c__, "POST", "/api/reading-groups/join", {
    code: `${grp.inviteCode.slice(0, 3)}-${grp.inviteCode.slice(3)}`,
  });
  check("하이픈 섞인 코드로 참여", hyphen.status === 200, `status=${hyphen.status}`);
  const dup = await api(ck.__grp_test_a__, "POST", "/api/reading-groups/join", {
    code: grp.inviteCode,
  });
  check("두 번 참여해도 오류 아님", dup.status === 200 && dup.json.already === true);
  const bogus = await api(ck.__grp_test_x__, "POST", "/api/reading-groups/join", {
    code: "ZZZZZZ",
  });
  check("없는 코드 404", bogus.status === 404, `status=${bogus.status}`);

  console.log("\n3. 순위");
  const st = await api(ck.__grp_test_b__, "GET", `/api/reading-groups/${grp.id}/standings`);
  check("200", st.status === 200, `status=${st.status} ${JSON.stringify(st.json)}`);
  const rows = st.json.standings || [];
  check("3명", rows.length === 3, String(rows.length));
  const names = rows.map((r) => `${r.name}:${r.doneCount}(${r.rank})`).join(" ");
  console.log(`     ${names}`);
  check(
    "완료 회차 내림차순",
    rows.every((r, i) => i === 0 || rows[i - 1].doneCount >= r.doneCount),
  );
  check("동률은 이름 가나다순 — 가유진이 나서준보다 위", rows[0]?.name === "가유진", names);
  check("동점은 같은 등수(1,1,3)", rows[0]?.rank === 1 && rows[1]?.rank === 1 && rows[2]?.rank === 3, names);
  check("내 행 표시", rows.filter((r) => r.isMe).length === 1);
  check("myRank 동점 규칙 적용(나서준=1)", st.json.myRank === 1, String(st.json.myRank));

  console.log("\n4. 격리");
  const outsider = await api(ck.__grp_test_x__, "GET", `/api/reading-groups/${grp.id}/standings`);
  check("비멤버 403", outsider.status === 403, `status=${outsider.status}`);
  const anon = await fetch(`${BASE}/api/reading-groups/${grp.id}/standings`);
  check("비로그인 401", anon.status === 401, `status=${anon.status}`);
  const anonList = await fetch(`${BASE}/api/reading-groups`).then((r) => r.json());
  check("비로그인 목록은 빈 배열", Array.isArray(anonList.groups) && anonList.groups.length === 0);

  console.log("\n5. 탈퇴");
  const ownerOut = await api(ck.__grp_test_b__, "POST", `/api/reading-groups/${grp.id}/leave`);
  check("멤버 있으면 생성자 탈퇴 거부 400", ownerOut.status === 400, `status=${ownerOut.status}`);
  const memberOut = await api(ck.__grp_test_c__, "POST", `/api/reading-groups/${grp.id}/leave`);
  check("일반 멤버 탈퇴", memberOut.status === 200 && memberOut.json.deleted === false);
  await api(ck.__grp_test_a__, "POST", `/api/reading-groups/${grp.id}/leave`);
  const lastOut = await api(ck.__grp_test_b__, "POST", `/api/reading-groups/${grp.id}/leave`);
  check("마지막 멤버 탈퇴 = 그룹 삭제", lastOut.status === 200 && lastOut.json.deleted === true, JSON.stringify(lastOut.json));
  const gone = await sbGet(`reading_groups?id=eq.${grp.id}&select=id`);
  check("DB 에서도 사라짐", Array.isArray(gone) && gone.length === 0);

  await finish();
}

async function finish() {
  if (!KEEP) {
    await cleanup();
    const left = await sbGet(`reading_group_members?user_id=in.(${USERS.map((u) => u.id).join(",")})&select=user_id`);
    console.log(`\n정리 완료 — 남은 테스트 행 ${Array.isArray(left) ? left.length : "?"}개`);
  } else {
    console.log("\n--keep — 테스트 데이터를 남겼습니다");
  }
  console.log(`\n통과 ${pass} / 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
