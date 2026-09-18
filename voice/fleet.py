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
_started_at = [0.0]      # 이 프로세스를 켠 때 — 켠 직후의 헛된 다시 켜기를 막는다
_rate = []          # [(시각, 워커가 만든 절 누계)] — 최근 것만 남긴다
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
    d.setdefault("batch", jobs.DEFAULT_BATCH)
    d.setdefault("plan", "새번역")       # 임대를 나누는 단위 — 역본이 다르면 따로 센다
    d.setdefault("polite", False)        # 사람이 쓰는 PC — 생성이 앞자리를 차지하지 않게
    return d


def set_state(**kw):
    d = state()
    d.update({k: v for k, v in kw.items() if v is not None})
    try:
        STATE.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    return d


# ───────────────────────── 양보 모드 ─────────────────────────
def apply_polite(on=None):
    """사람이 함께 쓰는 PC 에서 생성이 앞자리를 차지하지 않게 한다.

    **배치를 낮추는 것은 이 목적에 거의 쓸모가 없다** — 생성은 CPU 코어 하나가 정하는 일이라
    묶음 크기를 줄여도 그 코어는 그대로 붙잡힌다(배치를 낮추면 줄어드는 것은 그래픽 메모리다).
    실제로 듣는 약은 두 가지다.

      1. **프로세스 우선순위를 낮춘다**(BELOW_NORMAL). 놀고 있을 때는 전속력으로 쓰고,
         사람이 뭔가를 하면 곧바로 양보한다 — 총량을 깎지 않고 체감만 없앤다.
      2. **torch 가 쓰는 CPU 스레드를 줄인다**. 기본은 코어의 절반이라 배경 작업치고는 과하다.

    무인 PC 에서는 켜지 않는다 — 느려질 이유가 없다."""
    st = state()
    if on is None:
        on = bool(st.get("polite"))
    else:
        set_state(polite=bool(on))
        on = bool(on)
    done = []
    try:
        import psutil
        pr = psutil.Process()
        want = psutil.BELOW_NORMAL_PRIORITY_CLASS if on else psutil.NORMAL_PRIORITY_CLASS
        if pr.nice() != want:
            pr.nice(want)
        done.append("우선순위 " + ("낮춤" if on else "보통"))
    except Exception as e:
        done.append(f"우선순위 못 바꿈({str(e)[:40]})")
    try:
        import torch
        n = max(1, (os.cpu_count() or 4) // 4) if on else max(1, (os.cpu_count() or 4) // 2)
        torch.set_num_threads(n)
        done.append(f"CPU 스레드 {n}")
    except Exception as e:
        done.append(f"스레드 못 바꿈({str(e)[:40]})")
    msg = ("양보 모드 켬 — " if on else "양보 모드 끔 — ") + " · ".join(done)
    print(f"[양보] {msg}", flush=True)
    return msg


# ───────────────────────── 다시 만들 후보 ─────────────────────────
# 끝음절 값·일치율은 **이 PC 의 작업 파일에만** 있다(서버는 모른다). 그래서 PC 가 후보를 세어
# 보고하고, 사람이 화면에서 보고 눌러야 다시 만들기 요청이 나간다 — 자동이되 최종 결정권은 사람에게.
#
# 한 번에 보내는 절 수는 서버가 50으로 막는다(verseRegen.MAX_VERSES_PER_REQUEST). 그래서 가장
# 나쁜 것부터 그만큼만 싣는다. 세는 데 0.3초쯤 걸리니 10초마다 하지 않고 10분에 한 번만 한다.
REWORK_SCAN_EVERY_SEC = 600
REWORK_SEND_MAX = 50
_rework = {"at": 0.0, "data": {}}


def _rework_report():
    """조건마다 {개수, 가장 나쁜 것 몇 절}. 10분에 한 번만 다시 센다."""
    if time.time() - _rework["at"] < REWORK_SCAN_EVERY_SEC and _rework["data"]:
        return _rework["data"]
    out = {}
    try:
        for kind in jobs.REWORK_KINDS:
            cands = jobs.rework_candidates(kind, voice=current_voice() or None)
            items = []
            for c in cands[:REWORK_SEND_MAX]:
                # key 는 "rnksv_1ch_027_021" 꼴 — 다시 만들기 요청은 책코드·장·절로 보낸다
                parts = (c.get("key") or "").split("_")
                items.append({"ref": c["ref"], "why": c["why"]})
                if len(parts) == 4:
                    items[-1].update({"code": parts[1], "chapter": int(parts[2]), "verse": int(parts[3])})
            out[kind] = {"count": len(cands), "label": jobs.REWORK_KINDS[kind], "items": items}
    except Exception as e:
        print(f"[다시 만들기] 후보를 세지 못했습니다: {str(e)[:80]}", flush=True)
        return _rework["data"]
    _rework["at"] = time.time()
    _rework["data"] = out
    return out


# ───────────────────────── 기계 상태 ─────────────────────────
# PC 앞에 가지 않고도 '왜 느린가' 를 보려고 싣는다(2026-09-18). 3080 Ti 가 41시간에 195절만 만들었는데
# 그래픽 메모리가 넘친 것인지, 다른 프로그램이 쓰는 것인지, 과열인지 원격으로 알 길이 없었다.
#
# · 그래픽카드 — nvidia-smi: 메모리·사용률·온도·전력·클럭·클럭을 깎는 이유(전력 제한·과열)
# · 스튜디오가 잡은 그래픽 메모리 — 윈도우 GPU 성능 카운터의 **공유 메모리(Shared)** 가 핵심이다.
#   전용 메모리가 모자라면 드라이버가 예외 없이 시스템 메모리로 흘려보내고(§4.3), 그 양이 여기 잡힌다
# · 그래픽 메모리를 많이 쓰는 프로그램 · CPU 를 많이 쓰는 프로그램 · CPU·RAM 사용률
#
# psutil 은 설치본에 없을 수 있어 쓰지 않는다 — 윈도우 WMI(이름이 한글판에서도 영문 그대로다.
# Get-Counter 는 카운터 이름이 현지화돼 한글 윈도우에서 깨진다)를 파워셸 한 번으로 읽는다.
# 한 번에 수 초 걸려 10초마다 하지 않고 뒤에서 2분마다 한다. 무엇이 실패해도 보고는 멈추지 않는다.
SYS_SAMPLE_EVERY_SEC = 120
_sys = {"at": 0.0, "data": {}, "busy": False}

_NVSMI_FIELDS = ("memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit,"
                 "clocks.sm,clocks.max.sm,pstate")
# 드라이버에 따라 이름이 다르다(새 이름 clocks_event_reasons, 옛 이름 clocks_throttle_reasons)
_NVSMI_REASONS = ("clocks_event_reasons.active", "clocks_throttle_reasons.active")
# 클럭을 깎는 이유 — 쉬는 중(0x1)과 앱 설정(0x2)은 뺀다. 사람이 손쓸 일만 적는다
_REASON_BITS = ((0x4, "전력 제한"), (0x8, "하드웨어 감속"), (0x40, "과열(소프트웨어)"),
                (0x80, "과열(하드웨어)"), (0x100, "전원 부족"))

_WIN_PROBE = r"""
$ErrorActionPreference = 'SilentlyContinue'
$names = @{}
Get-Process | ForEach-Object { $names[[int]$_.Id] = $_.ProcessName }
$g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory |
  Where-Object { $_.DedicatedUsage -gt 50MB -or $_.SharedUsage -gt 50MB } | ForEach-Object {
    $id = 0; if ($_.Name -match '^pid_(\d+)_') { $id = [int]$Matches[1] }
    @{ pid = $id; name = $names[$id]; d = [int64]$_.DedicatedUsage; s = [int64]$_.SharedUsage } })
$p = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } |
  Sort-Object PercentProcessorTime -Descending | Select-Object -First 6 | ForEach-Object {
    @{ pid = [int]$_.IDProcess; name = $_.Name; cpu = [int]$_.PercentProcessorTime } })
$c = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
$o = Get-CimInstance Win32_OperatingSystem
@{ gpu = $g; top = $p; cpu = [int]$c; free = [int64]$o.FreePhysicalMemory; total = [int64]$o.TotalVisibleMemorySize } |
  ConvertTo-Json -Depth 4 -Compress
"""


def _nvsmi():
    import subprocess as sp
    flags = getattr(sp, "CREATE_NO_WINDOW", 0)
    for extra in _NVSMI_REASONS + ("",):
        q = _NVSMI_FIELDS + ("," + extra if extra else "")
        try:
            r = sp.run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader,nounits"],
                       capture_output=True, text=True, timeout=15, creationflags=flags)
        except Exception:
            return {}
        if r.returncode != 0 or not r.stdout.strip():
            continue                     # 모르는 칸이 있으면 통째로 실패한다 — 칸을 빼고 다시
        v = [x.strip() for x in r.stdout.strip().splitlines()[0].split(",")]

        def f(i):
            try:
                return float(v[i])
            except (IndexError, ValueError):
                return None
        out = {"memUsedMb": f(0), "memTotalMb": f(1), "util": f(2), "tempC": f(3),
               "powerW": f(4), "powerLimitW": f(5), "clockMhz": f(6), "clockMaxMhz": f(7),
               "pstate": v[8] if len(v) > 8 else ""}
        if extra and len(v) > 9:
            try:
                bits = int(v[9], 16)
                out["limits"] = [name for bit, name in _REASON_BITS if bits & bit]
            except ValueError:
                pass
        return {k: x for k, x in out.items() if x is not None}
    return {}


def _win_probe():
    if os.name != "nt":
        return {}
    import base64
    import subprocess as sp
    enc = base64.b64encode(_WIN_PROBE.encode("utf-16-le")).decode("ascii")
    try:
        r = sp.run(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc],
                   capture_output=True, timeout=90, creationflags=getattr(sp, "CREATE_NO_WINDOW", 0))
        return json.loads(r.stdout.decode("utf-8", "replace").strip() or "{}")
    except Exception:
        return {}


def _torch_mem():
    try:
        import torch
        if not torch.cuda.is_available():
            return {}
        mb = 1024 * 1024
        return {"reservedMb": round(torch.cuda.memory_reserved(0) / mb),
                "peakMb": round(torch.cuda.max_memory_reserved(0) / mb)}
    except Exception:
        return {}


def _sample_sys():
    try:
        me = os.getpid()
        cores = os.cpu_count() or 1
        w = _win_probe()
        procs = []
        for g in w.get("gpu") or []:
            procs.append({"name": (g.get("name") or "?")[:40], "pid": int(g.get("pid") or 0),
                          "dedicatedMb": round((g.get("d") or 0) / 1048576),
                          "sharedMb": round((g.get("s") or 0) / 1048576)})
        procs.sort(key=lambda x: x["dedicatedMb"] + x["sharedMb"], reverse=True)
        studio = next((p for p in procs if p["pid"] == me), None)
        # 프로세스 CPU% 는 코어 하나 기준(100 을 넘는다). 생성은 코어 하나에 묶이므로(§7) 전체 대비 %
        # 로만 보이면 20코어 PC 에서 5% 로 한가해 보인다 — 코어 수(cores = 1.0 이면 코어 하나를 다 씀)로 싣는다
        top = [{"name": (t.get("name") or "?")[:40], "pid": int(t.get("pid") or 0),
                "cores": round((t.get("cpu") or 0) / 100, 1)} for t in (w.get("top") or [])]
        data = {
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "gpu": _nvsmi(),
            "studio": {**_torch_mem(),
                       **({"dedicatedMb": studio["dedicatedMb"], "sharedMb": studio["sharedMb"]}
                          if studio else {})},
            "gpuProcs": [{**p, "self": p["pid"] == me} for p in procs[:5]],
            "topCpu": [{**t, "self": t["pid"] == me} for t in top if t["cores"] >= 0.1][:4],
            "cores": cores,
        }
        if w.get("total"):
            data["cpu"] = w.get("cpu")
            data["ramTotalMb"] = round(w["total"] / 1024)
            data["ramUsedMb"] = round((w["total"] - (w.get("free") or 0)) / 1024)
        _sys["data"] = data
    except Exception as e:
        print(f"[기계 상태] 읽지 못했습니다: {str(e)[:80]}", flush=True)
    finally:
        _sys["at"] = time.time()
        _sys["busy"] = False


def _sys_report():
    """기계 상태 — 묵었으면 뒤에서 다시 잰다(보고는 기다리지 않고 지난 값을 싣는다)."""
    if not _sys["busy"] and time.time() - _sys["at"] >= SYS_SAMPLE_EVERY_SEC:
        _sys["busy"] = True
        threading.Thread(target=_sample_sys, daemon=True, name="fleet-sys").start()
    return _sys["data"]


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


def _rate_per_hour():
    """최근 한 시간 동안 이 PC 가 만들어 합격시킨 절 수. 창이 덜 찼으면 지금까지의 속도로 환산한다.

    작업 파일의 합격 누계가 아니라 워커 카운터(jobs.made_count)로 잰다 — 건너뛴 절이 섞이면
    책이 바뀔 때마다 속도가 수십만으로 튄다."""
    now = time.time()
    made = jobs.made_count()
    with _lock:
        _rate.append((now, made))
        while _rate and now - _rate[0][0] > RATE_WINDOW_SEC:
            _rate.pop(0)
        if len(_rate) < 2:
            return 0
        t0, n0 = _rate[0]
        el = now - t0
    if el < 60:
        return 0
    return max(0, round((made - n0) * 3600 / el))


def current_voice():
    """이 PC 가 쓰는 보이스.

    '전체 생성' 설정에서 오지만, 그것을 켜지 않고 작업만 거는 PC 도 있다 — 그럴 땐 지금(또는 가장
    최근) 작업이 쓰는 보이스를 쓴다. 예전에는 화면 표시에만 이 대비가 있어서, 지시로 책을 걸면
    '보이스가 정해지지 않았습니다' 로 거절됐다(2026-09-15)."""
    st = state()
    if st.get("voice"):
        return st["voice"]
    cur = jobs.current()
    js = jobs.list_jobs()
    cj = next((j for j in js if j["id"] == cur.get("job")), None)
    return (cj or (js[0] if js else {})).get("voice") or ""


def snapshot():
    """서버에 보낼 지금 상태. 화면에서도 같은 값을 쓴다."""
    st = state()
    cur = jobs.current()
    js = jobs.list_jobs()
    pending = ok_total = held_total = up_total = 0
    queued = error_jobs = 0
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
        if j.get("status") == "error" and p:
            error_jobs += 1      # 사람이 봐야 할 수도 있다 — 자동 회복이 세 번 하고 손을 뗀다
        if j["id"] == cur.get("job"):
            job_title = j.get("title", "")
            batch = int(j.get("batch") or 0)

    books = []
    cj = next((j for j in js if j["id"] == cur.get("job")), None)
    if cj:
        books = _book_rows(cj)

    voice = current_voice()

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
        "versesPerHour": _rate_per_hour(),
        "queued": queued,
        "errorJobs": error_jobs,
        "rework": _rework_report(),
        "pending": pending,
        "okTotal": ok_total,
        "heldTotal": held_total,
        "uploadedTotal": up_total,
        "books": books,
        "leases": st.get("leases", []),
        "polite": bool(st.get("polite")),
        "lastError": _last_error,
        "sys": _sys_report(),
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
        n = max(1, min(8, int(a.get("batch", jobs.DEFAULT_BATCH))))
        if a.get("pc_wide"):
            # 이 PC 가 앞으로 집는 작업에도 적용한다 — 대기 중인 책들이 기본값으로 돌아가지 않게
            set_state(batch=n)
            jobs.pc_batch[0] = n
            jobs.set_batch(jobs.current().get("job") or "", n)
            return f"이 PC 의 배치를 {n} 로 정했습니다(지금 작업과 앞으로 집는 작업 모두)"
        jobs.set_batch(a.get("jobId") or (jobs.current().get("job") or ""), n)
        return f"배치 {n}"

    if op == "delete_job":
        jid = a.get("jobId") or ""
        return "지웠습니다" if jobs.delete_job(jid) else "지우지 못했습니다(도는 작업이거나 없음)"

    if op == "queue_books":
        voice = a.get("voice") or current_voice()
        if not voice:
            return "보이스가 정해지지 않았습니다 — 스튜디오 '전체 생성'에서 고르거나 --voice 로 주세요"
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
        voice = a.get("voice") or current_voice()
        if not voice:
            return "보이스가 정해지지 않았습니다 — 스튜디오 '전체 생성'에서 고르거나 --voice 로 주세요"
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

    if op == "polite":
        return apply_polite(bool(a.get("on", True)))

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


def _code_update_round():
    """소스가 바뀌었으면 '다시 켜야 한다' 고 알린다.

    두 갈래를 **한 가지 기준**으로 판단한다 — 디스크의 소스 지문이 지금 돌고 있는 것과 다른가.
      · 설치본: 서버에서 새 소스를 받아 온다(bootstrap.sync_code) → 받았으면 지문이 달라진다
      · 개발 PC: 사람이 git 으로 바꾼다 → 서버와 무관하게 지문이 달라진다

    예전에는 개발 PC 를 아예 건너뛰었다. 그러니 push 할 때마다 그 PC 만 옛 코드로 남아
    '코드가 다릅니다' 경고가 늘 떠 있었다(2026-09-16). 받아 두기만 해서는 소용이 없다 —
    돌고 있는 파이썬은 이미 읽어 들인 옛 코드를 물고 있으므로 다시 켜야 반영된다."""
    try:
        import bootstrap
        if getattr(bootstrap, "BASE", "") and getattr(bootstrap, "TOKEN", ""):
            bootstrap.sync_code()
    except Exception as e:
        print(f"[코드] 서버와 맞추지 못했습니다(다음에 다시 합니다): {str(e)[:80]}", flush=True)
        # 그래도 디스크가 바뀌었을 수 있으니 아래 비교는 해 본다
    now = _compute_code_version()
    if now == _CODE_VERSION:
        return False
    print(f"[코드] 소스가 바뀌었습니다({_CODE_VERSION} → {now}) — 반영하려면 다시 켜야 합니다",
          flush=True)
    return True


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
    voice = current_voice()
    if not st.get("auto") or not voice:
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
            _ensure_book_job(voice, version, b, int(st.get("batch") or jobs.DEFAULT_BATCH))
            print(f"[분담] '{b}' 를 맡았습니다 — 작업을 걸었습니다", flush=True)
        except Exception as e:
            print(f"[분담] '{b}' 작업을 걸지 못했습니다: {e}", flush=True)
    if holding:
        jobs.start_worker()


# ───────────────────────── 오류 회복 ─────────────────────────
# 작업이 error 로 세워지면 워커가 집지 않아 PC 가 논다. 사람이 알아채기 전까지 몇 시간이 그냥 간다
# (2026-09-14: 드라이버를 올리고 재부팅한 사이 432절이 멈춘 채 남았다). 스스로 일으켜 세운다.
#
# 두 갈래로 나눈다.
#   · CUDA·그래픽 드라이버 쪽 오류 → **프로세스를 다시 켠다.** 한 번 망가진 CUDA 문맥은 같은
#     프로세스 안에서 되살릴 수 없어, 그 자리에서 다시 시도해 봐야 같은 오류만 되풀이한다.
#   · 그 밖(일시적 통신 오류 등)   → 그 자리에서 다시 큐에 올린다. 프로세스를 껐다 켤 일이 아니다.
#
# 되풀이 사고를 막는 한도: 같은 작업을 ERROR_REQUEUE_MAX 번까지만 다시 올리고,
# 다시 켜기는 RESTART_WINDOW_SEC 안에 RESTART_MAX 번까지만 한다. 넘으면 사람이 봐야 한다.
ERROR_REQUEUE_MAX = 3
RESTART_MAX = 3
RESTART_WINDOW_SEC = 3600
# 켠 지 이만큼 안에는 **다시 켜지 않는다.**
#
# 2026-09-16 지휘부 보고: PC3 에서 배치 파일을 누르면 '서버에 보고합니다' 까지 나오고 **창이 저절로
# 닫히는** 일이 두 번 있었다. 원인은 여기였다 — 앞서 오류로 세워진 작업이 남아 있으면, 막 켜진
# 스튜디오가 그것을 보고 '그래픽 쪽 사고' 로 판단해 곧바로 다시 켰다. 다시 켜기는 새 창을 띄우고
# 스스로 물러나므로, 사람 눈에는 방금 연 창이 그냥 닫힌 것으로 보인다.
#
# 게다가 **소용도 없다.** 사람이 배치 파일을 누른 것이 이미 새 프로세스다 — 그 위에 또 새 프로세스를
# 얹는다고 달라질 것이 없다. 켠 직후에는 다시 큐에 올리기만 하고, 정말 도는 중에 사고가 났을 때만
# 다시 켠다.
RESTART_GRACE_SEC = 600

# 서버에 새 코드가 올라왔는지 이 간격으로 확인한다.
#
# 왜 필요한가(2026-09-16): 스튜디오는 **켤 때만** 서버와 소스를 맞춘다. 며칠씩 도는 일이라
# 그동안 고친 것이 한 대에만 닿지 않은 채 남는다 — 새 PC 가 '기어가는 배치 자동 감지' 없이
# 12GB·배치 8 로 돌고 있었다. 검수 기준과 재시도 규칙이 코드에 있어서, 한 대만 옛 코드를 물면
# 그 PC 의 음원만 다른 규칙으로 만들어지는데 결과물만 봐서는 알 수 없다.
# 사람이 현황 화면의 경고를 보고 손으로 다시 켜 주기를 기다릴 일이 아니다.
#
# 소스가 실제로 바뀌었을 때만 다시 켜므로 맴돌지 않는다(안 바뀌면 아무 일도 없다).
# 서버에서 소스를 받지 않는 개발 PC 는 저절로 건너뛴다(bootstrap 에 접속 정보가 없다).
CODE_SYNC_EVERY_SEC = 1800
_CUDA_WORDS = ("cuda", "cudnn", "nvml", "device-side", "no kernel image", "driver")


def _is_gpu_error(msg):
    """다시 켜면 풀릴 그래픽 쪽 사고인가.

    **메모리 부족은 여기서 뺀다.** 다시 켠다고 VRAM 이 늘지 않으므로 같은 자리에서 또 모자란다 —
    헛되이 세 번 다시 켠 뒤에야 사람에게 알리게 된다. 메모리 부족은 워커가 배치를 낮추고
    검수를 CPU 로 내려 스스로 감당하고(jobs._process), 그래도 안 되면 바로 사람에게 알린다."""
    m = (msg or "").lower()
    if "out of memory" in m:
        return False
    return any(w in m for w in _CUDA_WORDS)


def _recover_errors():
    """오류로 멈춘 작업을 일으켜 세운다. 다시 켜야 하면 True."""
    global _last_error
    for j in jobs.list_jobs():
        if j.get("status") != "error":
            continue
        _ok, _held, pend = jobs.counts(j)
        if not pend:
            continue
        err = str(j.get("error") or "")
        n = int(j.get("error_retries") or 0)
        if n >= ERROR_REQUEUE_MAX:
            _last_error = (f"'{j.get('title','')}' 가 {n}번 다시 시도해도 오류로 멈춥니다 — "
                           f"사람이 봐야 합니다: {err[:100]}")
            continue

        job = jobs.load(j["id"])
        if not job:
            continue
        job["error_retries"] = n + 1
        job["last_error"] = job.pop("error", err)
        job["status"] = "queued"
        jobs.save(job)
        print(f"[회복] '{job.get('title','')}' 오류로 멈춰 있어 다시 올립니다({n + 1}/{ERROR_REQUEUE_MAX}): "
              f"{err[:80]}", flush=True)

        if _is_gpu_error(err) and time.time() - _started_at[0] >= RESTART_GRACE_SEC:
            st = state()
            now = time.time()
            hist = [x for x in (st.get("restarts") or []) if now - x < RESTART_WINDOW_SEC]
            if len(hist) >= RESTART_MAX:
                _last_error = (f"그래픽 쪽 오류로 {len(hist)}번 다시 켰는데도 되풀이됩니다 — "
                               f"사람이 봐야 합니다: {err[:100]}")
                print(f"[회복] {_last_error}", flush=True)
                continue
            set_state(restarts=hist + [now])
            print("[회복] 그래픽 쪽 오류입니다 — 스튜디오를 다시 켭니다"
                  "(같은 프로세스에서는 되살릴 수 없습니다)", flush=True)
            return True
        jobs.start_worker()
    return False


# ───────────────────────── 루프 ─────────────────────────
def _loop():
    global _last_error
    next_lease = 0.0
    next_code = time.time() + CODE_SYNC_EVERY_SEC
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
            _last_error = ""      # 여기까지 왔으면 지난 차례의 사고는 지나간 것이다
            # 서버가 안 되어도 이것은 해야 한다 — 오류로 멈춘 작업은 서버와 무관하다.
            # **_last_error 를 지운 뒤에** 부른다 — 여기서 적는 '사람이 봐야 한다' 를 지우면 안 된다.
            if _recover_errors():
                _restart_studio()
                return
            # 서버에 새 코드가 올라왔으면 받아서 반영한다 — 켤 때만 맞추면 며칠짜리 작업 중에
            # 고친 것이 그 PC 에만 영영 닿지 않는다
            if time.time() >= next_code and time.time() - _started_at[0] >= RESTART_GRACE_SEC:
                next_code = time.time() + CODE_SYNC_EVERY_SEC
                if _code_update_round():
                    _restart_studio()
                    return
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
    # 저장해 둔 설정을 되살린다 — 다시 켤 때마다 사람이 다시 정해 줄 일이 아니다
    try:
        st = state()
        if st.get("polite"):
            apply_polite(True)
        if st.get("batch"):
            jobs.pc_batch[0] = int(st["batch"])
    except Exception:
        pass
    _started_at[0] = time.time()
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="fleet")
    _thread.start()
    return True


def stop():
    _stop.set()


def alive():
    return bool(_thread and _thread.is_alive()) and not _stop.is_set()
