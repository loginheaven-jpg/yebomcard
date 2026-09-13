# fleet.py — 이 PC 를 서버에 연결해 둔다: 현황 보고 · 지시 수신 · 책 임대.
#
# 왜 있는가
#   음원 생성은 PC 여러 대가 며칠씩 도는 일이다. 지금까지 진행 상황은 이 PC 의 jobs/*.json
#   안에만 있어서, 이 PC 앞에 앉지 않으면 어디까지 왔는지·멈췄는지 알 수 없었다.
#   보류 절을 서버로 모아 한 화면에서 판단하게 만든 것과 같은 이유로 **진행과 지시도** 모은다.
#
# 하는 일 세 가지 (스레드 하나가 HEARTBEAT_SEC 마다 돈다)
#   1. 현황 보고 — 지금 만드는 절, 남은 절, 시간당 절 수, 책별 진행, 마지막 오류
#   2. 지시 수신 — 서버에 걸린 명령을 가져와 실행하고 결과를 돌려준다
#   3. 책 임대   — '전체 생성' 을 켜 두면 진도표 순서로 다음 책을 빌려 와 작업을 건다.
#                  겹치지 않게 서버가 나눠 주므로, PC 를 몇 대 붙이든 같은 절을 두 번 만들지 않는다.
#
# 서버가 잠깐 안 되어도 생성은 계속되어야 한다 — 여기서 나는 오류는 모두 삼키고 다음 차례에 다시 한다.
import hashlib
import json
import os
import platform
import socket
import subprocess  # noqa: F401  (다시 켤 때 쓴다)
import sys
import threading
import time
import traceback
from pathlib import Path

import engine
import jobs
import plan
import server

HERE = Path(__file__).resolve().parent
STATE = HERE / "fleet.json"       # 이 PC 의 설정(이름·전체 생성 여부) — 사람이 화면에서 바꾼다

HEARTBEAT_SEC = 10
# 임대는 매번 묻지 않는다 — 책 하나가 몇 시간짜리라 자주 물을 이유가 없고, 요청만 늘어난다
LEASE_EVERY_SEC = 60
# 한 번에 쥐는 책 수. 1 이면 한 권을 끝내야 다음을 가져가 배분이 촘촘하고,
# 2 면 앞 책이 끝나기 전에 다음이 준비돼 작업 사이 빈틈이 없다.
LEASE_HOLD = 2
# 시간당 절 수를 재는 창 — 짧으면 널뛰고, 길면 멈춘 것을 늦게 안다
RATE_WINDOW_SEC = 3600

_thread = None
_stop = threading.Event()
_last_error = ""
_rate = []          # [(시각, 합격 누계)] — 최근 것만 남긴다
_lock = threading.Lock()


# ───────────────────────── 이 PC 의 설정 ─────────────────────────
def state():
    """{'label':…, 'auto': bool, 'voice':…, 'version':…, 'batch':int, 'plan':…}"""
    d = {}
    try:
        d = json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        pass
    d.setdefault("label", socket.gethostname())
    d.setdefault("auto", False)          # 전체 생성(자동 배분) — 기본은 꺼 둔다
    d.setdefault("voice", "")
    d.setdefault("version", "새번역")
    d.setdefault("batch", 4)
    d.setdefault("plan", "새번역")       # 임대를 나누는 단위 — 역본이 다르면 따로 센다
    return d


def set_state(**kw):
    d = state()
    d.update({k: v for k, v in kw.items() if v is not None})
    try:
        STATE.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    return d


# ───────────────────────── 현황 ─────────────────────────
def _gpu():
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        pass
    return platform.processor()[:60] or "?"


# 이 PC 가 돌리는 스튜디오 소스의 지문. **PC 마다 같아야 한다** — 한 대만 옛 코드를 물고 있으면
# 그 PC 의 음원만 다른 규칙으로 만들어지는데, 결과물만 봐서는 알아채기 어렵다(검수 기준·절 끝
# 재시도 한도가 코드에 있다). 켤 때 서버와 소스를 맞추므로, 지문이 다르면 '껐다 켜지 않은 PC' 다.
_CODE_FILES = ("engine.py", "jobs.py", "app.py", "server.py", "fleet.py", "prosody.py", "plan.py")


def _compute_code_version():
    """소스의 내용 지문. **줄 끝을 통일해서** 센다.

    서버가 내려주는 사본은 줄 끝이 LF 이고(bootstrap.sync_code 가 newline 을 LF 로 고정해 쓴다),
    git 으로 받는 개발 PC 는 CRLF 인 파일이 섞인다. 바이트를 그대로 세면 **같은 코드인데 지문이
    달라져** 헛경고가 뜬다 — 2026-09-14 에 prosody.py 하나 때문에 두 PC 가 다른 것으로 보였다."""
    h = hashlib.sha1()
    for name in _CODE_FILES:
        try:
            h.update((HERE / name).read_bytes().replace(b"\r\n", b"\n"))
        except Exception:
            h.update(b"?")
    return h.hexdigest()[:8]


_CODE_VERSION = _compute_code_version()


def _code_version():
    """스튜디오 소스 지문 — 프로세스를 켠 시점의 코드다(도중에 파일이 바뀌어도 돌고 있는 것은 옛 코드)."""
    return _CODE_VERSION


def _rate_per_hour(ok_total):
    """최근 한 시간 동안 합격한 절 수. 창이 덜 찼으면 지금까지의 속도로 환산한다."""
    now = time.time()
    with _lock:
        _rate.append((now, ok_total))
        while _rate and now - _rate[0][0] > RATE_WINDOW_SEC:
            _rate.pop(0)
        if len(_rate) < 2:
            return 0
        t0, n0 = _rate[0]
        el = now - t0
    if el < 60:
        return 0
    return max(0, round((ok_total - n0) * 3600 / el))


def snapshot():
    """서버에 보낼 지금 상태. 화면에서도 같은 값을 쓴다."""
    st = state()
    cur = jobs.current()
    js = jobs.list_jobs()
    pending = ok_total = held_total = up_total = 0
    queued = 0
    job_title = ""
    batch = 0
    for j in js:
        o, h, p = jobs.counts(j)
        ok_total += o
        held_total += h
        pending += p
        up_total += sum(1 for i in j.get("items") or [] if i.get("uploaded"))
        if j.get("status") in ("queued", "running") and p:
            queued += 1
        if j["id"] == cur.get("job"):
            job_title = j.get("title", "")
            batch = int(j.get("batch") or 0)

    books = []
    cj = next((j for j in js if j["id"] == cur.get("job")), None)
    if cj:
        books = _book_rows(cj)

    # 보이스는 '전체 생성' 설정에서 오지만, 그것을 켜지 않고 작업만 거는 PC 도 있다 —
    # 그럴 땐 지금(또는 가장 최근) 작업이 쓰는 보이스를 보여 준다. 화면에 빈칸이 뜨면
    # 이 PC 가 무엇으로 만들고 있는지 알 수가 없다.
    voice = st.get("voice") or (cj or (js[0] if js else {})).get("voice") or ""

    return {
        "label": st["label"],
        "host": socket.gethostname(),
        "gpu": _gpu(),
        "codeVersion": _code_version(),
        "voice": voice,
        "voiceKey": (engine.voice_upload_key(voice) or "") if voice else "",
        "running": jobs.worker_alive(),
        "note": cur.get("note", ""),
        "jobId": cur.get("job"),
        "jobTitle": job_title,
        "batch": batch,
        "versesPerHour": _rate_per_hour(ok_total),
        "queued": queued,
        "pending": pending,
        "okTotal": ok_total,
        "heldTotal": held_total,
        "uploadedTotal": up_total,
        "books": books,
        "leases": st.get("leases", []),
        "lastError": _last_error,
    }


def _book_rows(job):
    """지금 도는 작업의 책별 진행 — 절 참조에서 책 이름을 뽑아 묶는다."""
    agg = {}
    for it in job.get("items") or []:
        # "창세기 3:14" → "창세기". 책 이름에 띄어쓰기가 없으므로 마지막 칸만 떼면 된다
        ref = it.get("ref") or ""
        b = ref[: ref.rfind(" ")] if " " in ref else ref
        r = agg.setdefault(b, {"book": b, "total": 0, "done": 0, "held": 0, "uploaded": 0})
        r["total"] += 1
        if it["status"] in ("ok", "held", "skip"):
            r["done"] += 1
        if it["status"] == "held":
            r["held"] += 1
        if it.get("uploaded"):
            r["uploaded"] += 1
    return list(agg.values())


# ───────────────────────── 지시 ─────────────────────────
def _do_command(c):
    """명령 하나를 실행하고 사람이 읽을 결과 문자열을 돌려준다."""
    import app as ui

    op = c.get("op")
    a = c.get("args") or {}
    st = state()

    if op == "stop":
        jobs.stop_worker()
        return "워커를 멈췄습니다"

    if op == "resume":
        jobs.start_worker()
        return "워커를 다시 켰습니다"

    if op == "set_batch":
        n = jobs.set_batch(a.get("jobId") or (jobs.current().get("job") or ""), a.get("batch", 4))
        return f"배치 {n}"

    if op == "delete_job":
        jid = a.get("jobId") or ""
        return "지웠습니다" if jobs.delete_job(jid) else "지우지 못했습니다(도는 작업이거나 없음)"

    if op == "queue_books":
        voice = a.get("voice") or st.get("voice")
        if not voice:
            return "보이스가 정해지지 않았습니다"
        version = a.get("version") or st.get("version") or "새번역"
        books = a.get("books") or []
        if not books:
            return "책 목록이 비었습니다"
        n = 0
        for b in books:
            jid, total, already = _ensure_book_job(voice, version, b, int(a.get("batch") or st["batch"]))
            if not already:
                n += 1
        jobs.start_worker()
        return f"{len(books)}권 중 {n}권을 큐에 올렸습니다"

    if op == "queue_replace":
        voice = a.get("voice") or st.get("voice")
        if not voice:
            return "보이스가 정해지지 않았습니다"
        version = a.get("version") or st.get("version") or "새번역"
        which = a.get("which") or "구약"
        msg, _rows = ui.ui_replace_legacy(voice, version, which,
                                          int(a.get("batch") or st["batch"]), 0.75, True, 3)
        jobs.start_worker()
        return " ".join(str(msg).split())[:300]

    if op == "regen_refs":
        refs = a.get("refs") or []
        if not refs:
            return "절 목록이 비었습니다"
        n = jobs.requeue_refs(refs)
        jobs.start_worker()
        return f"{n}절을 다시 만들기로 했습니다"

    if op == "restart":
        # 코드가 바뀌면 **프로세스를 다시 켜야** 반영된다 — 돌고 있는 파이썬은 옛 코드를 물고 있다.
        # 사람이 PC 앞에 가서 창을 닫고 배치 파일을 다시 누르는 일을 여기서 대신한다.
        if a.get("worker_only"):
            jobs.stop_worker()
            time.sleep(1.0)
            jobs.start_worker()
            return "워커만 다시 시작했습니다(코드는 그대로입니다)"
        return _restart_studio()

    return f"모르는 명령: {op}"


def _restart_studio():
    """서버와 소스를 맞춘 뒤 스튜디오를 새 프로세스로 다시 켜고, 이 프로세스는 물러난다.

    왜 이렇게까지 하는가
      검수 기준·절 끝 재시도 한도 같은 규칙이 코드에 있다. 한 PC 가 옛 코드를 물고 있으면 그 PC 의
      음원만 다른 규칙으로 만들어지는데 결과물만 봐서는 알아채기 어렵다. 그런데 고칠 때마다 PC 마다
      찾아가 창을 닫고 배치 파일을 다시 눌러야 했다 — 여러 대가 되면 그것부터 빠뜨린다.

    잃는 것은 **지금 만들던 묶음 하나**(최대 8절)뿐이다. 작업 상태는 묶음마다 파일에 저장되므로
    다시 켜면 그 자리에서 이어간다.

    새 프로세스는 **떼어 내어** 띄운다 — 이 프로세스가 곧 사라지므로 자식으로 두면 함께 죽는다.
    """
    import subprocess

    synced = ""
    try:
        # 설치본이면 bootstrap 이 서버에서 소스를 받아 온다(개발 PC 는 git 이 소스라 건너뛴다)
        if (HERE / "실행.bat").exists() or (HERE / "bootstrap.py").exists():
            import bootstrap
            if getattr(bootstrap, "BASE", "") and getattr(bootstrap, "TOKEN", ""):
                bootstrap.sync_code()
                synced = " · 소스를 서버와 맞췄습니다"
    except Exception as e:
        synced = f" · 소스 맞추기는 건너뜀({str(e)[:60]})"

    jobs.stop_worker()
    # 창을 새로 띄운다(CREATE_NEW_CONSOLE). DETACHED_PROCESS 와 **함께 쓸 수 없다** — 윈도우가
    # 인자 오류로 거절한다. 새 콘솔이면 부모 콘솔과 이미 끊어지고, CREATE_BREAKAWAY_FROM_JOB 을
    # 더하면 부모를 묶은 작업 개체(터미널·설치 스크립트)가 죽을 때 딸려 죽지 않는다. 그 권한이
    # 없는 환경도 있어 실패하면 그것만 빼고 다시 해 본다.
    argv = [sys.executable, str(HERE / "app.py")]
    base = getattr(subprocess, "CREATE_NEW_CONSOLE", 0) if os.name == "nt" else 0
    away = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0) if os.name == "nt" else 0
    for flags in (base | away, base):
        try:
            subprocess.Popen(argv, cwd=str(HERE), creationflags=flags, close_fds=True)
            break
        except OSError as e:
            last = e
    else:
        jobs.start_worker()
        return f"다시 켜지 못했습니다: {last}"

    def _bye():
        time.sleep(2.0)      # 결과를 서버에 적을 틈을 준다
        os._exit(0)

    threading.Thread(target=_bye, daemon=True).start()
    return f"스튜디오를 다시 켭니다{synced} — 만들던 묶음 하나만 다시 만듭니다"


def _ensure_book_job(voice, version, book, batch):
    """그 책의 작업이 있으면 이어하고, 없으면 새로 건다. (작업id, 절수, 이미완료)"""
    import app as ui

    title = f"{version} {book}"
    seq = plan.BY_NAME.get(book, (9999,))[0]
    for j in jobs.list_jobs():
        if j.get("title") == title and j.get("voice") == voice:
            _ok, _held, pend = jobs.counts(j)
            if j.get("status") == "done" and pend == 0:
                return j["id"], len(j["items"]), True
            jobs.requeue(j["id"])
            return j["id"], len(j["items"]), False
    items = ui.build_items(voice, "성경 범위", version, [book], None, None, "", None)
    jid = jobs.new_job(voice, title, items, batch=batch, seq=seq,
                       upload_key=engine.voice_upload_key(voice))
    return jid, len(items), False


# ───────────────────────── 임대 ─────────────────────────
def _lease_round():
    """전체 생성이 켜져 있으면 진도표 순서로 다음 책을 빌려 와 작업을 건다."""
    st = state()
    if not st.get("auto") or not st.get("voice"):
        return
    version = st.get("version") or "새번역"
    order = [p[2] for p in plan.PLAN_ORDER]

    # 내가 쥔 책 중 끝난 것을 먼저 보고한다 — 그래야 서버가 다음 책을 내준다
    done = []
    for b in list(st.get("leases", [])):
        title = f"{version} {b}"
        j = next((x for x in jobs.list_jobs() if x.get("title") == title), None)
        if j:
            _ok, _held, pend = jobs.counts(j)
            if j.get("status") == "done" and pend == 0:
                done.append(b)

    r = server.lease(st.get("plan") or version, order, want=LEASE_HOLD,
                     done=done, label=st["label"])
    if not r:
        return
    holding = list(r.get("held") or []) + list(r.get("granted") or [])
    set_state(leases=holding)
    for b in r.get("granted") or []:
        try:
            _ensure_book_job(st["voice"], version, b, int(st.get("batch") or 4))
            print(f"[분담] '{b}' 를 맡았습니다 — 작업을 걸었습니다", flush=True)
        except Exception as e:
            print(f"[분담] '{b}' 작업을 걸지 못했습니다: {e}", flush=True)
    if holding:
        jobs.start_worker()


# ───────────────────────── 루프 ─────────────────────────
def _loop():
    global _last_error
    next_lease = 0.0
    while not _stop.is_set():
        try:
            if server.enabled():
                server.fleet_report(snapshot())
                for c in server.fleet_commands():
                    try:
                        msg = _do_command(c)
                        server.fleet_command_done(c["id"], "done", msg)
                        print(f"[지시] {c.get('op')} — {msg}", flush=True)
                    except Exception as e:
                        server.fleet_command_done(c["id"], "failed", str(e)[:300])
                        print(f"[지시] {c.get('op')} 실패: {e}", flush=True)
                if time.time() >= next_lease:
                    next_lease = time.time() + LEASE_EVERY_SEC
                    _lease_round()
            _last_error = ""
        except Exception as e:
            _last_error = f"{type(e).__name__}: {e}"[:300]
            if os.environ.get("YEBOM_DEBUG"):
                traceback.print_exc()
        _stop.wait(HEARTBEAT_SEC)


def start():
    """스튜디오가 켜질 때 부른다. 서버 연동이 없으면 아무 일도 하지 않는다."""
    global _thread
    if _thread and _thread.is_alive():
        return False
    if not server.enabled():
        return False
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="fleet")
    _thread.start()
    return True


def stop():
    _stop.set()


def alive():
    return bool(_thread and _thread.is_alive()) and not _stop.is_set()
