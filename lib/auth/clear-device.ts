/**
 * 명시적 로그아웃 때 이 기기(이 사이트)의 저장소를 정리한다.
 *
 * 교적부 `src/lib/auth/clear-device.ts` 를 기반으로 하되, 예봄성경의 두 가지 결정을 반영했다.
 *
 * 1) **기기 취향은 남긴다.** 글꼴·테마·역본·성우 같은 값은 개인정보가 아니고, 지우면 로그아웃할 때마다
 *    교인이 다시 맞춰야 한다. `localStorage.clear()` 전에 떠 두었다가 지운 뒤 다시 쓴다.
 * 2) **IndexedDB 는 손대지 않는다.** 이 앱의 유일한 DB(`yebom_tts_cache`)는 공개 성경 음원 캐시라
 *    개인정보가 아니고, 지우면 데이터 요금과 다시 받는 시간만 든다. 교적부 헬퍼의 `databases()` 블록은
 *    폴백이 없어 사파리·파이어폭스에서는 어차피 건너뛰므로 브라우저마다 다르게 동작하기도 한다.
 *    앞으로 **개인 데이터**를 IndexedDB 에 두게 되면 그 DB 만 이름을 지정해(`deleteDatabase`) 지울 것.
 *
 * `yebom_returning`(재방문 표시)은 개인정보가 아니므로 다시 남긴다 — 오리진별 키라 교적부 로그인 화면과 무관하다.
 * 서비스워커는 해지한다(이 앱 워커는 캐싱을 하지 않아 Cache Storage 는 사실상 비어 있지만, 정리는 그대로 둔다).
 */

/** 계정·개인 데이터 — 로그아웃, 그리고 기기 주인이 바뀔 때 지운다 */
export const PERSONAL_KEYS = [
  // 책갈피·마지막 위치
  "yebom_bookmarks",
  "yebom_recent",
  "yebom_bookmark",
  // 말씀의삶(통독)·그룹
  "yebom_plan_pending_group_code",
  "yebom_plan_group_prompt",
  "yebom_plan_unit_sheet_shown",
  // 스크랩
  "yebom-scraps",
  "yebom-scraps-migrated",
  // 히스토리
  "yebom_search_history",
  "yebom_hymn_history",
  "yebom_worship_history",
  "yebom_last_hymn",
  // 예배 성경·카드
  "yebom_worship_lists",
  "yebom_worship_current",
  "yebom_card_input",
] as const;

/** 기기 취향 — 로그아웃해도 남긴다(지우면 다시 맞춰야 하는 값) */
const DEVICE_PREF_KEYS = [
  "globalFontSize",
  "globalFontKey",
  "globalTheme",
  "fullscreenFont",
  "fullscreenFontSize",
  "fullscreenTheme",
  "yebom_main_version",
  "yebom_sub_version",
  "yebom_quicknav_pos",
  "yebom_autohide_tabbar",
  "pwa-installed",
  "yebom_returning",
] as const;

/** 성우·읽기 설정 11종은 접두사로 한꺼번에 — 새 설정이 늘어도 저절로 보존된다 */
const DEVICE_PREF_PREFIXES = ["yebom_tts_"] as const;

function isDevicePref(key: string): boolean {
  return (
    (DEVICE_PREF_KEYS as readonly string[]).includes(key) ||
    DEVICE_PREF_PREFIXES.some((p) => key.startsWith(p))
  );
}

/** 개인 데이터 키만 지운다 — 기기 주인이 바뀌었을 때(로그아웃 없이 다른 사람이 로그인) 쓴다 */
export function purgePersonalData(): void {
  if (typeof window === "undefined") return;
  for (const key of PERSONAL_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 저장소 접근 불가 — 무시 */
    }
  }
}

export async function clearDeviceData(): Promise<void> {
  if (typeof window === "undefined") return;

  // 취향 값을 떠 둔다 — clear() 는 전부 지우므로 되돌려 놓을 것을 먼저 읽는다
  const keep: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isDevicePref(key)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) keep[key] = value;
    }
  } catch {
    /* 무시 — 못 읽으면 취향만 잃는다 */
  }

  try {
    localStorage.clear();
  } catch {
    /* 무시 */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* 무시 */
  }

  try {
    for (const [key, value] of Object.entries(keep)) localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
  // 재방문 표시 — 취향을 못 읽었더라도 반드시 남긴다
  try {
    localStorage.setItem("yebom_returning", "1");
  } catch {
    /* 무시 */
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* 무시 */
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    /* 무시 */
  }
}
