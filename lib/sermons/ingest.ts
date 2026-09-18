/**
 * 설교 들여오기 — 드라이브의 .txt 를 읽어 색인에 넣는다
 *
 * docs/BIBLE_QA_SERMONS.md §4
 *  - **처음 50 편과 매일 한 편은 같은 일이다.** 파서와 저장을 한 모듈에 두고 들어오는 문만 둘로 한다
 *    (손으로 돌리는 `scripts/ingest-sermons.ts` · 매일 도는 `/api/cron/ingest-sermons`)
 *  - **바뀐 파일만** 들여온다 — 드라이브의 `modifiedTime` 이 표의 `source_modified_at` 보다 새로울 때만
 *  - **못 읽은 파일은 버리지 않고 남긴다**(`sermon_ingest_runs.failures`). 조용히 넘기면 없는 설교가 된다
 *  - 폴더는 지휘부 결정에 따라 **지금 쓰는 폴더**를 그대로 본다. 그 폴더에는 다른 문서도 있으므로
 *    **코드에서 `text/plain` + 이름에 `주일설교` 가 든 것만** 목록에 남기고, 내용도 그것만 내려받는다.
 *    이것은 코드의 약속이지 권한의 담이 아니다 — 문서에 그렇게 적어 두었다.
 */
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getGoogleAccessToken, SCOPE_DRIVE_READONLY } from "@/lib/google/accessToken";
import { parseSermon, type ParsedSermon } from "./parse";

/**
 * 설교 .txt 가 있는 드라이브 폴더. 비밀값이 아니다(폴더 id 만으로는 못 읽는다 —
 * 서비스 계정에 **보기 권한으로 공유**해야 열린다). 폴더를 옮기면 env 로 덮어쓴다.
 */
const FOLDER_ID = process.env.SERMON_DRIVE_FOLDER_ID || "1l2K2CMjvqKl6k7dTfgXM--E_L1dqavlm";

/** 이 이름이 든 .txt 만 설교로 본다. */
const NAME_MUST_CONTAIN = "주일설교";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface IngestFailure {
  file: string;
  reason: string;
  detail?: string;
}

export interface IngestResult {
  scanned: number;
  inserted: number;
  updated: number;
  skipped: number;
  failures: IngestFailure[];
  elapsedMs: number;
  error?: string;
}

/** 폴더에서 설교 .txt 목록을 가져온다. 페이지가 넘어가면 이어 받는다. */
export async function listSermonFiles(token: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q:
        `'${FOLDER_ID}' in parents and mimeType = 'text/plain' ` +
        `and name contains '${NAME_MUST_CONTAIN}' and trashed = false`,
      fields: "nextPageToken, files(id, name, modifiedTime)",
      pageSize: "200",
      orderBy: "modifiedTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${DRIVE_FILES}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DRIVE_LIST_FAILED ${res.status} ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    for (const f of json.files ?? []) {
      // 서버 질의를 믿지 않고 한 번 더 조인다 — 질의 문법이 바뀌어도 다른 파일이 새지 않게.
      if (typeof f.name === "string" && f.name.includes(NAME_MUST_CONTAIN)) {
        out.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });
      }
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export async function downloadTextFile(id: string, token: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES}/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`DRIVE_GET_FAILED ${res.status}`);
  }
  return res.text();
}

/** 한 편을 표에 넣는다. 같은 날짜+제목이면 덮어쓴다(멱등). */
async function saveSermon(
  sermon: ParsedSermon,
  file: DriveFile,
): Promise<"inserted" | "updated"> {
  const row = {
    preached_on: sermon.preachedOn,
    title: sermon.title,
    preacher: sermon.preacher,
    video_url: sermon.videoUrl,
    summary: sermon.summary,
    applications: sermon.applications.length > 0 ? sermon.applications : null,
    source_file_id: file.id,
    source_name: file.name,
    source_modified_at: file.modifiedTime,
    ingested_at: new Date().toISOString(),
  };

  // SELECT-then-UPDATE/INSERT — 이 저장소 관습(upsert 를 쓰지 않는다).
  const { data: existing } = await supabaseAdmin
    .from("sermons")
    .select("id")
    .eq("preached_on", sermon.preachedOn)
    .eq("title", sermon.title)
    .maybeSingle();

  let sermonId: number;
  let mode: "inserted" | "updated";
  if (existing?.id) {
    sermonId = existing.id as number;
    const { error } = await supabaseAdmin.from("sermons").update(row).eq("id", sermonId);
    if (error) throw new Error(`SAVE_FAILED ${error.message}`);
    mode = "updated";
  } else {
    const { data, error } = await supabaseAdmin.from("sermons").insert(row).select("id").single();
    if (error) throw new Error(`SAVE_FAILED ${error.message}`);
    sermonId = data.id as number;
    mode = "inserted";
  }

  // 구절은 통째로 갈아 끼운다 — 설교 글이 고쳐지면 인용 구절도 달라진다.
  await supabaseAdmin.from("sermon_refs").delete().eq("sermon_id", sermonId);
  if (sermon.refs.length > 0) {
    const { error } = await supabaseAdmin.from("sermon_refs").insert(
      sermon.refs.map((r) => ({
        sermon_id: sermonId,
        kind: r.kind,
        book_code: r.bookCode,
        chapter: r.chapter,
        verse_start: r.verseStart,
        verse_end: r.verseEnd,
      })),
    );
    if (error) throw new Error(`REFS_FAILED ${error.message}`);
  }
  return mode;
}

/**
 * 한 번 돌린다.
 *
 * `force` 면 `modifiedTime` 을 보지 않고 모두 다시 읽는다(파서를 고친 뒤 되돌릴 때).
 * 결과는 `sermon_ingest_runs` 에 남기고, 그 자체도 실패하면 삼키지 않고 콘솔에 남긴다.
 */
export async function ingestSermons(opts: {
  trigger: "cron" | "manual";
  force?: boolean;
  /** 손으로 돌릴 때 진행을 보여 주려면 넘긴다 */
  onProgress?: (line: string) => void;
}): Promise<IngestResult> {
  const startedAt = Date.now();
  const say = opts.onProgress ?? (() => {});
  const result: IngestResult = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failures: [],
    elapsedMs: 0,
  };

  try {
    const token = await getGoogleAccessToken(SCOPE_DRIVE_READONLY);
    const files = await listSermonFiles(token);
    result.scanned = files.length;
    say(`드라이브에서 ${files.length}편을 찾았다`);

    // 이미 들여온 것의 시각을 한 번에 읽어 둔다(파일마다 묻지 않는다).
    const { data: known, error: knownError } = await supabaseAdmin
      .from("sermons")
      .select("source_file_id, source_modified_at");
    if (knownError) throw new Error(`TABLE_MISSING ${knownError.message}`);
    const seen = new Map<string, string | null>();
    for (const k of known ?? []) {
      if (k.source_file_id) seen.set(k.source_file_id as string, k.source_modified_at as string | null);
    }

    for (const file of files) {
      const before = seen.get(file.id);
      if (!opts.force && before && new Date(before) >= new Date(file.modifiedTime)) {
        result.skipped += 1;
        continue;
      }
      try {
        const raw = await downloadTextFile(file.id, token);
        const parsed = parseSermon(raw, file.name);
        if (!parsed.ok) {
          result.failures.push({
            file: file.name,
            reason: parsed.failure.reason,
            detail: parsed.failure.detail,
          });
          say(`× ${file.name} — ${parsed.failure.reason}`);
          continue;
        }
        const mode = await saveSermon(parsed.sermon, file);
        if (mode === "inserted") result.inserted += 1;
        else result.updated += 1;
        say(
          `${mode === "inserted" ? "+" : "~"} ${parsed.sermon.preachedOn} ${parsed.sermon.title} ` +
            `(구절 ${parsed.sermon.refs.length})`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failures.push({ file: file.name, reason: "들여오다 실패", detail: msg.slice(0, 200) });
        say(`× ${file.name} — ${msg.slice(0, 120)}`);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    say(`멈춤 — ${result.error}`);
  }

  result.elapsedMs = Date.now() - startedAt;

  const { error: logError } = await supabaseAdmin.from("sermon_ingest_runs").insert({
    trigger: opts.trigger,
    scanned: result.scanned,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    failures: result.failures.length > 0 ? result.failures : null,
    elapsed_ms: result.elapsedMs,
    error: result.error ?? null,
  });
  if (logError) console.error("[sermons] 실행 기록 실패", logError.message);

  return result;
}
