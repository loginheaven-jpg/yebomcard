# run_book.py — 책 한 권을 통째로 생성(절 단위). 장시간 작업용 러너.
#
#   python run_book.py --voice 영희 --version 새번역 --book 욥기 --batch 4
#
# 워커는 데몬 스레드라 메인이 끝나면 같이 죽는다 → 완료까지 여기서 붙들고 진행률을 찍는다.
# 중단되어도 jobs/*.json 에 상태가 남아 --resume 으로 이어갈 수 있다.

import argparse
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import app as ui
import engine
import jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--version", default="새번역")
    ap.add_argument("--book", required=True)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--retry", type=int, default=3)
    ap.add_argument("--resume", default=None, help="이어할 작업 ID")
    a = ap.parse_args()

    if a.resume:
        jid = a.resume
        jobs.requeue(jid)
        job = jobs.load(jid)
        total = len(job["items"])
        print(f"[이어하기] {jid} — {total}개 항목")
    else:
        items = ui.build_items(a.voice, "성경 범위", a.version, [a.book], None, None, "", None)
        chars = sum(len(i["text"]) for i in items)
        audio, gen = engine.estimate(chars)
        total = len(items)
        print(f"[대상] {a.version} {a.book} — {total}절 / {chars:,}자")
        print(f"       예상 오디오 {audio/3600:.1f}h · 예상 생성 {gen/3600:.1f}h")
        jid = jobs.new_job(a.voice, f"{a.version} {a.book}", items,
                           batch=a.batch, retry_max=a.retry)
        print(f"[작업] {jid} 시작")

    t0 = time.time()
    last, last_t = -1, t0
    while True:
        job = jobs.load(jid)
        ok, held, pend = jobs.counts(job)
        done = ok + held
        if done != last:
            el = time.time() - t0
            rate = done / el if el > 0 else 0
            eta = (total - done) / rate if rate > 0 else 0
            print(f"  {done}/{total} (합격 {ok} · 보류 {held}) "
                  f"· 경과 {el/60:.0f}분 · 남은 {eta/60:.0f}분", flush=True)
            last, last_t = done, time.time()
        if job["status"] in ("done", "error", "stopped"):
            break
        time.sleep(10)

    job = jobs.load(jid)
    ok, held, pend = jobs.counts(job)
    audio_sec = sum(i.get("audio_sec") or 0 for i in job["items"])
    wall = time.time() - t0
    print(f"\n[완료] {job['status']} · {wall/60:.0f}분")
    print(f"  합격 {ok} / 보류 {held} / 대기 {pend} (전체 {total})")
    print(f"  오디오 {audio_sec/3600:.2f}시간 · 실측 RTF {wall/audio_sec if audio_sec else 0:.2f}")
    if job.get("error"):
        print("  오류:", job["error"])
    for i in [x for x in job["items"] if x["status"] == "held"][:10]:
        print(f"   보류 {i['ref']} ({i.get('reason')})")
    print(f"  작업ID: {jid}")
    jobs.stop_worker()


if __name__ == "__main__":
    main()
