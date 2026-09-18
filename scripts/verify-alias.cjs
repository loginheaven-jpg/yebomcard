/**
 * `@/` 별칭을 node 가 알아보게 한다.
 *
 * tsc 는 `@/` 를 **타입 검사에만** 쓰고 내보낸 JS 의 import 경로는 그대로 둔다.
 * 그래서 `node .verify/…` 로 돌리면 `Cannot find module '@/lib/...'` 가 난다.
 * 저장소 코드를 상대 경로로 바꾸는 것보다(관습이 `@/` 다) 여기서 한 번 풀어 주는 편이 낫다.
 *
 *   npx tsc -p tsconfig.verify.json
 *   node -r ./scripts/verify-alias.cjs .verify/scripts/<이름>.js
 */
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..", ".verify");
const original = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    return original.call(this, path.join(ROOT, request.slice(2)), ...rest);
  }
  return original.call(this, request, ...rest);
};
