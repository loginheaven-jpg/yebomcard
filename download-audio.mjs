/**
 * download-audio.mjs
 *
 * 대한성서공회 성경듣기 음원을 장 단위로 다운로드하여
 * Supabase Storage(bible-audio 버킷)에 재호스팅하고
 * bible_audio 테이블에 (version, book_code, chapter, audio_url) 매핑을 적재한다.
 *
 * 실행 위치: 로컬 머신 (개발 컨테이너는 외부 도메인 차단).
 * 저작권: 개인용 묵인(2026-06-01 확인). 기술지원 없음. 대규모 배포 시 별도 라이선스 필요.
 *
 * ─── 사용법 ─────────────────────────────────────────────────────
 *
 * 1) 사전 준비
 *    - bible_audio_create_table.sql 적용 (Supabase SQL Editor)
 *    - Supabase Storage 에 'bible-audio' 버킷 생성 + Public 체크
 *    - .env.local 에 SUPABASE_SERVICE_ROLE_KEY 존재 확인
 *
 * 2) 성우 코드 + 새번역 역본 코드 확인 (1회)
 *    a) 브라우저로 https://www.bskorea.or.kr 접속 → 성경듣기 → 새번역 선택
 *    b) DevTools Network 탭 열고 임의 장 재생
 *    c) 잡힌 mp3 URL 확인 → 패턴 `/data/<VERSION>/<NARRATOR>/k<NARRATOR>_<VERSION>_<BOOK>_<CH>.mp3`
 *       예: `/data/SAE/a/ka_SAE_gen_001.mp3` → VERSION_CODE.rnksv='SAE', NARRATOR='a'
 *    d) 본 파일 상단 RNKSV_CODE / NARRATOR_M / NARRATOR_F 상수 또는 env 로 설정
 *
 * 3) 검증 (1개 URL 로 점검)
 *    node download-audio.mjs --verify nkrv gen 1
 *    → URL · 응답 코드 · 파일 크기 · MP3 헤더 확인 후 종료
 *
 * 4) 전체 다운로드
 *    node download-audio.mjs
 *
 *    옵션:
 *      --version nkrv|rnksv|all    (기본 all)
 *      --book gen|exo|...|all      (기본 all)
 *      --sex m|f                   (기본 m)
 *      --concurrency 4             (기본 4)
 *      --dry-run                   업로드/INSERT 없이 URL 만 확인
 *      --retry-failed              이전 실패 로그(download-audio-failures.log) 만 재시도
 *      --verify <ver> <book> <ch>  단일 장 검증 후 종료
 *
 * 5) 재실행
 *    이미 받은 장은 자동 skip. 중단되어도 안전. 실패한 장은 failures.log 에 누적.
 * ────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── env 로드 ───
const __dirname = dirname(fileURLToPath(import.meta.url));
async function loadDotEnv() {
  const envPath = resolve(__dirname, '.env.local');
  if (!existsSync(envPath)) return;
  const txt = await readFile(envPath, 'utf-8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
await loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'bible-audio';
const FAILURES_LOG = resolve(__dirname, 'download-audio-failures.log');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 없습니다.');
  process.exit(1);
}

// ─── 설정 (확인값) ───
// 예봄 version → 성서공회 역본 코드
const VERSION_CODE = {
  nkrv: process.env.BSK_NKRV_CODE || 'GAE',      // 개역개정 (확인됨)
  rnksv: process.env.BSK_RNKSV_CODE || 'SAE',    // 새번역 (Network 탭에서 voiceAnchor 로 확인 후 교체)
};

// 성우 코드 (Network 탭에서 확인)
const NARRATOR_M = process.env.BSK_NARRATOR_M || 'a';
const NARRATOR_F = process.env.BSK_NARRATOR_F || 'b';

// ─── CLI 파싱 ───
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
}
function flagBool(name) {
  return argv.includes(`--${name}`);
}

const CLI = {
  verify: argv.includes('--verify') ? argv.slice(argv.indexOf('--verify') + 1, argv.indexOf('--verify') + 4) : null,
  version: flag('version') || 'all',
  book: flag('book') || 'all',
  sex: (flag('sex') || 'm').toLowerCase(),
  concurrency: parseInt(flag('concurrency') || '4', 10),
  dryRun: flagBool('dry-run'),
  retryFailed: flagBool('retry-failed'),
};

const NARRATOR = CLI.sex === 'f' ? NARRATOR_F : NARRATOR_M;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── URL 빌더 ───
function buildSourceUrl(versionCode, bookCode, chapter, narrator) {
  const ch = String(chapter).padStart(3, '0');
  // 패턴: /data/<VERSION>/<NARRATOR>/k<NARRATOR>_<VERSION>_<BOOK>_<CH>.mp3
  return `https://www.bskorea.or.kr/data/${versionCode}/${narrator}/k${narrator}_${versionCode}_${bookCode}_${ch}.mp3`;
}

function storagePath(version, bookCode, chapter) {
  const ch = String(chapter).padStart(3, '0');
  return `${version}/${bookCode}/${ch}.mp3`;
}

// ─── 유틸 ───
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { maxAttempts = 3, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          // 일부 서버는 referer 없으면 403
          'User-Agent': 'Mozilla/5.0 (yebomcard download-audio.mjs)',
          'Referer': 'https://www.bskorea.or.kr/',
        },
      });
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastErr;
}

function isLikelyMp3(buf) {
  if (buf.length < 4) return false;
  // ID3v2 tag: 'ID3'
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // MPEG sync: 0xFF 0xFB|0xFA|0xF3|0xF2 ...
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  return false;
}

async function logFailure(entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n';
  await appendFile(FAILURES_LOG, line, 'utf-8').catch(() => {});
}

// ─── DB 헬퍼 ───

// bible_verses 에서 (version 별) 책 → 최대 장 매핑 추출
async function buildTargets(version) {
  // Supabase row limit 우회: 페이지네이션 (default 1000)
  const pageSize = 1000;
  let from = 0;
  const maxChapter = new Map();
  for (;;) {
    const { data, error } = await supabase
      .from('bible_verses')
      .select('book_code, chapter')
      .eq('version', version)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const cur = maxChapter.get(row.book_code) ?? 0;
      if (row.chapter > cur) maxChapter.set(row.book_code, row.chapter);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const targets = [];
  for (const [bookCode, last] of maxChapter) {
    if (CLI.book !== 'all' && CLI.book !== bookCode) continue;
    for (let ch = 1; ch <= last; ch++) {
      targets.push({ bookCode, chapter: ch });
    }
  }
  return targets;
}

async function isAlreadyDone(version, bookCode, chapter) {
  const { data } = await supabase
    .from('bible_audio')
    .select('id')
    .eq('version', version)
    .eq('book_code', bookCode)
    .eq('chapter', chapter)
    .maybeSingle();
  return !!data;
}

// ─── 처리 단위 ───

async function processOne(version, versionCode, bookCode, chapter) {
  if (await isAlreadyDone(version, bookCode, chapter)) return 'skip';

  const srcUrl = buildSourceUrl(versionCode, bookCode, chapter, NARRATOR);

  const res = await fetchWithRetry(srcUrl);
  if (!res.ok) {
    throw new Error(`download ${res.status} ${srcUrl}`);
  }
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length < 1024) {
    throw new Error(`too small (${buf.length}B, ct=${ct}) ${srcUrl}`);
  }
  if (!ct.includes('audio') && !ct.includes('mpeg') && !ct.includes('octet')) {
    throw new Error(`bad content-type "${ct}" ${srcUrl}`);
  }
  if (!isLikelyMp3(buf.subarray(0, 16))) {
    throw new Error(`not mp3 header ${srcUrl}`);
  }

  if (CLI.dryRun) return 'dry-ok';

  const path = storagePath(version, bookCode, chapter);
  const up = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: 'audio/mpeg',
    upsert: true,
  });
  if (up.error) throw up.error;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const ins = await supabase.from('bible_audio').upsert(
    {
      version,
      book_code: bookCode,
      chapter,
      audio_url: pub.publicUrl,
      file_bytes: buf.length,
      narrator: `대한성서공회 (${versionCode}, ${CLI.sex}, ${NARRATOR})`,
    },
    { onConflict: 'version,book_code,chapter' },
  );
  if (ins.error) throw ins.error;

  return 'done';
}

// ─── 동시성 제어 (p-limit 미니 구현) ───
function pLimit(n) {
  const queue = [];
  let active = 0;
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

// ─── 모드: verify ───

async function verifyMode() {
  const [verArg, bookArg, chArg] = CLI.verify;
  if (!verArg || !bookArg || !chArg) {
    console.error('사용법: --verify <version> <book_code> <chapter>');
    console.error('  예:    --verify nkrv gen 1');
    process.exit(2);
  }
  const versionCode = VERSION_CODE[verArg];
  if (!versionCode) {
    console.error(`알 수 없는 version: ${verArg} (nkrv|rnksv)`);
    process.exit(2);
  }
  const ch = parseInt(chArg, 10);
  const url = buildSourceUrl(versionCode, bookArg, ch, NARRATOR);
  console.log(`URL: ${url}`);
  try {
    const res = await fetchWithRetry(url, { maxAttempts: 1 });
    console.log(`status: ${res.status} ${res.statusText}`);
    console.log(`content-type: ${res.headers.get('content-type') || '(none)'}`);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`size: ${buf.length} bytes`);
      console.log(`mp3 header: ${isLikelyMp3(buf.subarray(0, 16)) ? 'OK' : 'FAIL'}`);
      console.log(`first bytes: ${[...buf.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
    } else {
      const txt = (await res.text()).slice(0, 300);
      console.log(`body: ${txt}`);
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

// ─── 모드: retry-failed ───

async function loadFailedTargets() {
  if (!existsSync(FAILURES_LOG)) return [];
  const txt = await readFile(FAILURES_LOG, 'utf-8');
  const seen = new Set();
  const targets = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      const k = `${e.version}/${e.bookCode}/${e.chapter}`;
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push(e);
    } catch {}
  }
  return targets;
}

// ─── 메인 ───

async function runOne(versionCount, kCurrent, version, versionCode, target, startTime, stats) {
  const start = Date.now();
  try {
    const r = await processOne(version, versionCode, target.bookCode, target.chapter);
    if (r === 'done' || r === 'dry-ok') stats.done++;
    else stats.skip++;
    const elapsed = (Date.now() - startTime) / 1000;
    const total = versionCount;
    const remaining = total - kCurrent.value;
    const eta = elapsed > 5 && kCurrent.value > 0 ? Math.round((elapsed / kCurrent.value) * remaining) : 0;
    if (kCurrent.value % 10 === 0 || r === 'done') {
      const tookMs = Date.now() - start;
      console.log(
        `  [${version}] ${kCurrent.value}/${total} ${target.bookCode}${target.chapter} → ${r} (${tookMs}ms) | done=${stats.done} skip=${stats.skip} fail=${stats.fail}${eta ? ` ETA ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}` : ''}`,
      );
    }
  } catch (e) {
    stats.fail++;
    console.warn(`  실패 ${version} ${target.bookCode} ${target.chapter}장: ${e.message}`);
    await logFailure({
      version,
      bookCode: target.bookCode,
      chapter: target.chapter,
      error: e.message,
    });
  }
  kCurrent.value++;
}

async function run() {
  if (CLI.verify) {
    await verifyMode();
    return;
  }

  console.log(
    `설정: version=${CLI.version} book=${CLI.book} sex=${CLI.sex}(narrator=${NARRATOR}) concurrency=${CLI.concurrency}${CLI.dryRun ? ' [DRY-RUN]' : ''}${CLI.retryFailed ? ' [RETRY-FAILED]' : ''}`,
  );
  console.log(`VERSION_CODE: ${JSON.stringify(VERSION_CODE)}`);

  const limit = pLimit(CLI.concurrency);
  const versions =
    CLI.version === 'all'
      ? Object.keys(VERSION_CODE)
      : Object.keys(VERSION_CODE).filter((v) => v === CLI.version);

  if (CLI.retryFailed) {
    const failed = await loadFailedTargets();
    console.log(`재시도 대상 ${failed.length}건`);
    const startTime = Date.now();
    const stats = { done: 0, skip: 0, fail: 0 };
    const kCurrent = { value: 0 };
    await Promise.all(
      failed
        .filter((f) => versions.includes(f.version))
        .map((f) =>
          limit(() =>
            runOne(
              failed.length,
              kCurrent,
              f.version,
              VERSION_CODE[f.version],
              { bookCode: f.bookCode, chapter: f.chapter },
              startTime,
              stats,
            ),
          ),
        ),
    );
    console.log(`재시도 완료 done=${stats.done} skip=${stats.skip} fail=${stats.fail}`);
    return;
  }

  for (const version of versions) {
    const versionCode = VERSION_CODE[version];
    const targets = await buildTargets(version);
    console.log(`\n[${version}] 대상 ${targets.length}장 (versionCode=${versionCode})`);

    const startTime = Date.now();
    const stats = { done: 0, skip: 0, fail: 0 };
    const kCurrent = { value: 0 };
    await Promise.all(
      targets.map((t) =>
        limit(() => runOne(targets.length, kCurrent, version, versionCode, t, startTime, stats)),
      ),
    );
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[${version}] 완료 done=${stats.done} skip=${stats.skip} fail=${stats.fail} (${Math.floor(elapsed / 60)}분 ${elapsed % 60}초)`,
    );
  }
  console.log(`\n전체 완료. 실패 항목은 ${FAILURES_LOG} 참고 후 --retry-failed 로 재시도.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
