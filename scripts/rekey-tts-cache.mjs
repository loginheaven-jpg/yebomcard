/**
 * 본문 정정으로 키가 바뀐 TTS 공유 캐시를 새 키로 옮긴다.
 *
 *   node scripts/rekey-tts-cache.mjs <계획파일> [--apply]
 *   node scripts/rekey-tts-cache.mjs scripts/data/rnksv-paren-fix.json --apply
 *
 * 왜 필요한가
 *   공유 캐시는 콘텐츠 주소화다 — 키가 `tts/v1/ko/{성우}/{sha1(주석 제거 본문)}.mp3`.
 *   그래서 본문을 한 글자만 고쳐도 키가 달라지고, 기존 음원은 아무도 찾지 않는 고아가 된다.
 *   다음에 그 절을 재생하면 캐시 미스 → 다시 합성(또는 스튜디오 재생성)이다.
 *
 *   그런데 **정정 내용이 낭독에 영향을 주지 않는 경우가 대부분이다.** 스튜디오는 생성 전에
 *   `prosody.clean_for_tts` 로 끝의 고아 괄호를 이미 떼고 읽었기 때문이다. 즉 그때 읽은 문장이
 *   정정본과 글자 단위로 같다. 그런 절은 다시 만들 이유가 없다 — 키만 옮기면 된다.
 *
 *   반대로 각주 본문이 절 안에 남아 있던 절은 그 각주를 **소리 내어 읽었으므로** 옮기면 안 된다.
 *   그 음원은 고아로 두고 다시 만들어야 한다. 이 판정은 build-plan 단계에서 끝내고,
 *   이 스크립트는 옮겨도 되는 것만 받는다.
 *
 * 안전
 *   - 복사만 한다. 옛 키는 지우지 않는다(고아는 무해하다 — 아무 본문의 해시와도 맞지 않는다).
 *   - 새 키에 이미 있으면 건너뛴다.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");
const PLAN_FILE = process.argv[2];
if (!PLAN_FILE || PLAN_FILE.startsWith("--")) {
  console.error("사용법: node scripts/rekey-tts-cache.mjs <계획파일> [--apply]");
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const BUCKET = env.R2_BUCKET;
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

/** lib/tts/verseText.ts · voice/engine.py 와 문자 단위로 같아야 한다 */
const NOTE_RE = /\s*\(\s*주\s*[:：][\s\S]*$/;
const cleanForTts = (t) => t.replace(NOTE_RE, "").trim() || t;
const keyOf = (text, voiceKey = "f4") =>
  `tts/v1/ko/${voiceKey}/${crypto.createHash("sha1").update(text).digest("hex")}.mp3`;

/**
 * voice/prosody.py strip_orphan_paren 과 같은 규칙.
 * 끝의 짝 없는 ')' 하나만, 지워서 문장이 완결될 때만 뗀다.
 */
const SENT_END = /[.!?]["”]?$/;
function strayClose(t) {
  let d = 0, s = 0;
  for (const ch of t) {
    if (ch === "(") d++;
    else if (ch === ")") d ? d-- : s++;
  }
  return s;
}
function stripOrphanParen(text) {
  const t = (text || "").replace(/\s+$/, "");
  if (!t.endsWith(")")) return text;
  const cut = t.slice(0, -1).replace(/\s+$/, "");
  return strayClose(cut) === 0 && SENT_END.test(cut) ? cut : text;
}
/** 생성 당시 실제로 읽은 문장 */
const spokenOf = (dbText) =>
  stripOrphanParen(cleanForTts(dbText)).replace(/\s+/g, " ").trim();

const head = async (Key) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key }));
    return true;
  } catch {
    return false;
  }
};

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, PLAN_FILE), "utf8"));
  console.log(`계획 ${PLAN_FILE} — ${plan.apply.length}건`);
  console.log(APPLY ? "모드: 실제 복사\n" : "모드: dry-run. --apply 로 실행\n");

  let copied = 0, skipSame = 0, skipSpoken = 0, skipNoSrc = 0, skipDone = 0;
  for (const item of plan.apply) {
    const oldKey = keyOf(cleanForTts(item.before));
    const newKey = keyOf(cleanForTts(item.after));
    if (oldKey === newKey) { skipSame++; continue; }

    // **핵심 판정** — 그때 읽은 문장이 정정본과 같은가. 다르면 옮기면 안 된다.
    if (spokenOf(item.before) !== spokenOf(item.after)) { skipSpoken++; continue; }

    if (await head(newKey)) { skipDone++; continue; }
    if (!(await head(oldKey))) { skipNoSrc++; continue; }

    if (APPLY) {
      await s3.send(new CopyObjectCommand({
        Bucket: BUCKET,
        Key: newKey,
        CopySource: `${BUCKET}/${oldKey}`,
      }));
    }
    copied++;
    if (copied % 25 === 0) console.log(`  ${copied}건`);
  }

  console.log(`\n${APPLY ? "복사" : "복사 가능"} ${copied}건`);
  console.log(`  건너뜀 — 낭독 내용이 달라 재생성 필요 ${skipSpoken}건`);
  console.log(`  건너뜀 — 옛 키에 음원 없음(미생성/보류) ${skipNoSrc}건`);
  console.log(`  건너뜀 — 새 키에 이미 있음 ${skipDone}건`);
  console.log(`  건너뜀 — 키가 안 바뀜 ${skipSame}건`);
  console.log(`\n옛 키의 고아는 지우지 않는다 — 어떤 본문의 해시와도 맞지 않아 무해하다.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
