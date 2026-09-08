# qc_asr.py — 생성 음원을 ASR 로 역전사해 원문과 일치율을 잰다.
# 전량 생성 시 "환청/누락/절단"을 자동으로 걸러내기 위한 품질 게이트의 원형.
#
#   python qc_asr.py --dir out/nkrv_1jn_001 --version nkrv --book 1jn --chapter 1

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
ENV_FILE = BASE.parent / ".env.local"
NOTE_RE = re.compile(r"\s*\(\s*주\s*[:：][\s\S]*$")
# 비교용 정규화: 공백/문장부호 제거 (ASR 은 띄어쓰기·부호를 자주 다르게 낸다)
NORM_RE = re.compile(r"[\s.,!?·\"'“”‘’()\[\]:;]")


def norm(s):
    return NORM_RE.sub("", s)


def fetch_verses(version, book, chapter):
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            env[m.group(1)] = m.group(2).strip()
    r = requests.get(
        f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/bible_verses",
        params={"version": f"eq.{version}", "book_code": f"eq.{book}",
                "chapter": f"eq.{chapter}", "select": "verse,text", "order": "verse.asc"},
        headers={"apikey": env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
                 "Authorization": f"Bearer {env['NEXT_PUBLIC_SUPABASE_ANON_KEY']}"}, timeout=30)
    r.raise_for_status()
    return {x["verse"]: NOTE_RE.sub("", x["text"]).strip() for x in r.json()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--version", default="nkrv")
    ap.add_argument("--book", default="1jn")
    ap.add_argument("--chapter", type=int, default=1)
    ap.add_argument("--threshold", type=float, default=0.85)
    args = ap.parse_args()

    d = Path(args.dir)
    src = fetch_verses(args.version, args.book, args.chapter)

    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cuda", compute_type="float16")

    rows, bad = [], 0
    for v in sorted(src):
        f = d / f"{args.version}_{args.book}_{args.chapter:03d}_{v:03d}.wav"
        if not f.exists():
            continue
        segs, _ = model.transcribe(str(f), language="ko", vad_filter=False)
        hyp = " ".join(s.text.strip() for s in segs).strip()
        ratio = difflib.SequenceMatcher(None, norm(src[v]), norm(hyp)).ratio()
        ok = ratio >= args.threshold
        if not ok:
            bad += 1
        rows.append({"verse": v, "ratio": round(ratio, 3), "ok": ok,
                     "src": src[v], "asr": hyp})
        print(f"{'OK ' if ok else 'LOW'} {v:2d}절  일치율 {ratio*100:5.1f}%")
        if not ok:
            print(f"      원문: {src[v]}")
            print(f"      ASR : {hyp}")

    avg = sum(r["ratio"] for r in rows) / len(rows) if rows else 0
    print(f"\n평균 일치율 {avg*100:.1f}% · 기준({args.threshold*100:.0f}%) 미달 {bad}/{len(rows)}절")
    (d / "qc_asr.json").write_text(
        json.dumps({"avg_ratio": round(avg, 3), "below": bad, "rows": rows},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"저장: {d/'qc_asr.json'}")


if __name__ == "__main__":
    main()
