/**
 * bible_audio 테이블 조회 — 장 단위 음원 매핑.
 *
 * 통독성경 등 사람 녹음 음원이 Supabase Storage 에 적재돼 있고,
 * bible_audio 테이블에 (version, book_code, chapter) → audio_url 매핑.
 *
 * 매핑이 있으면 mp3 재생, 없으면 호출자(TtsContext) 가 TTS 폴백.
 *
 * 메모리 캐시: 같은 세션 안에서는 한 번만 조회.
 *   - hit: audio URL string
 *   - miss: null
 *   - 조회 결과를 둘 다 캐싱 (재방문 시 또 Supabase 조회 안 함)
 */

import { supabase } from "@/lib/supabase";

type LookupResult = { url: string | null };

const cache = new Map<string, LookupResult>();
const inflight = new Map<string, Promise<LookupResult>>();

function cacheKey(version: string, bookCode: string, chapter: number): string {
  return `${version}|${bookCode}|${chapter}`;
}

export async function lookupChapterAudio(
  version: string,
  bookCode: string,
  chapter: number,
): Promise<string | null> {
  const key = cacheKey(version, bookCode, chapter);
  const cached = cache.get(key);
  if (cached) return cached.url;
  const pending = inflight.get(key);
  if (pending) return (await pending).url;

  const p = (async (): Promise<LookupResult> => {
    try {
      const { data } = await supabase
        .from("bible_audio")
        .select("audio_url")
        .eq("version", version)
        .eq("book_code", bookCode)
        .eq("chapter", chapter)
        .maybeSingle();
      const url = (data as { audio_url?: string } | null)?.audio_url ?? null;
      const result: LookupResult = { url };
      cache.set(key, result);
      return result;
    } catch {
      const result: LookupResult = { url: null };
      cache.set(key, result);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return (await p).url;
}
