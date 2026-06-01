/**
 * TTS 오디오 IndexedDB 캐시
 *
 * 성경 절은 불변 콘텐츠 → 한 번 fetch하면 영구 캐시 가능.
 * 키: `${version}-${book_code}-${chapter}-${verse}-${voice}-${speed}`
 * 값: { blob: Blob, accessedAt: number }
 * LRU evict: count > MAX_ENTRIES 면 오래된 항목 BATCH_EVICT 개 제거.
 */

const DB_NAME = "yebom_tts_cache";
// v2: GCP Neural2 → Chirp 3 HD 전환 — 기존 캐시는 음원 모델이 다르므로 onupgradeneeded 에서 제거
const DB_VERSION = 2;
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
}

export function makeCacheKey(k: TtsCacheKey): string {
  return `${k.version}-${k.bookCode}-${k.chapter}-${k.verse}-${k.voice}-${k.speed}`;
}

export async function getCachedAudio(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const row = req.result as
          | { key: string; blob: Blob; accessedAt: number }
          | undefined;
        if (!row) {
          resolve(null);
          return;
        }
        store.put({ ...row, accessedAt: Date.now() });
        resolve(row.blob);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedAudio(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ key, blob, accessedAt: Date.now() });
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
