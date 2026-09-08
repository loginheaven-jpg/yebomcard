# qc_sweep.py — 업로드 직전 전수 검증.
#
#   python qc_sweep.py --voice 영희 --version 새번역 --book 욥기
#
# 왜 필요한가
#   작업 재개(resume) 시 "파일이 이미 있으면 합격"으로 표시한다. 이건 빠르지만,
#   그 파일이 실제로 검수를 통과한 것인지는 보증하지 않는다(중단·클로버 등으로
#   검수 기록이 유실될 수 있음). 배포 전 한 번은 디스크의 모든 파일을 원문과
#   다시 대조해야 한다.
#
# 결과는 out/{voice}/_sweep_{version}_{book}.json 에 저장하고, 불합격 목록을 출력한다.

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import engine


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--version", default="새번역")
    ap.add_argument("--book", required=True)
    ap.add_argument("--threshold", type=float, default=0.85)
    ap.add_argument("--limit", type=int, default=0, help="앞에서 N개만(표본 점검)")
    a = ap.parse_args()

    ver = engine.VERSIONS[a.version]
    books = engine.get_books(ver)
    code = {n: c for n, c, _ in books}.get(a.book)
    if not code:
        print("책을 찾을 수 없음:", a.book); sys.exit(1)

    rows = engine.get_book_verses(ver, code)
    if a.limit:
        rows = rows[:a.limit]
    print(f"[전수 검증] {a.version} {a.book} — {len(rows)}절 · 임계 {a.threshold*100:.0f}%")

    bad, missing, checked = [], [], 0
    for i, (ch, v, text) in enumerate(rows, 1):
        stem = f"{ver}_{code}_{ch:03d}"
        p = engine.OUT / a.voice / stem / f"{stem}_{v:03d}.wav"
        if not p.exists():
            missing.append(f"{a.book} {ch}:{v}")
            continue
        try:
            ok, ratio, reason, hyp = engine.qc(p, text, a.threshold)
        except Exception as e:
            ok, ratio, reason, hyp = False, 0.0, f"검수 오류: {e}"[:80], ""
        checked += 1
        if not ok:
            bad.append({"ref": f"{a.book} {ch}:{v}", "key": f"{stem}_{v:03d}",
                        "ratio": round(ratio, 3), "reason": reason,
                        "text": text[:60], "asr": hyp[:60]})
        if i % 100 == 0:
            print(f"  {i}/{len(rows)} · 불합격 {len(bad)} · 없음 {len(missing)}", flush=True)

    out = engine.OUT / a.voice / f"_sweep_{ver}_{code}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"version": ver, "book": code, "checked": checked,
         "missing": missing, "bad": bad}, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n[결과] 검증 {checked} · 불합격 {len(bad)} · 파일없음 {len(missing)}")
    for b in bad[:15]:
        print(f"  {b['ref']} {b['ratio']*100:.0f}% {b['reason']}")
        print(f"     원문 {b['text']}")
        print(f"     ASR  {b['asr']}")
    if missing[:10]:
        print("  파일 없음:", ", ".join(missing[:10]))
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
