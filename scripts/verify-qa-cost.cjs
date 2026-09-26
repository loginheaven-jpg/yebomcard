/** 실제 TS 모듈을 실행. 유료 호출/운영 DB 없이 모델·이전 답·동시 선점을 확인한다. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
function load(file, imports, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const ctx = { exports: {}, console, Date, setTimeout, clearTimeout, AbortController,
    require: (id) => { assert.ok(id in imports, `Unexpected import ${id}`); return imports[id]; }, ...globals };
  vm.runInNewContext(code, ctx);
  return ctx.exports;
}
let requestOptions;
let returnedModel = 'gpt-5.6-luna';
const columns = load('lib/bibleQa/columns.ts', {
  '@/lib/aiGateway': { callAI: async (_messages, options) => {
    requestOptions = options;
    return { model: returnedModel, content: '답', usage: {} };
  } },
});
const format = load('lib/bibleQa/answerFormat.ts', {});
const json = (body, init) => ({ body, status: init?.status ?? 200 });
let row = null;
let asks = 0;
let readError = false;
let release;
let asked;
const question = { id: 1, user_id: 'owner', book_code: 'gen', chapter: 1, verse_start: 1,
  version: 'rnksv', question: '질문', columns: ['gemini', 'luna', 'terra'] };
const db = { from(table) {
  let op = 'select'; let payload; const filters = [];
  const builder = {
    select() { return builder; }, order() { return builder; },
    gte() { return builder; }, lte() { return builder; }, maybeSingle() { return builder; },
    eq(k, v) { filters.push([k, v]); return builder; },
    insert(p) { op = 'insert'; payload = p; return builder; },
    update(p) { op = 'update'; payload = p; return builder; },
    then(resolve, reject) {
      let result = { data: null, error: null };
      if (table === 'ai_questions') {
        result.data = filters.every(([k, v]) => question[k] === v) ? question : null;
      } else if (table === 'ai_question_answers') {
        if (op === 'insert') {
          if (row) result.error = { code: '23505' };
          else { row = { id: 10, ...payload }; result.data = row; }
        } else if (readError && op === 'select') result.error = { message: 'DB down' };
        else if (row && filters.every(([k, v]) => row[k] === v)) {
          if (op === 'update') Object.assign(row, payload);
          result.data = { ...row };
        }
      } else result.data = [];
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
} };
const route = load('app/api/bible-qa/answer/route.ts', {
  'next/server': { NextResponse: { json } },
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'session' }) }) },
  'iron-session': { unsealData: async () => ({ user_id: 'owner', isLoggedIn: true }) },
  '@/lib/auth/session': { sessionOptions: {} },
  '@/lib/supabaseAdmin': { supabaseAdmin: db },
  '@/lib/rateLimit': { rateLimit: () => null },
  '@/lib/versions': { getVersionLabel: () => '새번역' },
  '@/lib/types': { stripNotes: (s) => s },
  '@/lib/bibleQa/prompt': { buildAnswerPrompt: async () => ({ systemPrompt: 'test' }) },
  '@/lib/bibleQa/columns': { ...columns, askColumn: async () => {
    asks++; asked?.();
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, model: 'gpt-5.6-luna', content: '답', providerAlias: 'chatgpt', elapsedMs: 1 };
  } },
  '@/lib/bibleQa/verseRefs': { extractRefs: () => [], stripMissingRefs: (s) => s, verifyRefs: async () => ({ resolved: [], missing: [] }) },
});
const post = (id = 1, column = 'luna') => route.POST({ json: async () => ({ id, column }) });
(async () => {
  assert.equal(columns.columnsFor(false).join(','), 'gemini,luna');
  assert.equal(columns.columnsFor(true).join(','), 'gemini,luna,terra');
  assert.equal(columns.answerLabel('claude', 'claude-sonnet-5'), 'Claude');
  assert.equal(columns.answerLabel('chatgpt', 'gpt-5.6-terra'), 'GPT Terra');
  assert.equal(columns.columnOf('claude').provider, 'claude-sonnet');
  for (const key of ['luna', 'terra']) {
    returnedModel = `gpt-5.6-${key}`;
    const answer = await columns.askColumn({ column: columns.columnOf(key), systemPrompt: 'p', question: 'q', useCache: true });
    assert.equal(answer.ok, true);
    assert.equal(requestOptions.model, returnedModel);
    assert.equal(requestOptions.use_fallback, false);
    assert.match(format.handoffUrl(key, '질문'), /^https:\/\/chatgpt.com/);
  }
  returnedModel = 'gpt-5.6-terra';
  assert.equal((await columns.askColumn({ column: columns.columnOf('luna'), systemPrompt: 'p', question: 'q', useCache: true })).ok, false);
  // 첫 모델 호출이 끝나기 전에 두 번째 요청 → 202, 호출은 하나.
  const started = new Promise((resolve) => { asked = resolve; });
  const first = post(); await started;
  assert.equal((await post()).status, 202); assert.equal(asks, 1);
  release(); assert.equal((await first).status, 200);
  assert.equal((await post()).body.cached, true); assert.equal(asks, 1);
  assert.equal((await post(2)).status, 404);
  assert.equal((await post(1, 'claude')).status, 409);
  readError = true; assert.equal((await post()).status, 503); readError = false;
  // 서버 중단으로 남은 임대도 동시에 한 요청만 회수.
  row.error = 'ANSWER_PENDING'; row.created_at = new Date(Date.now() - 160_000).toISOString();
  const reclaimed = new Promise((resolve) => { asked = resolve; });
  const retry = post(); await reclaimed;
  assert.equal((await post()).status, 202); assert.equal(asks, 2);
  release(); assert.equal((await retry).status, 200);
  const keywords = load('lib/keywords.ts', {});
  const gradients = load('lib/gradientBackgrounds.ts', { './keywords': keywords });
  const suggest = load('app/api/unsplash/suggest/route.ts', {
    'next/server': { NextResponse: { json } }, '@/lib/keywords': keywords, '@/lib/rateLimit': { rateLimit: () => null },
  });
  assert.ok((await suggest.POST({ json: async () => ({ verseText: '평안과 사랑' }) })).body.query);
  const background = load('app/api/ai/background/route.ts', {
    'next/server': { NextResponse: { json } }, '@/lib/gradientBackgrounds': gradients,
    '@/lib/rateLimit': { rateLimit: () => null }, '@/lib/aiGateway': { callImage: async () => { throw new Error('image unavailable'); } },
  });
  assert.equal((await background.POST({ json: async () => ({ verseText: '평안', mode: 'gradient' }) })).body.provider, 'local');
  assert.equal((await background.POST({ json: async () => ({ verseText: '평안' }) })).body.type, 'gradient');
  console.log('PASS: 모델 분기/검증, 과거 Claude/이어가기, 동시 요청·임대 회수, 권한/DB 실패, AI 없는 사진 검색어·색상 배경');
})().catch((e) => { console.error(e); process.exitCode = 1; });
