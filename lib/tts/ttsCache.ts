/**
 * TTS 오디오 IndexedDB 캐시
 *
 * 성경 절은 불변 콘텐츠 → 한 번 fetch하면 영구 캐시 가능.
 * 키: `${version}-${book_code}-${chapter}-${verse}-${voice}-${speed}`
 * 값: { blob: Blob, accessedAt: number }
 * LRU evict: count > MAX_ENTRIES 면 오래된 항목 BATCH_EVICT 개 제거.
 */

const DB_NAME = "yebom_tts_cache";
// v5: 영문 발음 미국식/영국식 분기 도입 — accent 차이로 같은 캐시 키여도 음원 달라야 함
// v6: 한국어 TTS 엔진 Chirp→Neural2 전환 + rnksv 주석 "(주:…)" 낭독 제외 → 기존 한국어 캐시 무효화
// v7: 한국어 온디맨드를 ElevenLabs 성우로 전환(구약 Hunmin/Sian·신약 천장성/김미연) → 기존 한국어 캐시 무효화
const DB_VERSION = 7;
const STORE = "audios";
const MAX_ENTRIES = 500;
const BATCH_EVICT = 50;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB not supported"));
  }
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    // open 이 success/error/blocked 중 무엇도 못 받고 멈추는 경우까지 차단 —
    // 절대 영구 대기 금지(여기서 hang 하면 모든 TTS 가 loading 에서 멈춤).
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dbPromise = null; // 실패 promise 를 캐시하지 않음 → 다음 호출 때 재시도(복구 가능)
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    timer = setTimeout(() => fail(new Error("openDB timeout")), 4000);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 버전 업그레이드 시 기존 store 삭제 후 재생성 — 엔진 교체로 인한 stale 캐시 제거
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      const store = db.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("accessedAt", "accessedAt", { unique: false });
    };
    // 다른 탭/홈화면 PWA 가 구버전 DB 연결을 쥐고 있으면 open(신버전) 이 blocked 로
    // 영구 대기 → reject 해 캐시 없이라도 TTS 진행. (DB_VERSION bump 직후 발생)
    req.onblocked = () => fail(new Error("openDB blocked"));
    req.onsuccess = () => {
      if (settled) {
        try {
          req.result.close();
        } catch {
          /* ignore */
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      const db = req.result;
      // 이 연결이 다른 탭의 향후 업그레이드를 막지 않도록 — versionchange 시 닫고 재오픈 유도
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => fail(req.error);
  });
  return dbPromise;
}

export interface TtsCacheKey {
  version: string;
  bookCode: string;
  chapter: number;
  verse: number;
  voice: "female" | "male";
  speed: number;
  /** 영문 accent — "us"|"gb". 한국어 트랙은 "ko" 고정. */
  accent?: "us" | "gb" | "ko";
}

export function makeCacheKey(k: TtsCacheKey): string {
  const acc = k.accent ?? "us";
  return `${k.version}-${k.bookCode}-${k.chapter}-${k.verse}-${k.voice}-${k.speed}-${acc}`;
}

export interface CachedAudio {
  blob: Blob;
  /** 캐시 작성 시 서버가 사용한 voice 이름 (UI 엔진 표시용). 비어있을 수 있음 */
  voiceUsed: string;
}

export async function getCachedAudio(key: string): Promise<CachedAudio | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const row = req.result as
          | {
              key: string;
              blob: Blob;
              accessedAt: number;
              voiceUsed?: string;
            }
          | undefined;
        if (!row) {
          resolve(null);
          return;
        }
        store.put({ ...row, accessedAt: Date.now() });
        resolve({ blob: row.blob, voiceUsed: row.voiceUsed ?? "" });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedAudio(
  key: string,
  blob: Blob,
  voiceUsed: string = "",
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ key, blob, voiceUsed, accessedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    void evictIfNeeded();
  } catch {
    /* 캐시 실패는 silent */
  }
}

async function evictIfNeeded(): Promise<void> {
  try {
    const db = await openDB();
    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
    if (count <= MAX_ENTRIES) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const idx = store.index("accessedAt");
      const cursorReq = idx.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && removed < BATCH_EVICT) {
          cursor.delete();
          removed++;
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorReq.onerror = () => resolve();
    });
  } catch {
    /* evict 실패 silent */
  }
}
