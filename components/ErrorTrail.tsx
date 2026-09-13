"use client";

/**
 * 삼켜진 오류의 흔적 남기기 — 화면에는 아무것도 그리지 않는다.
 *
 * 계기(2026-09-13): 사진을 찍고 확인을 눌렀는데 아무 일도 일어나지 않은 일이 두 번 있었다.
 * 원인은 `await` 한 곳에 catch 가 없어 예외가 통째로 사라진 것이었는데, **전역 오류 수집이
 * 하나도 없어서 흔적조차 남지 않았다** — 그래서 사후에 원인을 좁히는 데 코드를 다 읽어야 했다.
 *
 * 하는 일은 두 가지뿐이다.
 *  1) 처리되지 않은 약속 거부(`unhandledrejection`)와 잡히지 않은 오류(`error`)를 콘솔에 남긴다
 *  2) 마지막 스무 건을 `sessionStorage` 에 쌓아 둔다 — 사용자가 "그때 아무 일도 없었다" 고
 *     말할 때 브라우저 콘솔에서 `yebomErrors()` 한 줄로 꺼내 볼 수 있게
 *
 * 서버로 보내지 않는다. 본문·개인 데이터가 오류 메시지에 섞일 수 있고, 보내는 순간 그것이
 * 또 하나의 실패 지점이 된다. 기기 안에 남겨 두고 필요할 때 꺼내 보는 것으로 족하다.
 */

import { useEffect } from "react";

const KEY = "yebom_error_trail";
const MAX = 20;

interface Entry {
  at: string;
  kind: "rejection" | "error";
  message: string;
  where: string;
}

function push(entry: Entry) {
  try {
    const raw = sessionStorage.getItem(KEY);
    const list: Entry[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    sessionStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* 저장이 막힌 브라우저 — 콘솔 기록만으로 간다 */
  }
}

function describe(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v)?.slice(0, 300) || String(v);
  } catch {
    return String(v);
  }
}

export default function ErrorTrail() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = describe(e.reason);
      console.error("[삼켜진 오류] 처리되지 않은 약속 거부:", e.reason);
      push({ at: new Date().toISOString(), kind: "rejection", message, where: location.pathname });
    };
    const onError = (e: ErrorEvent) => {
      console.error("[삼켜진 오류] 잡히지 않은 오류:", e.error || e.message);
      push({
        at: new Date().toISOString(),
        kind: "error",
        message: describe(e.error || e.message),
        where: `${e.filename || location.pathname}:${e.lineno || 0}`,
      });
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);

    // 콘솔에서 꺼내 보는 길 — 개발자 도구를 붙였을 때 한 줄이면 된다
    (window as unknown as { yebomErrors?: () => Entry[] }).yebomErrors = () => {
      try {
        return JSON.parse(sessionStorage.getItem(KEY) || "[]");
      } catch {
        return [];
      }
    };

    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
