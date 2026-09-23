/** 운영 DB 없이 실제 저장 라우트/클라이언트를 실행한다. node scripts/verify-qa-sharing.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, require: (id) => {
    assert.ok(id in imports, `Unexpected import: ${id}`);
    return imports[id];
  }, ...globals };
  vm.runInNewContext(code, context, { filename: file });
  return context.exports;
}

let replies;
let queries;
let loggedIn = true;
const db = { from(table) {
  const calls = [['from', table]];
  queries.push(calls);
  const builder = {};
  for (const key of ['select', 'update', 'eq', 'maybeSingle']) {
    builder[key] = (...args) => { calls.push([key, ...args]); return builder; };
  }
  builder.then = (resolve, reject) => {
    assert.ok(replies.length, 'Unexpected DB request');
    return Promise.resolve(replies.shift()).then(resolve, reject);
  };
  return builder;
} };
const route = load('app/api/bible-qa/saved/route.ts', {
  'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
  'next/headers': { cookies: async () => ({ get: () => loggedIn ? { value: 'test' } : undefined }) },
  'iron-session': { unsealData: async () => ({ isLoggedIn: true, user_id: 'owner' }) },
  '@/lib/auth/session': { sessionOptions: { cookieName: 'test', password: 'test' } },
  '@/lib/supabaseAdmin': { supabaseAdmin: db },
});

async function post(body, results, status) {
  replies = results.slice();
  queries = [];
  const response = await route.POST({ json: async () => ({ id: 1, ...body }) });
  assert.equal(response.status, status);
  assert.equal(replies.length, 0);
  for (const query of queries) {
    assert.ok(query.some(([key, col, value]) => key === 'eq' && col === 'user_id' && value === 'owner'));
  }
  return response;
}

(async () => {
  const allowed = { data: { is_crisis: false, gate_result: 'allow' }, error: null };
  const updated = { data: { id: 1 }, error: null };
  const missing = { data: null, error: { code: '42703', message: 'column shared does not exist' } };
  // 원인 재현: 공유 칸 없음 → 503, 개인 저장으로 몰래 바꾸지 않는다.
  await post({ saved: true, shared: true }, [allowed, missing], 503);
  assert.equal(queries.length, 2);
  const success = await post({ saved: true, shared: true }, [allowed, updated], 200);
  assert.equal(success.body.shared, true);
  await post({ saved: true, shared: false }, [missing, updated], 200);
  await post({ saved: false }, [updated], 200);
  await post({ saved: true }, [{ data: null, error: { message: 'unavailable' } }], 500);
  await post({ saved: true }, [{ data: null, error: null }], 404);
  await post({ saved: false }, [{ data: null, error: null }], 404);
  for (const row of [{ is_crisis: true }, { gate_result: 'crisis' }, { gate_result: 'deny' }]) {
    await post({ saved: true }, [{ data: row, error: null }], 409);
  }
  loggedIn = false;
  await post({ saved: true }, [], 401);

  let responseBody;
  const client = load('lib/bibleQa/client.ts', {}, {
    fetch: async () => ({ ok: true, json: async () => responseBody }),
  });
  responseBody = { success: true, saved: true, shared: false };
  assert.equal(await client.setQaSaved(1, true, true), false, '개인 저장 응답을 공개 성공으로 표시하면 안 됨');
  assert.equal(await client.setQaSaved(1, true, false), true);
  responseBody = { success: true, saved: true, shared: true };
  assert.equal(await client.setQaSaved(1, true, true), true);
  responseBody = { success: true, saved: false, shared: false };
  assert.equal(await client.setQaSaved(1, false), true);
  console.log('PASS: 공유 스키마 누락, 공개/비공개 저장, 저장 해제, 소유자/로그인, 위기/거절, 클라이언트 응답 일치');
})().catch((error) => { console.error(error); process.exitCode = 1; });
