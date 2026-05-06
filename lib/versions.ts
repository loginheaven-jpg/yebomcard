import { BibleVersion } from "./types";

export function getVersionLabel(v: BibleVersion | "none"): string {
  if (v === "none") return "대역";
  switch (v) {
    case "nkrv": return "개역";
    case "rnksv": return "새번역";
    case "easy": return "통독성경";
    case "kjv": return "KJV";
    case "nirv": return "NIrV";
    case "gnt": return "GNT";
    default: return v;
  }
}
