"""fleet_cli.py — 생성 PC 무리를 한 줄 명령으로 보고 부린다.

어느 PC 에서든(스튜디오가 꺼져 있어도) 된다. 기기 토큰만 있으면 서버를 통해 모두에게 닿는다.

    python fleet_cli.py status                      전체 현황
    python fleet_cli.py status --json               기계가 읽을 형태
    python fleet_cli.py books                       책 배분 현황
    python fleet_cli.py log                         최근 지시와 결과

    python fleet_cli.py stop  [--pc 이름]           워커 멈춤   (--pc 없으면 모든 PC)
    python fleet_cli.py resume [--pc 이름]          워커 다시 켬
    python fleet_cli.py batch 8 [--pc 이름]         지금 도는 작업의 배치 바꾸기
    python fleet_cli.py queue 창세기,출애굽기 [--pc 이름] [--voice 이름]
    python fleet_cli.py replace 구약 [--pc 이름]    구방식 교체 작업 걸기
    python fleet_cli.py regen "창세기 1:1,창세기 1:2" [--pc 이름]
    python fleet_cli.py restart [--pc 이름]         스튜디오 다시 켜기 (코드 변경 반영)
    python fleet_cli.py polite on [--pc 이름]       사람이 함께 쓰는 PC — 생성이 양보하게

`--pc` 는 PC 이름의 일부만 써도 된다(앞부분 일치). 생략하면 모든 PC 에 간다.
지시는 각 PC 가 10초 안에 가져간다 — 바로 반영되지 않아도 정상이다. `log` 로 결과를 본다.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

import server  # noqa: E402


def _pcs():
    st = server.fleet_status()
    return (st or {}).get("pcs", []), (st or {}).get("total", {}), (st or {}).get("leases", [])


def _resolve(needle):
    """PC 이름 일부 → 토큰 id. 못 찾으면 알려주고 멈춘다."""
    if not needle:
        return "*"
    pcs, _t, _l = _pcs()
    hit = [p for p in pcs if needle.lower() in (p.get("label") or "").lower()
           or p["tokenId"].startswith(needle)]
    if len(hit) == 1:
        return hit[0]["tokenId"]
    if not hit:
        print(f"그런 PC 가 없습니다: {needle}")
        print("  있는 PC:", ", ".join(p.get("label", "?") for p in pcs) or "(없음)")
    else:
        print("여러 PC 가 걸립니다:", ", ".join(p.get("label", "?") for p in hit))
    sys.exit(1)


def _age(iso):
    import datetime as dt
    try:
        t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return "?"
    s = (dt.datetime.now(dt.timezone.utc) - t).total_seconds()
    if s < 90:
        return f"{s:.0f}초 전"
    if s < 5400:
        return f"{s/60:.0f}분 전"
    return f"{s/3600:.1f}시간 전"


def _gb(mb):
    return "?" if mb is None else f"{mb / 1024:.1f}"


def _sys_lines(s):
    """기계 상태 — 웹 화면(PcSys)과 같은 기준으로 경고한다."""
    if not s:
        return ["기계 상태: 아직 보고 없음(새 코드로 다시 켜지면 2분 안에)"]
    g = s.get("gpu") or {}
    st = s.get("studio") or {}
    used, total = g.get("memUsedMb"), g.get("memTotalMb")
    pct = round(100 * used / total) if used and total else None
    shared = st.get("sharedMb") or 0
    others = [x for x in s.get("gpuProcs") or [] if not x.get("self")]
    others_mb = sum(x["dedicatedMb"] + x["sharedMb"] for x in others)
    out = []
    if shared >= 512:
        out.append(f"! 그래픽 메모리 넘침 {_gb(shared)}GB — 시스템 메모리로 흘러가 기어갑니다")
    elif pct is not None and pct >= 97:
        out.append(f"! 그래픽 메모리 {pct}% — 거의 찼습니다")
    if any("과열" in x for x in g.get("limits") or []) or (g.get("tempC") or 0) >= 85:
        out.append(f"! 과열 {g.get('tempC')}℃")
    if others_mb >= 1536:
        out.append(f"! 다른 프로그램이 그래픽 메모리 {_gb(others_mb)}GB 사용")
    if (s.get("cpu") or 0) >= 85:
        out.append(f"! CPU {s['cpu']}% — 다른 일로 바쁩니다")
    line = f"그래픽 {_gb(used)}/{_gb(total)}GB" + (f" ({pct}%)" if pct is not None else "")
    for k, fmt in (("util", " · 사용률 {}%"), ("tempC", " · {}℃")):
        if g.get(k) is not None:
            line += fmt.format(g[k])
    if g.get("powerW") is not None:
        line += f" · {g['powerW']}/{g.get('powerLimitW', '?')}W"
    if g.get("clockMhz") is not None:
        line += f" · 클럭 {g['clockMhz']}/{g.get('clockMaxMhz', '?')}MHz"
    if g.get("limits"):
        line += " · 제한: " + ", ".join(g["limits"])
    out.append(line)
    out.append(f"스튜디오 그래픽 메모리 {_gb(st.get('dedicatedMb'))}GB · 넘침 {_gb(shared)}GB"
               + (" · 다른 프로그램: " + ", ".join(f"{x['name']} {_gb(x['dedicatedMb'] + x['sharedMb'])}GB"
                                                  for x in others[:3]) if others else ""))
    top = ", ".join(f"{'스튜디오' if x.get('self') else x['name']} {x['cores']:.1f}코어"
                    for x in s.get("topCpu") or [])
    out.append(f"CPU {s.get('cpu', '?')}%({s.get('cores', '?')}코어) · RAM {_gb(s.get('ramUsedMb'))}/"
               f"{_gb(s.get('ramTotalMb'))}GB" + (f" · CPU 많이 쓰는 것: {top}" if top else "")
               + f" · {_age(s.get('at', ''))} 측정")
    return out


def cmd_status(a):
    st = server.fleet_status()
    if st is None:
        print("서버 연동 정보가 없습니다(studio.json)")
        return 1
    if a.json:
        print(json.dumps(st, ensure_ascii=False, indent=1))
        return 0
    t = st.get("total", {})
    rate = t.get("versesPerHour", 0)
    print(f"PC {t.get('livePcs', 0)}/{t.get('pcs', 0)}대 살아 있음 · 돌고 있는 대수 {t.get('running', 0)}"
          f" · 시간당 {rate:,}절")
    # 남은 절은 서버 실측으로 — PC 마다의 '남은 절' 을 합치면 같은 책을 여러 PC 가 들고 있어 부푼다
    # (2026-09-16: 합계 20,969 · 실측 10,669).
    try:
        pg = server.progress()
    except Exception:
        pg = None
    if pg:
        left = pg["total"] - pg["done"]
        eta = f" · 이 속도면 약 {left / rate:.1f}시간" if rate and left else ""
        print(f"성경 전체 {pg['done']:,}/{pg['total']:,} · 남은 절 {left:,}"
              + (f" · 구방식 {pg['legacy']:,}" if pg.get("legacy") else "") + eta)
    else:
        print("성경 전체 진도를 받지 못했습니다")
    print(f"합격 누계 {t.get('ok', 0):,} · 보류 {t.get('held', 0):,} · 업로드 {t.get('uploaded', 0):,}")
    print(f"책 배분 — 끝남 {t.get('booksDone', 0)} · 맡은 중 {t.get('booksTaken', 0)}")
    codes = {p.get("codeVersion") for p in st.get("pcs", []) if not p.get("stale") and p.get("codeVersion")}
    if len(codes) > 1:
        print(f"! PC 마다 스튜디오 코드가 다릅니다({' / '.join(sorted(codes))}) —"
              " 검수 기준과 재시도 규칙이 코드에 있습니다. 옛 코드를 물고 있는 PC 는 다시 켜세요.")
    print()
    for p in st.get("pcs", []):
        mark = "■" if p.get("running") and not p.get("stale") else ("·" if not p.get("stale") else "×")
        print(f"{mark} {p.get('label','?')}  [{p['tokenId'][:8]}]  {_age(p.get('at',''))}"
              f"{'  — 응답 없음' if p.get('stale') else ''}")
        print(f"    {p.get('gpu','?')} · 보이스 {p.get('voice') or '—'}"
              f"({p.get('voiceKey') or '—'}) · 배치 {p.get('batch') or '—'}"
              f" · 시간당 {p.get('versesPerHour', 0):,}절 · 코드 {p.get('codeVersion') or '?'}"
              + (" · 양보 모드" if p.get("polite") else ""))
        print(f"    지금: {p.get('note') or '(쉬는 중)'}")
        if p.get("jobTitle"):
            print(f"    작업: {p['jobTitle']} · 작업 파일의 남은 절 {p.get('pending', 0):,}"
                  f" · 대기 작업 {p.get('queued', 0)}")
        if p.get("leases"):
            print(f"    맡은 책: {', '.join(p['leases'])}")
        if p.get("lastError"):
            print(f"    ! {p['lastError']}")
        for line in _sys_lines(p.get("sys")):
            print(f"    {line}")
        # 앞에서 여섯 권만 찍으면 앞쪽은 대개 이미 끝난 책이라 **다 끝난 것처럼 보인다**
        # (2026-09-13 지휘부 지적). 지금 움직이는 책만 진행률로 쓰고 나머지는 이름만 적는다.
        bs = p.get("books") or []
        run = [b for b in bs if 0 < b["done"] < b["total"]]
        fin = [b for b in bs if b["done"] >= b["total"]]
        wait = [b for b in bs if b["done"] == 0 and b["total"]]
        for b in run:
            pct = 100 * b["done"] / max(1, b["total"])
            print(f"      {b['book']} {b['done']}/{b['total']} ({pct:.0f}%)"
                  + (f" · 보류 {b['held']}" if b["held"] else ""))
        if fin:
            print(f"      끝남 {len(fin)}권: " + " · ".join(b["book"] for b in fin))
        if wait:
            print(f"      대기 {len(wait)}권: " + " · ".join(b["book"] for b in wait))
        print()
    return 0


def cmd_books(a):
    r = server.lease_status()
    if r is None:
        print("서버 연동 정보가 없습니다")
        return 1
    ls = r.get("leases", [])
    if not ls:
        print("배분된 책이 없습니다 — 스튜디오에서 '전체 생성' 을 켜면 순서대로 맡습니다")
        return 0
    for l in sorted(ls, key=lambda x: (x.get("state") != "taken", x.get("book", ""))):
        flag = []
        if l.get("pinned"):
            flag.append("고정")
        if l.get("blocked"):
            flag.append("차단")
        if not l.get("live"):
            flag.append("임대 끊김")
        state = {"done": "끝남", "taken": "맡은 중"}.get(l.get("state"), l.get("state"))
        who = l.get("pcLabel") or (l.get("label") or "—")
        print(f"  {l['book']:<10} {state:<6} {who:<16} {' '.join(flag)}")
    return 0


def cmd_log(a):
    for c in server.fleet_command_list()[:a.n]:
        # 모든 PC 대상 지시는 몇 대가 받을지 서버가 모르므로 끝나도 pending 으로 남는다 —
        # 대신 몇 대가 집었고 몇 대가 마쳤는지 보여 준다.
        if c["target"] == "*":
            state = f"{len(c.get('doneBy') or [])}/{len(c.get('takenBy') or [])}대 완료"
        else:
            state = c["status"]
        print(f"  {c['createdAt'][5:16]} {c['op']:<14} → {c['target'][:8]:<8} {state:<12}"
              f" {c.get('result','')[:80]}")
    return 0


def _send(op, target, args=None):
    r = server.fleet_command(op, target=target, args=args or {})
    who = "모든 PC" if target == "*" else target[:8]
    print(f"{who} 에게 '{op}' 를 걸었습니다. 각 PC 가 10초 안에 가져갑니다.")
    print("결과 보기: python fleet_cli.py log")
    return 0 if r.get("ok") else 1


def main():
    ap = argparse.ArgumentParser(description="생성 PC 무리 통제")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("status", help="전체 현황")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser("books", help="책 배분 현황")
    s.set_defaults(fn=cmd_books)

    s = sub.add_parser("log", help="최근 지시와 결과")
    s.add_argument("-n", type=int, default=20)
    s.set_defaults(fn=cmd_log)

    for op, help_ in (("stop", "워커 멈춤"), ("resume", "워커 다시 켬")):
        s = sub.add_parser(op, help=help_)
        s.add_argument("--pc", default="")
        s.set_defaults(fn=lambda a, op=op: _send(op, _resolve(a.pc)))

    s = sub.add_parser("restart", help="스튜디오를 다시 켠다 (코드 변경을 반영)")
    s.add_argument("--pc", default="")
    s.add_argument("--worker-only", action="store_true",
                   help="프로세스는 그대로 두고 워커만 다시 시작(코드는 반영되지 않음)")
    s.set_defaults(fn=lambda a: _send("restart", _resolve(a.pc),
                                      {"worker_only": bool(a.worker_only)}))

    s = sub.add_parser("polite", help="사람이 함께 쓰는 PC — 생성이 앞자리를 차지하지 않게")
    s.add_argument("on", choices=["on", "off"])
    s.add_argument("--pc", default="")
    s.set_defaults(fn=lambda a: _send("polite", _resolve(a.pc), {"on": a.on == "on"}))

    s = sub.add_parser("batch", help="지금 도는 작업의 배치 바꾸기")
    s.add_argument("n", type=int)
    s.add_argument("--pc", default="")
    s.add_argument("--this-pc", action="store_true",
                   help="이 PC 가 앞으로 집는 작업에도 적용(대기 중인 책들까지)")
    s.set_defaults(fn=lambda a: _send("set_batch", _resolve(a.pc),
                                      {"batch": a.n, "pc_wide": bool(a.this_pc)}))

    s = sub.add_parser("queue", help="책을 큐에 올린다 (쉼표로 구분)")
    s.add_argument("books")
    s.add_argument("--pc", default="")
    s.add_argument("--voice", default=None)
    s.add_argument("--version", default=None)
    s.set_defaults(fn=lambda a: _send("queue_books", _resolve(a.pc), {
        "books": [b.strip() for b in a.books.split(",") if b.strip()],
        "voice": a.voice, "version": a.version}))

    s = sub.add_parser("replace", help="구방식 교체 작업 걸기")
    s.add_argument("which", choices=["구약", "신약"])
    s.add_argument("--pc", default="")
    s.add_argument("--voice", default=None)
    s.set_defaults(fn=lambda a: _send("queue_replace", _resolve(a.pc),
                                      {"which": a.which, "voice": a.voice}))

    s = sub.add_parser("regen", help="절을 다시 만든다 (쉼표로 구분)")
    s.add_argument("refs")
    s.add_argument("--pc", default="")
    s.set_defaults(fn=lambda a: _send("regen_refs", _resolve(a.pc),
                                      {"refs": [r.strip() for r in a.refs.split(",") if r.strip()]}))

    a = ap.parse_args()
    try:
        sys.exit(a.fn(a))
    except server.ServerError as e:
        print(f"서버 오류: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
