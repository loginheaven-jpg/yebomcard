/**
 * upload-bible-audio.mjs
 *
 * 로컬 zip 형태로 보유한 성경 음원(쉬운성경/통독성경 등)을 풀어
 * Supabase Storage(bible-audio 버킷)에 업로드하고
 * bible_audio 테이블에 (version, book_code, chapter, audio_url) 매핑을 적재한다.
 *
 * ─── 사용법 ──────────────────────────────────────────────────
 *
 * 사전 준비
 *   - bible_audio_create_table.sql 적용 완료
 *   - Supabase Storage 에 'bible-audio' 버킷 생성 + Public 체크
 *   - .env.local 에 SUPABASE_SERVICE_ROLE_KEY 존재
 *   - Windows + PowerShell (한글 파일명 zip 압축 해제용 .NET ZipFile API 사용)
 *
 * 단일 zip 시범 업로드 (시편)
 *   node upload-bible-audio.mjs --version easy --zip "bible/쉬운성경(통독성경)_구약성경/19.시편.zip"
 *
 * 책 1권만 (이미 풀린 디렉토리)
 *   node upload-bible-audio.mjs --version easy --dir "C:\\temp\\psa-extracted"
 *
 * 폴더 전체(여러 zip 일괄)
 *   node upload-bible-audio.mjs --version easy --batch "bible/쉬운성경(통독성경)_구약성경"
 *
 * 옵션
 *   --version <ver>     bible_verses.version 값 (예: easy / nkrv / rnksv)
 *   --concurrency <n>   업로드 동시 처리 수 (기본 4)
 *   --dry-run           Storage/DB 변경 없이 매핑만 출력
 *   --overwrite         이미 등록된 (version, book, chapter) 도 덮어쓰기
 * ────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { readdir, readFile, rm, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ─── env 로드 ───
const __dirname = dirname(fileURLToPath(import.meta.url));
async function loadDotEnv() {
  const envPath = resolve(__dirname, '.env.local');
  if (!existsSync(envPath)) return;
  const txt = await readFile(envPath, 'utf-8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
await loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'bible-audio';
const FAILURES_LOG = resolve(__dirname, 'upload-audio-failures.log');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 없습니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── 책명(한글) → book_code 매핑 ───
// lib/books.ts 와 동기화 유지. 한글 책명은 통독성경/공동번역 등 출처에 따라 변형 가능.
const BOOK_BY_KR = {
  // 구약
  '창세기': 'gen',
  '출애굽기': 'exo',
  '레위기': 'lev',
  '민수기': 'num',
  '신명기': 'deu',
  '여호수아': 'jos',
  '사사기': 'jdg',
  '룻기': 'rut',
  '사무엘상': '1sa',
  '사무엘하': '2sa',
  '열왕기상': '1ki',
  '열왕기하': '2ki',
  '역대상': '1ch',
  '역대하': '2ch',
  '에스라': 'ezr',
  '느헤미야': 'neh',
  '느헤미아': 'neh',     // 통독성경 표기 변형
  '에스더': 'est',
  '욥기': 'job',
  '시편': 'psa',
  '잠언': 'pro',
  '전도서': 'ecc',
  '아가': 'sng',
  '이사야': 'isa',
  '예레미야': 'jer',
  '예레미야애가': 'lam',
  '에스겔': 'ezk',
  '다니엘': 'dan',
  '호세아': 'hos',
  '요엘': 'jol',
  '아모스': 'amo',
  '오바댜': 'oba',
  '요나': 'jnh',
  '미가': 'mic',
  '나훔': 'nam',
  '하박국': 'hab',
  '스바냐': 'zep',
  '학개': 'hag',
  '스가랴': 'zec',
  '말라기': 'mal',
  // 신약
  '마태복음': 'mat',
  '마가복음': 'mrk',
  '누가복음': 'luk',
  '요한복음': 'jhn',
  '사도행전': 'act',
  '로마서': 'rom',
  '고린도전서': '1co',
  '고린도후서': '2co',
  '갈라디아서': 'gal',
  '에베소서': 'eph',
  '빌립보서': 'php',
  '골로새서': 'col',
  '데살로니가전서': '1th',
  '데살로니가후서': '2th',
  '디모데전서': '1ti',
  '디모데후서': '2ti',
  '디도서': 'tit',
  '빌레몬서': 'phm',
  '히브리서': 'heb',
  '야고보서': 'jas',
  '베드로전서': '1pe',
  '베드로후서': '2pe',
  '요한일서': '1jn',
  '요한이서': '2jn',
  '요한삼서': '3jn',
  '요한1서': '1jn',
  '요한2서': '2jn',
  '요한3서': '3jn',
  '유다서': 'jud',
  '요한계시록': 'rev',
};

// ─── CLI 파싱 ───
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const val = argv[i + 1];
  return val && !val.startsWith('--') ? val : true;
}
function flagBool(name) {
  return argv.includes(`--${name}`);
}

const CLI = {
  version: flag('version'),
  zip: flag('zip'),
  dir: flag('dir'),
  batch: flag('batch'),
  bookHint: flag('book-hint'),  // 책명 강제 (zip/dir 이름이 깨졌을 때)
  concurrency: parseInt(flag('concurrency') || '4', 10),
  dryRun: flagBool('dry-run'),
  overwrite: flagBool('overwrite'),
};

if (!CLI.version) {
  console.error('--version 필수 (예: easy)');
  process.exit(2);
}
if (!CLI.zip && !CLI.dir && !CLI.batch) {
  console.error('--zip <path> | --dir <path> | --batch <folder> 중 하나 필요');
  process.exit(2);
}

// ─── 유틸 ───

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// PowerShell 로 zip 압축 해제 — .NET ZipFile 은 한글 파일명을 올바르게 처리
function extractZipPS(zipPath, destDir) {
  const psScript = `Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path '${destDir.replace(/'/g, "''")}') { Remove-Item '${destDir.replace(/'/g, "''")}' -Recurse -Force }; New-Item -ItemType Directory -Path '${destDir.replace(/'/g, "''")}' | Out-Null; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${destDir.replace(/'/g, "''")}')`;
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  execSync(`powershell.exe -NoProfile -EncodedCommand ${encoded}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// 파일명에서 한글 책명 + 장 번호 추출
// 패턴 A: "시편01.mp3" / "예레미야애가05.mp3" → 풀네임 책명 + 장
// 패턴 B: "창01.mp3" / "출03.mp3"           → 약자 + 장 (BOOK_BY_KR 미매핑 → fallback 사용)
// 패턴 C: "001편.mp3" / "001장.mp3" / "001.mp3" → 장만 (책명은 fallback 사용)
function parseFilename(filename, fallbackBookKr = null) {
  const base = basename(filename, extname(filename));
  const a = base.match(/^([가-힣]+?)(\d+)$/);
  if (a) {
    // 추출된 한글이 BOOK_BY_KR 매핑에 있으면 그걸 사용, 없으면 (약자 등) fallback 사용
    const bookKr = BOOK_BY_KR[a[1]] ? a[1] : fallbackBookKr;
    if (bookKr) return { bookKr, chapter: parseInt(a[2], 10) };
  }
  const b = base.match(/^(\d+)(?:편|장)?$/);
  if (b && fallbackBookKr) {
    return { bookKr: fallbackBookKr, chapter: parseInt(b[1], 10) };
  }
  return null;
}

// 문자열에서 BOOK_BY_KR 에 등록된 한글 책명을 찾아 반환 (긴 이름 우선 매칭 → "예레미야애가" 가 "예레미야" 보다 먼저)
function extractBookKr(s) {
  const candidates = Object.keys(BOOK_BY_KR).sort((a, b) => b.length - a.length);
  for (const name of candidates) {
    if (s.includes(name)) return name;
  }
  return null;
}

// 재귀로 mp3 파일 경로 모두 수집
async function walkMp3(dir) {
  const out = [];
  async function recurse(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const fp = join(d, e.name);
      if (e.isDirectory()) {
        await recurse(fp);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.mp3')) {
        out.push(fp);
      }
    }
  }
  await recurse(dir);
  return out;
}

async function logFailure(entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n';
  await import('node:fs/promises').then((m) =>
    m.appendFile(FAILURES_LOG, line, 'utf-8').catch(() => {}),
  );
}

// ─── 책 1권 처리 (이미 풀린 디렉토리에서 mp3 순회) ───

async function uploadOneFile(version, bookCode, chapter, fileBuf, fileBytes) {
  const ch = String(chapter).padStart(3, '0');
  const path = `${version}/${bookCode}/${ch}.mp3`;

  // 0바이트 또는 1KB 미만은 손상된 파일로 간주 → 업로드 skip
  if (fileBytes < 1024) {
    throw new Error(`empty/corrupt file (${fileBytes}B)`);
  }

  if (CLI.dryRun) {
    console.log(`  [DRY] would upload ${path} (${(fileBytes / 1024).toFixed(0)}KB)`);
    return 'dry-ok';
  }

  // 이미 등록된 항목 skip (overwrite 옵션 시 진행)
  if (!CLI.overwrite) {
    const { data: existing } = await supabase
      .from('bible_audio')
      .select('id')
      .eq('version', version)
      .eq('book_code', bookCode)
      .eq('chapter', chapter)
      .maybeSingle();
    if (existing) return 'skip';
  }

  // Storage 업로드
  const up = await supabase.storage.from(BUCKET).upload(path, fileBuf, {
    contentType: 'audio/mpeg',
    upsert: true,
  });
  if (up.error) throw up.error;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // bible_audio upsert
  const ins = await supabase.from('bible_audio').upsert(
    {
      version,
      book_code: bookCode,
      chapter,
      audio_url: pub.publicUrl,
      file_bytes: fileBytes,
      narrator: `쉬운성경(통독성경)`,
    },
    { onConflict: 'version,book_code,chapter' },
  );
  if (ins.error) throw ins.error;

  return 'done';
}

async function processDirectory(version, dir, fallbackBookKr = null) {
  const mp3Paths = await walkMp3(dir);
  if (mp3Paths.length === 0) {
    console.log(`  [${dir}] mp3 파일 없음`);
    return { done: 0, skip: 0, fail: 0 };
  }

  // 각 mp3 에 대해 책명 추출 — 우선순위: 파일명 패턴 → 부모 디렉토리명 → 인자 fallback
  const parsed = mp3Paths
    .map((p) => {
      const parentName = basename(dirname(p));
      const dirFallback = extractBookKr(parentName) || fallbackBookKr;
      const meta = parseFilename(basename(p), dirFallback);
      return meta ? { f: p, p: meta } : null;
    })
    .filter(Boolean);

  if (parsed.length === 0) {
    console.warn(`  [${dir}] 파일명 패턴 매칭 실패. 예: ${basename(mp3Paths[0])}`);
    return { done: 0, skip: 0, fail: mp3Paths.length };
  }

  const uniqueBooks = [...new Set(parsed.map((x) => x.p.bookKr))];
  if (uniqueBooks.length > 1) {
    console.log(`  [${dir}] 책 ${uniqueBooks.length}종: ${uniqueBooks.join(', ')}`);
  }

  const limit = pLimit(CLI.concurrency);
  const stats = { done: 0, skip: 0, fail: 0 };
  const total = parsed.length;
  let processed = 0;

  await Promise.all(
    parsed.map(({ f, p }) =>
      limit(async () => {
        const bookCode = BOOK_BY_KR[p.bookKr];
        if (!bookCode) {
          stats.fail++;
          console.warn(`  매핑 없음: 책명 "${p.bookKr}" (파일 ${basename(f)})`);
          await logFailure({
            version,
            file: f,
            bookKr: p.bookKr,
            chapter: p.chapter,
            error: 'unmapped book',
          });
          return;
        }
        try {
          const buf = await readFile(f);
          const r = await uploadOneFile(version, bookCode, p.chapter, buf, buf.length);
          if (r === 'done' || r === 'dry-ok') stats.done++;
          else stats.skip++;
        } catch (e) {
          stats.fail++;
          console.warn(`  실패 ${p.bookKr}${p.chapter}: ${e.message}`);
          await logFailure({
            version,
            bookCode,
            bookKr: p.bookKr,
            chapter: p.chapter,
            file: f,
            error: e.message,
          });
        } finally {
          processed++;
          if (processed % 30 === 0 || processed === total) {
            console.log(
              `  진행 ${processed}/${total} (done=${stats.done} skip=${stats.skip} fail=${stats.fail})`,
            );
          }
        }
      }),
    ),
  );

  return stats;
}

// ─── zip 모드 ───

async function runZip(zipPath) {
  const zipName = basename(zipPath, extname(zipPath));
  const tmpDir = join(tmpdir(), `yebom-audio-${Date.now()}-${zipName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}`);

  console.log(`[zip] ${zipPath}`);
  console.log(`[tmp] ${tmpDir} 에 풀기...`);
  extractZipPS(resolve(zipPath), tmpDir);

  const fallbackBookKr = CLI.bookHint || extractBookKr(zipName);
  if (fallbackBookKr) console.log(`  책명 fallback: "${fallbackBookKr}"${CLI.bookHint ? ' (CLI 강제)' : ' (zip 이름에서 추정)'}`);

  try {
    const t0 = Date.now();
    const stats = await processDirectory(CLI.version, tmpDir, fallbackBookKr);
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(
      `완료 done=${stats.done} skip=${stats.skip} fail=${stats.fail} (${Math.floor(elapsed / 60)}분 ${elapsed % 60}초)`,
    );
  } finally {
    if (!CLI.dryRun) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ─── batch 모드 (디렉토리 안의 모든 zip 순회) ───

async function runBatch(folder) {
  const entries = await readdir(folder);
  const zips = entries.filter((f) => f.toLowerCase().endsWith('.zip')).sort();
  if (zips.length === 0) {
    console.error(`${folder} 에 zip 파일이 없습니다.`);
    return;
  }
  console.log(`[batch] ${folder} — zip ${zips.length}개`);
  const totalStats = { done: 0, skip: 0, fail: 0 };
  for (const z of zips) {
    const zipPath = join(folder, z);
    const zipName = basename(z, extname(z));
    const tmpDir = join(tmpdir(), `yebom-audio-${Date.now()}-${zipName.replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}`);
    const fallbackBookKr = extractBookKr(zipName);
    console.log(`\n[${z}]${fallbackBookKr ? ` (${fallbackBookKr})` : ''} 풀기...`);
    try {
      extractZipPS(resolve(zipPath), tmpDir);
      const s = await processDirectory(CLI.version, tmpDir, fallbackBookKr);
      totalStats.done += s.done;
      totalStats.skip += s.skip;
      totalStats.fail += s.fail;
    } catch (e) {
      console.error(`  [${z}] 실패: ${e.message}`);
    } finally {
      if (!CLI.dryRun) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  console.log(
    `\n전체 완료 done=${totalStats.done} skip=${totalStats.skip} fail=${totalStats.fail}`,
  );
  console.log(`실패 항목: ${FAILURES_LOG}`);
}

// ─── dir 모드 (이미 풀린 디렉토리) ───

async function runDir(dir) {
  const t0 = Date.now();
  const stats = await processDirectory(CLI.version, resolve(dir));
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `완료 done=${stats.done} skip=${stats.skip} fail=${stats.fail} (${Math.floor(elapsed / 60)}분 ${elapsed % 60}초)`,
  );
}

// ─── 메인 ───

async function run() {
  console.log(
    `설정: version=${CLI.version} concurrency=${CLI.concurrency}${CLI.dryRun ? ' [DRY-RUN]' : ''}${CLI.overwrite ? ' [OVERWRITE]' : ''}`,
  );

  if (CLI.zip) {
    await runZip(CLI.zip);
  } else if (CLI.dir) {
    await runDir(CLI.dir);
  } else if (CLI.batch) {
    await runBatch(CLI.batch);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
