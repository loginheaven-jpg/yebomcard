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


def cmd_status(a):
    st = server.fleet_status()
    if st is None:
        print("서버 연동 정보가 없습니다(studio.json)")
        return 1
    if a.json:
        print(json.dumps(st, ensure_ascii=False, indent=1))
        return 0
    t = st.get("total", {})
    print(f"PC {t.get('livePcs', 0)}/{t.get('pcs', 0)}대 살아 있음 · 돌고 있는 대수 {t.get('running', 0)}"
          f" · 시간당 {t.get('versesPerHour', 0):,}절")
    print(f"남은 절 {t.get('pending', 0):,} · 합격 누계 {t.get('ok', 0):,}"
          f" · 보류 {t.get('held', 0):,} · 업로드 {t.get('uploaded', 0):,}")
    print(f"책 배분 — 끝남 {t.get('booksDone', 0)} · 맡은 중 {t.get('booksTaken', 0)}")
    print()
    for p in st.get("pcs", []):
        mark = "■" if p.get("running") and not p.get("stale") else ("·" if not p.get("stale") else "×")
        print(f"{mark} {p.get('label','?')}  [{p['tokenId'][:8]}]  {_age(p.get('at',''))}"
              f"{'  — 응답 없음' if p.get('stale') else ''}")
        print(f"    {p.get('gpu','?')} · 보이스 {p.get('voice') or '—'}"
              f"({p.get('voiceKey') or '—'}) · 배치 {p.get('batch') or '—'}"
              f" · 시간당 {p.get('versesPerHour', 0):,}절")
        print(f"    지금: {p.get('note') or '(쉬는 중)'}")
        if p.get("jobTitle"):
            print(f"    작업: {p['jobTitle']} · 남은 절 {p.get('pending', 0):,}"
                  f" · 대기 작업 {p.get('queued', 0)}")
        if p.get("leases"):
            print(f"    맡은 책: {', '.join(p['leases'])}")
        if p.get("lastError"):
            print(f"    ! {p['lastError']}")
        for b in (p.get("books") or [])[:6]:
            pct = 100 * b["done"] / max(1, b["total"])
            print(f"      {b['book']} {b['done']}/{b['total']} ({pct:.0f}%)"
                  f" · 보류 {b['held']} · 업로드 {b['uploaded']}")
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
        print(f"  {c['createdAt'][5:16]} {c['op']:<14} → {c['target'][:8]:<8} {c['status']:<9}"
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

    s = sub.add_parser("batch", help="지금 도는 작업의 배치 바꾸기")
    s.add_argument("n", type=int)
    s.add_argument("--pc", default="")
    s.set_defaults(fn=lambda a: _send("set_batch", _resolve(a.pc), {"batch": a.n}))

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
