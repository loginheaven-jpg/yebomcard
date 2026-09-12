"use client";

/**
 * 기기에 남은 개인 데이터가 **다음에 로그인한 사람**에게 섞이지 않게 한다.
 *
 * 예봄성경은 로그인 없이도 쓴다. 그래서 앞 사람이 비로그인으로 남긴 책갈피·스크랩·그룹 초대코드가
 * 기기에 남고, 로그인 동기화(`lib/userSync.ts` `syncOnLogin`)는 그것을 클라우드로 올린다.
 * 동기화는 단방향이 아니라 양방향(클라우드 값이 로컬을 덮어쓰기도 한다)이라, **판정과 정리는 반드시
 * 동기화보다 먼저** 끝나야 한다. 그래서 세션 provider 가 로그인을 확정한 순간 여기를 먼저 부르고,
 * 그 뒤에야 `deviceReady` 가 켜져 동기화·스크랩 이관·그룹 자동참여가 돈다.
 *
 * 세 갈래
 *  - 같은 사용자(`yebom_last_user` 일치) — 그대로 둔다. 늘 쓰던 기기의 정상 흐름이라 묻지 않는다
 *  - 처음 보는 기기(기록 없음) + 로컬 책갈피 있음 — **합칠지 한 번 묻는다.** 비로그인으로 모아 둔 책갈피를
 *    말없이 버리지도, 말없이 남의 계정에 합치지도 않기 위해서다
 *  - 다른 사용자(기록 불일치) — 묻지 않고 지운다. 앞 사람 데이터를 새 사람 계정에 올릴 이유가 없다
 *
 * 그룹 초대코드는 사용자 정보가 붙어 있지 않아, 남아 있으면 **다음에 로그인한 사람이 남의 그룹에
 * 자동 참여**한다. 그래서 30분만 유효하게 하고 로그아웃·세션 만료 때 지운다.
 */

import { readBookmarks } from "@/lib/bookmark";
import { purgePersonalData } from "./clear-device";

const LS_LAST_USER = "yebom_last_user";
const LS_PENDING_GROUP_CODE = "yebom_plan_pending_group_code";
/** 코드를 넣고 로그인하러 갔다 돌아오는 데 드는 시간만 허용한다 */
const PENDING_GROUP_TTL_MS = 30 * 60 * 1000;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
}
function lsRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 무시 */
  }
}

/**
 * 로그인이 확정된 순간 기기 주인을 맞춘다. 동기화·이관·그룹 자동참여보다 **먼저** 부를 것.
 * 묻는 경우가 있어 사용자 조작(확인창)이 섞인다 — 처음 보는 기기에 로컬 책갈피가 있을 때뿐이다.
 */
export function resolveDeviceOwner(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  const last = lsGet(LS_LAST_USER);

  if (last && last !== userId) {
    // 다른 사람이 쓰던 기기 — 앞 사람 흔적을 지우고 이 사람의 클라우드 데이터만 받는다
    purgePersonalData();
  } else if (!last) {
    // 이 기기에서 처음 로그인 — 비로그인으로 모아 둔 것이 있으면 합칠지 묻는다
    let count = 0;
    try {
      count = readBookmarks().length;
    } catch {
      count = 0;
    }
    if (count > 0) {
      const merge = window.confirm(
        `이 기기에 저장된 책갈피 ${count}개를 내 계정에 합칠까요?\n\n` +
          `취소를 누르면 이 기기의 책갈피는 지우고, 내 계정에 저장된 것만 불러옵니다.`,
      );
      if (!merge) purgePersonalData();
    }
  }

  lsSet(LS_LAST_USER, userId);
}

/** 로그인하지 않은 채 넣어 둔 그룹 초대코드 — 30분이 지났으면 없는 것으로 본다 */
export function readPendingGroupCode(): string | null {
  const raw = lsGet(LS_PENDING_GROUP_CODE);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { code?: string; ts?: number };
    if (!saved || typeof saved.code !== "string" || typeof saved.ts !== "number") {
      lsRemove(LS_PENDING_GROUP_CODE);
      return null;
    }
    if (Date.now() - saved.ts > PENDING_GROUP_TTL_MS) {
      lsRemove(LS_PENDING_GROUP_CODE);
      return null;
    }
    return saved.code;
  } catch {
    // 유효시간이 없던 때 저장한 값(그냥 코드 문자열) — 남은 시간을 알 수 없으니 한 번은 살려 준다
    return raw;
  }
}

export function writePendingGroupCode(code: string): void {
  lsSet(LS_PENDING_GROUP_CODE, JSON.stringify({ code, ts: Date.now() }));
}

export function clearPendingGroupCode(): void {
  lsRemove(LS_PENDING_GROUP_CODE);
}
