// R2(attached) 음원 적재 검증: prefix(web/easy/nkrv)별 객체수·용량 합계
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { config } from "dotenv";
config({ path: ".env.local" });

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const stats = {};
let token;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token, MaxKeys: 1000 }));
  for (const o of r.Contents || []) {
    const p = o.Key.split("/")[0];
    (stats[p] ??= { count: 0, bytes: 0 }).count++;
    stats[p].bytes += o.Size;
  }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);

let total = 0, totalCount = 0;
for (const [p, s] of Object.entries(stats).sort()) {
  console.log(`${p.padEnd(10)} ${String(s.count).padStart(6)} files   ${(s.bytes / 1e9).toFixed(2)} GB`);
  total += s.bytes; totalCount += s.count;
}
console.log("-".repeat(34));
console.log(`${"TOTAL".padEnd(10)} ${String(totalCount).padStart(6)} files   ${(total / 1e9).toFixed(2)} GB  (R2 무료 10GB)`);
