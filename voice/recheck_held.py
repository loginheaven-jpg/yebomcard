# recheck_held.py — 보류(held) 절만 다시 검수해 오탐을 걸러내고, 진짜 실패만 재생성 큐에 올린다.
#
#   python recheck_held.py --book 욥기            # 재검수 + 재큐 (기본)
#   python recheck_held.py --book 욥기 --dry      # 판정만 보고 파일은 안 건드림
#
# 왜 필요한가
#   검수 임계를 고치면(qc_threshold) 이미 "보류"로 빠진 절들은 옛 기준의 판정을
#   그대로 달고 있다. 음원은 멀쩡한데 보류로 남으면 그만큼 공백이 생긴다.
#   ASR 을 다시 돌려 현재 기준으로 재판정한다 — 비율만 보고 통과시키지 않는다.
#
# 재생성으로 넘길 때 tries=1 로 둔다. jobs 의 재시도 경로가 tries>=1 부터
# 문장/쉼표 강제 분할을 켜므로, 첫 재생성부터 잘림 회피가 적용된다.

import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import engine
import jobs


def pick_job(book, jid):
    if jid:
        return jobs.load(jid)
    cands = [j for j in jobs.list_jobs() if book in j["title"]]
    if not cands:
        return None
    return sorted(cands, key=lambda j: j["id"])[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", default=None, help="책 이름(작업 제목으로 검색)")
    ap.add_argument("--job", default=None, help="작업 ID 직접 지정")
    ap.add_argument("--dry", action="store_true", help="판정만 출력")
    a = ap.parse_args()

    job = pick_job(a.book, a.job)
    if not job:
        print("작업을 찾을 수 없습니다"); sys.exit(1)
    held = [i for i in job["items"] if i["status"] == "held"]
    print(f"[{job['title']}] 작업 {job['id']} · 보류 {len(held)}건 재검수", flush=True)
    if not held:
        return

    passed, requeue = [], []
    for it in held:
        p = Path(it["out"])
        if not p.exists():
            requeue.append((it, "파일 없음", 0.0)); continue
        try:
            ok, ratio, reason, hyp = engine.qc(p, it["text"])
        except Exception as e:
            requeue.append((it, f"검수 오류: {e}"[:80], 0.0)); continue
        if ok:
            passed.append((it, ratio, hyp))
        else:
            requeue.append((it, reason, ratio))

    print(f"\n── 재검수 통과 {len(passed)}건 (옛 기준 오탐) ──")
    for it, ratio, hyp in passed:
        print(f"  {it['ref']:12s} {ratio*100:3.0f}%  {it['text'][:34]}")
        print(f"  {'':12s}       ASR: {hyp[:34]}")
    print(f"\n── 재생성 {len(requeue)}건 ──")
    for it, reason, ratio in requeue:
        print(f"  {it['ref']:12s} {reason}  {it['text'][:40]}")

    if a.dry:
        print("\n(--dry: 파일 변경 없음)"); return

    for it, ratio, _ in passed:
        it["status"] = "ok"
        it["ratio"] = round(ratio, 3)
        it["reason"] = "재검수 통과"
    for it, reason, ratio in requeue:
        it["status"] = "pending"
        it["tries"] = 1            # 첫 재생성부터 강제 분할이 걸리도록
        it["ratio"] = round(ratio, 3) if ratio else None
        it["reason"] = reason
    if requeue:
        job["status"] = "queued"
    jobs.save(job)
    print(f"\n저장 완료 — 합격 +{len(passed)} · 대기 {len(requeue)}")
    print("이어서: python run_plan.py --voice 영희 --start 욥기")


if __name__ == "__main__":
    main()
