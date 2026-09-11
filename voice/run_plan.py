# run_plan.py — 성경읽기진도표 순서대로 여러 책을 이어서 생성한다.
#
#   python run_plan.py --voice 영희 --from 욥기            # 욥기부터 끝까지
#   python run_plan.py --voice 영희 --from 창세기 --books 3 # 창세기부터 3권만
#
# run_book.py 는 책 하나가 끝나면 워커를 멈춘다. 이건 진도표를 따라
# 다음 책으로 계속 넘어가며, 중단되어도 다시 실행하면 이어간다.

import argparse
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ── 무거운 모듈을 불러오기 전에 ──
# 바탕화면 배치 파일(신약 음원 이어하기 / 중지)은 영문·숫자만 쓴다. chcp 65001 뒤의 한글 줄을 cmd 가
# 잘못 끊어 조각을 명령으로 실행했다("'하지' is not recognized ..."). 그래서 배치가 하던 한글 안내,
# 창 제목, 두 번 실행 막기, 중지를 여기서 한다. 파이썬이 찍는 한글은 깨지지 않는다.
def _console_title(title):
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW(title)
    except Exception:
        pass


def _other_workers():
    """이 프로세스 말고 run_plan.py 로 도는 파이썬(중지 명령은 뺀다).

    워커는 한 번에 하나만 — GPU 하나를 둘이 나눠 쓰면 둘 다 느려지고 같은 절을 두 번 만든다."""
    cmd = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and "
           "$_.CommandLine -like '*run_plan.py*' -and $_.CommandLine -notlike '*--stop*' } | "
           "ForEach-Object { $_.ProcessId }")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                             capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return []
    me = os.getpid()
    return [int(x) for x in out.split() if x.strip().isdigit() and int(x) != me]


def _testament_label(argv):
    if "--testament" in argv:
        i = argv.index("--testament")
        nxt = argv[i + 1] if i + 1 < len(argv) else ""
        return {"new": "신약", "old": "구약"}.get(nxt, "성경")
    return "성경"


_LABEL = _testament_label(sys.argv)

if "--stop" in sys.argv:
    _console_title(f"예봄성경 {_LABEL} 음원 생성 중지")
    print("\n  생성 프로세스를 찾는 중...\n", flush=True)
    pids = _other_workers()
    if not pids:
        print("   돌고 있는 생성이 없습니다.")
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
        print(f"   중지: PID {pid}", flush=True)
    if pids:
        time.sleep(2)
        print("   중지했습니다.")
    print("\n  진행 상황은 그대로 저장되어 있습니다.")
    print(f"  나중에 '{_LABEL} 음원 이어하기' 를 누르면 멈춘 자리부터 계속합니다.\n")
    sys.exit(0)

if __name__ == "__main__" or "--guard" in sys.argv:
    _console_title(f"예봄성경 {_LABEL} 음원 생성 (이어하기)")
    if _other_workers():
        print("\n  이미 생성이 돌고 있습니다. 창을 두 개 띄우지 마세요.")
        print("  진행 상황은 이미 떠 있는 창에서 볼 수 있습니다.\n")
        sys.exit(3)
    if "--guard" in sys.argv:
        print("  돌고 있는 생성이 없습니다(--guard 시험).")
        sys.exit(0)

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
    ap.add_argument("--voice", default=None, help="보이스 이름(예: 영희)")
    ap.add_argument("--voice-key", default=None,
                    help="보이스를 성우 슬롯으로 고른다(예: f4) — 배치 파일에 한글을 쓰지 않으려고")
    ap.add_argument("--stop", action="store_true", help="돌고 있는 생성을 멈춘다(맨 위에서 처리)")
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
    if not a.voice and a.voice_key:
        a.voice = next((n for n in engine.list_voices() if engine.voice_upload_key(n) == a.voice_key), None)
    if not a.voice:
        print("보이스를 찾지 못했습니다 — --voice 또는 --voice-key 를 확인하세요")
        sys.exit(1)

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
    print(f"\n  {_LABEL} 음원 생성을 이어서 진행합니다.\n"
          "  - 이미 만든 절과 끝난 책은 건너뜁니다\n"
          "  - 합격한 절은 그때그때 예봄성경으로 자동 업로드됩니다\n"
          "  - 중단하려면 이 창을 닫으시면 됩니다 (지금까지 만든 것은 남습니다)\n", flush=True)
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

    # 끝난 책까지 본문을 최신 DB 로 맞춘다 — 정정된 본문의 절이 옛 본문으로 남아 음원이 끝내
    # 안 생기던 것을 막는다(요 1:42). 다시 만들 절이 생긴 책은 큐에 올라가 진도표 순서로 처리된다.
    requeued = jobs.refresh_all_jobs()
    if requeued:
        print(f"[본문 최신화] 끝난 책 {requeued}권에 다시 만들 절이 생겨 먼저 처리합니다", flush=True)
        jobs.start_worker()

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
    print("\n  생성이 종료되었습니다.")
