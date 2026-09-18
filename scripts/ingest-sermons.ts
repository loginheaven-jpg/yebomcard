/**
 * 설교 들여오기 — 사람이 손으로 한 번 돌린다 (docs/BIBLE_QA_SERMONS.md §4)
 *
 *   npx tsc -p tsconfig.verify.json
 *   node -r ./scripts/verify-alias.cjs .verify/scripts/ingest-sermons.js
 *   node -r ./scripts/verify-alias.cjs .verify/scripts/ingest-sermons.js --force   # 모두 다시 읽기
 *
 * 무엇이 필요한가
 *  - `.env.local` 의 `GCP_SERVICE_ACCOUNT_JSON`(TTS 가 쓰는 그 열쇠) ·
 *    `NEXT_PUBLIC_SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY`
 *  - 드라이브의 설교 폴더가 **서비스 계정에 보기 권한으로 공유**돼 있어야 한다.
 *    공유되지 않았으면 목록이 0편으로 나온다(오류가 아니다) — 그때는 공유를 먼저 하십시오.
 *
 * 평소에는 이것을 돌릴 일이 없다. 하루 한 번 cron 이 같은 일을 한다.
 * 이 스크립트는 ① 처음 50편을 넣을 때 ② 파서를 고쳐 되돌릴 때 쓴다.
 */
import * as dotenv from "dotenv";
import * as path from "path";

// 저장소 루트의 .env.local 을 읽는다(스크립트는 .verify 안에서 돌아간다).
dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local") });

async function main() {
  const force = process.argv.includes("--force");

  // env 를 읽은 **뒤에** 불러온다 — supabaseAdmin 이 모듈 평가 때 키를 본다.
  const { ingestSermons } = await import("@/lib/sermons/ingest");

  console.log(`설교 들여오기 시작${force ? " (force — 모두 다시 읽는다)" : ""}`);
  const result = await ingestSermons({
    trigger: "manual",
    force,
    onProgress: (line) => console.log("  " + line),
  });

  console.log("");
  console.log(`찾음 ${result.scanned} · 새로 ${result.inserted} · 고침 ${result.updated} · 건너뜀 ${result.skipped}`);
  console.log(`${(result.elapsedMs / 1000).toFixed(1)}초`);

  if (result.error) {
    console.error(`\n멈춤: ${result.error}`);
    if (result.error.includes("TABLE_MISSING")) {
      console.error("→ scripts/migration-bible-qa.sql 을 먼저 실행해야 합니다.");
    }
    if (result.error.includes("DRIVE_LIST_FAILED 404") || result.error.includes("403")) {
      console.error("→ 드라이브 폴더를 서비스 계정 메일에 보기 권한으로 공유해야 합니다.");
    }
    process.exit(1);
  }

  if (result.scanned === 0) {
    console.log("\n한 편도 찾지 못했습니다. 폴더가 서비스 계정에 공유됐는지 확인하십시오.");
  }

  if (result.failures.length > 0) {
    console.log(`\n못 읽은 파일 ${result.failures.length}개 — 버리지 않고 남겼습니다:`);
    for (const f of result.failures) {
      console.log(`  × ${f.file}: ${f.reason}${f.detail ? ` (${f.detail})` : ""}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
