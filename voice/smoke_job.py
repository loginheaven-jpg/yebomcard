# smoke_job.py — UI 없이 작업 큐 전체를 한 번 돌려보는 통합 점검.
#   build_items → new_job → 워커(합성·QC·재시도) → 결과 요약
#
#   python smoke_job.py --voice 리딩지저스 --version 새번역 --book 요한일서 --ch 1

import argparse
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import app as ui
import engine
import jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="리딩지저스")
    ap.add_argument("--version", default="새번역")
    ap.add_argument("--book", default="요한일서")
    ap.add_argument("--ch", type=int, default=1)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=1800)
    a = ap.parse_args()

    items = ui.build_items(a.voice, "성경 범위", a.version, [a.book], a.ch, a.ch, "", None)
    chars = sum(len(i["text"]) for i in items)
    audio, gen = engine.estimate(chars)
    print(f"[대상] {a.version} {a.book} {a.ch}장 — {len(items)}절 / {chars}자")
    print(f"       예상 오디오 {audio:.0f}초 · 예상 생성 {gen:.0f}초")

    jid = jobs.new_job(a.voice, f"smoke {a.book} {a.ch}", items, batch=a.batch)
    print(f"[작업] {jid} 등록, 워커 시작")

    t0 = time.time()
    last = -1
    while time.time() - t0 < a.timeout:
        job = jobs.load(jid)
        ok, held, pend = jobs.counts(job)
        if ok + held != last:
            print(f"  진행 {ok+held}/{len(items)} (합격 {ok} · 보류 {held} · 대기 {pend}) "
                  f"— {job['status']}")
            last = ok + held
        if job["status"] in ("done", "error", "stopped"):
            break
        time.sleep(3)

    job = jobs.load(jid)
    ok, held, pend = jobs.counts(job)
    wall = time.time() - t0
    audio_sec = sum(i.get("audio_sec") or 0 for i in job["items"])
    print(f"\n[결과] 상태 {job['status']} · {wall:.0f}초 소요")
    print(f"  합격 {ok} / 보류 {held} / 대기 {pend}")
    print(f"  오디오 {audio_sec:.1f}초 · 실측 RTF {wall/audio_sec if audio_sec else 0:.2f}")
    if job.get("error"):
        print("  오류:", job["error"])
    bad = [i for i in job["items"] if i["status"] != "ok"]
    for i in bad[:5]:
        print(f"   보류 {i['ref']} (시도 {i['tries']}) {i.get('reason')}")
    lows = sorted([i for i in job["items"] if i.get("ratio")], key=lambda x: x["ratio"])[:3]
    print("  최저 일치율:", ", ".join(f"{i['ref']} {i['ratio']*100:.0f}%" for i in lows))
    jobs.stop_worker()


if __name__ == "__main__":
    main()
