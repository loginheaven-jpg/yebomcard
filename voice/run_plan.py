# run_plan.py — 성경읽기진도표 순서대로 여러 책을 이어서 생성한다.
#
#   python run_plan.py --voice 영희 --from 욥기            # 욥기부터 끝까지
#   python run_plan.py --voice 영희 --from 창세기 --books 3 # 창세기부터 3권만
#
# run_book.py 는 책 하나가 끝나면 워커를 멈춘다. 이건 진도표를 따라
# 다음 책으로 계속 넘어가며, 중단되어도 다시 실행하면 이어간다.

import argparse
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import app as ui
import engine
import jobs
import plan


def ensure_job(voice, version, book_name, batch, retry, seq, upload_key=None):
    """같은 책의 미완료 작업이 있으면 재사용, 없으면 생성. (jid, total) 반환"""
    title = f"{version} {book_name}"
    for j in jobs.list_jobs():
        if j["voice"] == voice and j["title"] == title:
            if j["status"] == "done":
                ok, held, pend = jobs.counts(j)
                if pend == 0:
                    return j["id"], len(j["items"]), True   # 이미 완료
            jobs.requeue(j["id"])
            return j["id"], len(j["items"]), False
    items = ui.build_items(voice, "성경 범위", version, [book_name], None, None, "", None)
    jid = jobs.new_job(voice, title, items, batch=batch, retry_max=retry, seq=seq,
                       upload_key=upload_key)
    return jid, len(items), False


def run_job(jid, total, label):
    """작업이 끝날 때까지 진행을 찍으며 기다린다. 멈추거나 오류면 False."""
    print(f"{label} ({total}절) 시작 · 작업 {jid}", flush=True)
    t0, last = time.time(), -1
    while True:
        job = jobs.load(jid)
        if job is None:
            print("   작업 파일 사라짐 — 중단")
            return False
        ok, held, pend = jobs.counts(job)
        done = ok + held
        if done != last and done % 25 == 0:
            el = time.time() - t0
            eta = (total - done) * (el / max(1, done)) if done else 0
            print(f"     {done}/{total} (합격 {ok} · 보류 {held}) "
                  f"· 경과 {el/60:.0f}분 · 남은 {eta/60:.0f}분", flush=True)
            last = done
        if job["status"] in ("done", "error"):
            break
        if job["status"] == "stopped":
            print("   워커 정지됨 — 중단")
            return False
        time.sleep(10)
    job = jobs.load(jid)
    ok, held, _ = jobs.counts(job)
    audio = sum(i.get("audio_sec") or 0 for i in job["items"])
    print(f"     완료 — 합격 {ok} · 보류 {held} · 오디오 {audio/3600:.2f}h "
          f"· {(time.time()-t0)/60:.0f}분", flush=True)
    if job["status"] == "error":
        print("   오류:", job.get("error"))
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--version", default="새번역")
    ap.add_argument("--start", default="욥기", help="시작 책(진도표 기준)")
    ap.add_argument("--books", type=int, default=0, help="처리할 권 수(0=끝까지)")
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--retry", type=int, default=3)
    # ── 여러 PC 분담용 ──
    ap.add_argument("--testament", choices=["old", "new"], default=None,
                    help="구약/신약만 처리 (예: 다른 PC 에서 신약 병행)")
    ap.add_argument("--only", default=None,
                    help="쉼표로 구분한 책 이름만 처리 (예: 마태복음,마가복음)")
    ap.add_argument("--upload-key", default=None,
                    help="예봄성경 성우 슬롯(예: f4). 생략하면 보이스 meta.json 의 voiceKey")
    ap.add_argument("--no-upload", action="store_true", help="자동 업로드 끄기")
    # ── 구방식 교체 (2026-09-10 결정) ──
    ap.add_argument("--then-replace", action="store_true",
                    help="남은 절을 다 만든 뒤, 같은 책들의 구방식 음원을 새 방식으로 다시 만들어 교체")
    ap.add_argument("--replace-legacy", action="store_true",
                    help="남은 절은 건너뛰고 구방식 교체만 한다")
    a = ap.parse_args()

    if a.start not in plan.BY_NAME:
        print("진도표에 없는 책:", a.start); sys.exit(1)
    start_seq = plan.BY_NAME[a.start][0]
    todo = [p for p in plan.PLAN_ORDER if p[0] >= start_seq]
    if a.testament:
        tm = {c: t for _, c, t in engine.get_books(engine.VERSIONS[a.version])}
        todo = [p for p in todo if tm.get(p[1]) == a.testament]
    if a.only:
        want = {s.strip() for s in a.only.split(",") if s.strip()}
        todo = [p for p in todo if p[2] in want]
        missing = want - {p[2] for p in todo}
        if missing:
            print("진도표에 없거나 시작책 이전이라 제외됨:", ", ".join(missing))
    if a.books:
        todo = todo[:a.books]
    if not todo:
        print("처리할 책이 없습니다"); sys.exit(1)

    # 분담 생성 시 각 PC 에서 이 지문이 **반드시 같아야** 한다(같은 참조음/텍스트).
    upload_key = None if a.no_upload else (a.upload_key or engine.voice_upload_key(a.voice))
    print(f"[보이스] {a.voice} · 지문 {engine.voice_fingerprint(a.voice)}", flush=True)
    if upload_key:
        import server
        print(f"[업로드] 합격 절을 예봄성경 '{upload_key}' 로 자동 전송"
              f"{'' if server.enabled() else ' — 다만 서버 연동 정보(studio.json)가 없어 보류됩니다'}",
              flush=True)
    else:
        print("[업로드] 자동 전송 없음 (생성만 합니다)", flush=True)
    print(f"[진도표] {a.version} · {len(todo)}권 "
          f"({todo[0][2]} → {todo[-1][2]})", flush=True)

    t_all = time.time()
    if not a.replace_legacy:
        for seq, code, name, day in todo:
            jid, total, already = ensure_job(a.voice, a.version, name, a.batch, a.retry, seq,
                                             upload_key)
            if already:
                print(f"[{seq:2d}/66] {name} — 이미 완료, 건너뜀", flush=True)
                continue
            if not run_job(jid, total, f"[{seq:2d}/66] {name}"):
                return
        print(f"\n[남은 절 완료] {len(todo)}권 · {(time.time()-t_all)/3600:.1f}시간", flush=True)

    if a.replace_legacy or a.then_replace:
        if not upload_key:
            print("[교체] 업로드 없이는 교체할 수 없습니다 — --no-upload 를 빼고 다시 실행하세요")
            return
        print("\n[교체] 2026-09-10 이전 구방식 음원(절 끝이 짧게 잘림)을 새 방식으로 다시 만들어 교체합니다",
              flush=True)
        try:
            planned = ui.enqueue_replacement(a.voice, a.version, [(p[0], p[2]) for p in todo],
                                             upload_key, batch=a.batch, retry_max=a.retry)
        except RuntimeError as e:
            print(f"   {e} — 교체를 멈춥니다", flush=True)
            return
        for seq, name, jid, n in planned:
            if not jid:
                print(f"[교체 {seq:2d}/66] {name} — 구방식 절 없음", flush=True)
                continue
            if not run_job(jid, n, f"[교체 {seq:2d}/66] {name}"):
                return

    print(f"\n[전체 완료] {len(todo)}권 · {(time.time()-t_all)/3600:.1f}시간", flush=True)
    jobs.stop_worker()

if __name__ == "__main__":
    main()
