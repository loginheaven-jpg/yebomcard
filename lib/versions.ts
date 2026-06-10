import { BibleVersion } from "./types";

/** 영문 역본 여부 — TTS voice 선택·언어 분기에 사용 */
export function isEnglishVersion(v: string): boolean {
  return v === "kjv" || v === "nirv" || v === "gnt" || v === "web";
}

export function getVersionLabel(v: BibleVersion | "none"): string {
  if (v === "none") return "대역";
  switch (v) {
    case "nkrv": return "개역";
    case "rnksv": return "새번역";
    case "easy": return "통독";
    case "kjv": return "KJV";
    case "nirv": return "NIrV";
    case "gnt": return "GNT";
    case "web": return "WEB";
    default: return v;
  }
}
