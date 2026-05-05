import { BibleVersion, EnglishVersion } from "./types";

export function getVersionLabel(v: BibleVersion | EnglishVersion): string {
  switch (v) {
    case "nkrv": return "개역개정";
    case "rnksv": return "새번역";
    case "easy": return "통독성경";
    case "kjv": return "KJV";
    case "nirv": return "NIrV";
    case "gnt": return "GNT";
    default: return v;
  }
}
