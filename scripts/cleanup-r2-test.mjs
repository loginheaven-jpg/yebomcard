// R2 테스트 경로(test64/, test80/) 정리
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
config({ path: ".env.local" });
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const s3 = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } });

for (const prefix of ["test64/", "test80/"]) {
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) keys.push({ Key: o.Key });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  if (keys.length) {
    await s3.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: keys } }));
    console.log(`삭제 ${prefix}: ${keys.length}개`);
  } else console.log(`${prefix}: 없음`);
}
console.log("[OK] 테스트 경로 정리 완료");
