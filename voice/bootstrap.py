# bootstrap.py — 음원 생성 PC 설치·갱신·실행. 배치파일이 이걸 받아 실행한다.
#
# 이 파일 하나가 설치의 전부다. 사람이 하는 일은 배치파일 더블클릭뿐이고,
# 여기서 순서대로:
#
#   1. GPU 확인 (없으면 여기서 멈춘다 — 이후 단계가 의미 없다)
#   2. 파이썬 패키지 설치 (torch cu126 / qwen-tts / faster-whisper / gradio / ffmpeg)
#   3. 서버에서 스튜디오 소스 내려받기
#   4. 서버에서 보이스(참조음) 내려받기
#   5. 로컬 스튜디오 실행 → 브라우저 열기
#
# 다시 실행하면 이미 된 단계는 건너뛴다. 그래서 **설치 스크립트가 곧 갱신 스크립트**다.
# 이 파일도 스튜디오 소스와 함께 켤 때마다 서버에서 새로 받는다(/api/voice-studio/code) —
# 그래야 여기를 고친 내용이 이미 설치된 PC 에도 닿는다.
#
# 환경변수(배치파일이 넘겨준다): YEBOM_BASE, YEBOM_TOKEN, YEBOM_HOME

import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = (os.environ.get("YEBOM_BASE") or "").rstrip("/")
TOKEN = os.environ.get("YEBOM_TOKEN") or ""
HOME = Path(os.environ.get("YEBOM_HOME") or (Path.home() / "YebomVoice"))

TORCH_INDEX = "https://download.pytorch.org/whl/cu126"

# (pip 이름, import 이름) — 이미 있으면 건너뛰려고 둘 다 필요하다.
# imageio-ffmpeg 는 ffmpeg 실행파일을 같이 가져온다(별도 설치 불필요).
PKGS = [
    ("qwen-tts", "qwen_tts"),
    ("faster-whisper", "faster_whisper"),
    ("gradio", "gradio"),
    ("soundfile", "soundfile"),
    ("numpy", "numpy"),
    ("requests", "requests"),
    ("imageio-ffmpeg", "imageio_ffmpeg"),
]

STEP = 0


def step(msg):
    global STEP
    STEP += 1
    print(f"\n[{STEP}] {msg}", flush=True)


def die(msg, hint=""):
    print(f"\n  [중단] {msg}", flush=True)
    if hint:
        print(f"  {hint}", flush=True)
    sys.exit(1)


def api(path, timeout=120):
    """서버 API 를 GET 해서 JSON 으로 돌려준다."""
    req = urllib.request.Request(
        f"{BASE}{path}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            pass
        if e.code == 401:
            die(
                f"서버가 이 PC 를 인정하지 않습니다. {detail}",
                "예봄성경 설정 화면에서 설치 파일을 새로 받아 주세요.",
            )
        die(f"서버 오류 {e.code} — {detail or path}")
    except Exception as e:
        die(f"서버에 연결하지 못했습니다: {e}", "인터넷 연결을 확인해 주세요.")


def pip(*args):
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", *args]
    return subprocess.call(cmd) == 0


def _console_title(title):
    """창 제목. 배치 파일에는 한글을 쓰지 않으므로(아래 '실행 파일' 참고) 제목은 여기서 단다."""
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW(title)
    except Exception:
        pass


# ── 1. GPU 확인 ──────────────────────────────────────────────
def check_gpu():
    step("그래픽카드 확인")
    smi = shutil.which("nvidia-smi")
    if not smi:
        die(
            "NVIDIA 그래픽카드를 찾지 못했습니다.",
            "이 프로그램은 NVIDIA GPU(RTX 3060 12GB 이상 권장)가 있어야 동작합니다.\n"
            "  그래픽카드가 있는데도 이 메시지가 나오면 NVIDIA 드라이버를 설치·업데이트해 주세요:\n"
            "  https://www.nvidia.co.kr/Download/index.aspx",
        )
    try:
        out = subprocess.check_output(
            [smi, "--query-gpu=name,memory.total", "--format=csv,noheader"],
            text=True, encoding="utf-8", errors="replace", timeout=30,
        ).strip()
    except Exception as e:
        die(f"nvidia-smi 실행 실패: {e}", "NVIDIA 드라이버를 업데이트해 주세요.")

    print(f"  발견: {out}", flush=True)
    first = out.splitlines()[0]
    mb = 0
    for tok in first.replace(",", " ").split():
        if tok.isdigit():
            mb = max(mb, int(tok))
    if mb and mb < 11000:
        print(
            f"  [주의] VRAM 이 {mb}MB 입니다. 12GB 미만이면 긴 절에서 메모리 부족이 날 수 있습니다.",
            flush=True,
        )


# ── 2. 패키지 설치 ───────────────────────────────────────────
def have(mod):
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def install_packages():
    step("파이썬 패키지 설치 (처음이면 6GB 가량 내려받습니다 — 10~40분)")
    if have("torch"):
        import torch
        if torch.cuda.is_available():
            print(f"  torch {torch.__version__} · CUDA 사용 가능 — 건너뜀", flush=True)
        else:
            print("  torch 는 있으나 CUDA 를 못 씁니다. CUDA 판으로 다시 설치합니다.", flush=True)
            if not pip("--force-reinstall", "--index-url", TORCH_INDEX, "torch", "torchaudio"):
                die("torch(CUDA) 설치 실패")
    else:
        print("  torch(CUDA 12.6) 설치 중... 가장 오래 걸리는 단계입니다.", flush=True)
        if not pip("--index-url", TORCH_INDEX, "torch", "torchaudio"):
            die("torch 설치 실패", "인터넷 연결을 확인하고 다시 실행해 주세요.")

    missing = [pkg for pkg, mod in PKGS if not have(mod)]
    if missing:
        print(f"  설치: {', '.join(missing)}", flush=True)
        if not pip(*missing):
            die("패키지 설치 실패")
    else:
        print("  나머지 패키지는 이미 설치되어 있습니다.", flush=True)


# ── 3. 스튜디오 소스 ─────────────────────────────────────────
def sync_code():
    step("스튜디오 소스 내려받기")
    data = api("/api/voice-studio/code")
    files, hashes = data.get("files", {}), data.get("hashes", {})
    HOME.mkdir(parents=True, exist_ok=True)

    state_path = HOME / ".code_hashes.json"
    old = {}
    if state_path.exists():
        try:
            old = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            old = {}

    changed = 0
    for name, body in files.items():
        p = HOME / name
        if p.exists() and old.get(name) == hashes.get(name):
            continue
        p.write_text(body, encoding="utf-8", newline="\n")
        changed += 1
    state_path.write_text(json.dumps(hashes, ensure_ascii=False), encoding="utf-8")

    # 로컬이 서버 설정을 읽을 수 있게 접속 정보를 남긴다(비밀키 아님 — 기기 토큰)
    (HOME / "studio.json").write_text(
        json.dumps({"base": BASE, "token": TOKEN}, ensure_ascii=False), encoding="utf-8"
    )
    print(f"  파일 {len(files)}개 · 갱신 {changed}개", flush=True)
    if data.get("missing"):
        print(f"  (서버에 없는 파일: {', '.join(data['missing'])})", flush=True)


# ── 4. 보이스 ────────────────────────────────────────────────
def sync_voices():
    step("보이스(참조음) 내려받기")
    data = api("/api/voice-studio/voices")
    voices = data.get("voices", [])
    if not voices:
        print("  서버에 등록된 보이스가 없습니다. 스튜디오에서 직접 등록해 사용하세요.", flush=True)
        return

    vdir = HOME / "voices"
    vdir.mkdir(parents=True, exist_ok=True)
    for v in voices:
        name = v["name"]
        d = vdir / name
        meta_p = d / "meta.json"
        # 지문이 같으면 이미 같은 참조음이다 — 다시 받지 않는다
        if meta_p.exists():
            try:
                if json.loads(meta_p.read_text(encoding="utf-8")).get("fingerprint") == v.get("fingerprint"):
                    print(f"  {name} — 이미 최신 (지문 {v.get('fingerprint')})", flush=True)
                    continue
            except Exception:
                pass
        full = api(f"/api/voice-studio/voices/{urllib.parse.quote(name)}")
        d.mkdir(parents=True, exist_ok=True)
        (d / "ref.wav").write_bytes(base64.b64decode(full["refWavBase64"]))
        meta_p.write_text(json.dumps(full["meta"], ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  {name} — 받음 (지문 {v.get('fingerprint')})", flush=True)


# ── 실행 파일(배치) ──────────────────────────────────────────
# 설치 폴더의 실행.bat 과 바탕화면의 '예봄성경 음원생성.bat' 은 같은 내용이다. 규칙 두 가지:
#
#   1. 줄 끝은 CRLF. 예전에는 바탕화면에 글자로 옮겨 적으면서 LF 로 바뀌었고, 그러면 cmd 가
#      한글 줄(창 제목)을 잘못 끊어 조각을 명령으로 실행했다 — "'?깃꼍'은(는) 내부 또는 외부
#      명령…", 그리고 주소 조각(//bible.yebom.org)을 네트워크 경로로 열려다 "액세스가
#      거부되었습니다" 와 'Windows 보안 — 파일을 복사할 수 없음' 창.
#   2. 영문·숫자만. 경로는 %LOCALAPPDATA% 처럼 적어 사용자 이름이 한글이어도 한글이 남지
#      않게 하고, 창 제목 같은 한글은 파이썬이 단다.
#
# 짧게 둔다(주석을 넣지 않는다). 옛 실행 파일이 도는 중에 이 내용으로 바꿔 쓰면, cmd 는
# 파이썬이 끝난 뒤 옛 파일에서 기억해 둔 자리부터 새 파일을 이어 읽는다 — 새 파일이 그
# 자리보다 짧으면 읽을 것이 없어 그냥 끝난다(repair_launchers 가 길이를 확인한다).
LAUNCHER_NAME = "실행.bat"
DESKTOP_NAME = "예봄성경 음원생성.bat"


def _bat_path(p):
    """배치에 적을 경로. 사용자 폴더 부분은 %LOCALAPPDATA% 등으로 바꿔 한글 사용자 이름이 남지 않게 한다."""
    s = str(p)
    for var in ("LOCALAPPDATA", "APPDATA", "USERPROFILE"):
        v = (os.environ.get(var) or "").rstrip("\\")
        if v and (s.lower() == v.lower() or s.lower().startswith(v.lower() + "\\")):
            return f"%{var}%" + s[len(v):]
    return s


def launcher_bytes(base=None, token=None):
    """실행 파일 내용(바이트). 규칙은 위 '실행 파일' 참고."""
    body = "\r\n".join([
        "title Yebom Voice Studio",
        f'set "YEBOM_BASE={base or BASE}"',
        f'set "YEBOM_TOKEN={token or TOKEN}"',
        f'set "YEBOM_HOME={_bat_path(HOME)}"',
        'cd /d "%YEBOM_HOME%"',
        f'"{_bat_path(sys.executable)}" "%YEBOM_HOME%\\bootstrap.py" --run',
        "if errorlevel 1 pause",
    ]) + "\r\n"
    if body.isascii():
        return ("@echo off\r\n" + body).encode("ascii")
    # 경로에 한글이 남는 드문 경우(설치 폴더를 바꿨거나 파이썬이 사용자 폴더 밖 한글 경로에 있을 때):
    # 한국어 코드페이지로 쓰고 cmd 도 그것으로 읽게 한다. 그마저 안 되면 예전 방식(UTF-8).
    try:
        return ("@echo off\r\nchcp 949 > nul\r\n" + body).encode("cp949")
    except UnicodeEncodeError:
        return ("@echo off\r\nchcp 65001 > nul\r\n" + body).encode("utf-8")


def repair_launchers():
    """예전 설치가 남긴 실행 파일을 지금 규칙으로 바꿔 쓴다. 바꾼 파일 목록을 돌려준다.

    이미 설치된 PC 는 설치를 다시 하지 않으므로 켤 때마다(--run, 그리고 app.py 시작 시) 여기서 고친다.
    바탕화면 파일은 우리가 만든 것(bootstrap.py --run 을 부르는 것)일 때만 건드린다.
    지금 돌고 있는 파일일 수 있으므로, 새 내용이 '옛 파일에서 --run 줄이 끝나는 자리'보다 길면
    이번에는 건너뛴다. 실패는 조용히 넘어간다 — 스튜디오 실행을 막을 일은 아니다."""
    base, token = BASE, TOKEN
    if not (base and token):
        try:
            conf = json.loads((HOME / "studio.json").read_text(encoding="utf-8"))
            base, token = conf.get("base") or "", conf.get("token") or ""
        except Exception:
            return []
    if not (base and token):
        return []
    new = launcher_bytes(base, token)
    targets = [HOME / LAUNCHER_NAME]
    d = desktop_dir()
    if d:
        targets.append(d / DESKTOP_NAME)
    fixed = []
    for p in targets:
        try:
            if not p.is_file():
                continue
            old = p.read_bytes()
            if old == new or b"bootstrap.py" not in old or b"--run" not in old:
                continue
            end = old.find(b"\n", old.find(b"--run"))
            if len(new) > (len(old) if end < 0 else end + 1):
                continue
            p.write_bytes(new)
            fixed.append(p)
        except Exception:
            pass
    return fixed


# ── 5. 실행 ──────────────────────────────────────────────────
def register_protocol():
    """yebomtts:// 를 등록해 예봄성경 웹에서 '로컬 실행' 버튼이 동작하게 한다.

    실패해도 설치는 성공이다 — 바탕화면 바로가기로도 실행할 수 있다."""
    try:
        import winreg
        # studio.json 이 없어져도 실행되도록 접속 정보를 실행 파일에도 박아 둔다
        launcher = HOME / LAUNCHER_NAME
        launcher.write_bytes(launcher_bytes())
        root = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\yebomtts")
        winreg.SetValueEx(root, "", 0, winreg.REG_SZ, "URL:Yebom Voice Studio")
        winreg.SetValueEx(root, "URL Protocol", 0, winreg.REG_SZ, "")
        cmd = winreg.CreateKey(root, r"shell\open\command")
        winreg.SetValueEx(cmd, "", 0, winreg.REG_SZ, f'"{launcher}" "%1"')
        return True
    except Exception as e:
        print(f"  (웹에서 바로 실행 등록은 건너뜁니다: {e})", flush=True)
        return False


def desktop_dir():
    """바탕화면 경로. OneDrive 로 옮겨진 경우가 흔해서 레지스트리를 먼저 본다."""
    try:
        import winreg
        k = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders")
        v, _ = winreg.QueryValueEx(k, "Desktop")
        d = Path(os.path.expandvars(v))
        if d.is_dir():
            return d
    except Exception:
        pass
    for c in (Path.home() / "Desktop", Path.home() / "OneDrive" / "Desktop"):
        if c.is_dir():
            return c
    return None


def make_desktop_shortcut():
    """바탕화면에 실행 파일을 둔다.

    설치 폴더가 %LOCALAPPDATA% 안이라 사람이 찾아가기 어렵다 — 바탕화면에
    없으면 다음에 어떻게 켜는지 알 수가 없다."""
    src = HOME / LAUNCHER_NAME
    if not src.exists():
        return None
    d = desktop_dir()
    if not d:
        return None
    try:
        dst = d / DESKTOP_NAME
        # 바이트 그대로 옮긴다 — 글자로 읽어 옮기면 줄 끝이 LF 로 바뀌어 cmd 가 배치를 잘못 읽는다
        dst.write_bytes(src.read_bytes())
        return dst
    except Exception as e:
        print(f"  (바탕화면 바로가기 실패: {e})", flush=True)
        return None


def run_studio():
    step("로컬 스튜디오 실행")
    os.chdir(HOME)
    sys.path.insert(0, str(HOME))
    app_py = HOME / "app.py"
    if not app_py.exists():
        die("app.py 가 없습니다 — 설치를 다시 실행해 주세요.")
    # 브라우저는 스튜디오가 준비되면 스튜디오가 연다(app.py 의 inbrowser). 여기서 먼저 열면
    # 서버가 뜨기 전이라 '연결할 수 없음' 탭이 하나 더 생겼다.
    print("  준비되면 브라우저가 열립니다: http://127.0.0.1:7860", flush=True)
    print("  (이 창을 닫으면 스튜디오도 종료됩니다)", flush=True)
    subprocess.call([sys.executable, str(app_py)])


def main():
    if not BASE or not TOKEN:
        die("설치 정보가 없습니다.", "예봄성경 설정 화면에서 설치 파일을 다시 받아 주세요.")

    # --run: 이미 설치된 PC 에서 바로 실행 (바로가기·yebomtts:// 가 쓰는 경로)
    if "--run" in sys.argv:
        _console_title("예봄성경 음원 생성")
        # 실행할 때마다 소스를 서버와 맞춘다. 이게 없으면 고친 내용이 새 PC 에
        # 영원히 전달되지 않는다(설치 파일을 다시 받아야만 갱신됐다).
        # 서버가 잠깐 안 되더라도 실행은 되어야 하므로 실패는 넘어간다.
        try:
            sync_code()
            sync_voices()
        except SystemExit:
            print("  (서버에 연결하지 못해 갱신을 건너뜁니다 — 기존 코드로 실행합니다)",
                  flush=True)
        except Exception as e:
            print(f"  (갱신 건너뜀: {e})", flush=True)
        for p in repair_launchers():
            print(f"  실행 파일을 새 방식으로 고쳤습니다: {p.name}", flush=True)
        run_studio()
        return

    _console_title("예봄성경 음원 생성 PC 설치")
    print("=" * 56, flush=True)
    print("  예봄성경 음원 생성 PC 설치", flush=True)
    print(f"  설치 위치: {HOME}", flush=True)
    print("=" * 56, flush=True)

    check_gpu()
    install_packages()
    sync_code()
    sync_voices()
    register_protocol()

    print("\n" + "=" * 56, flush=True)
    print("  설치 완료", flush=True)
    print("", flush=True)
    shortcut = make_desktop_shortcut()
    if shortcut:
        print("  다음부터는 바탕화면의", flush=True)
        print(f"     [ {shortcut.name} ]", flush=True)
        print("  를 더블클릭하면 바로 열립니다.", flush=True)
    else:
        print("  다음부터 실행할 파일:", flush=True)
        print(f"     {HOME / LAUNCHER_NAME}", flush=True)
    print("", flush=True)
    print(f"  설치 폴더: {HOME}", flush=True)
    print("=" * 56, flush=True)
    run_studio()


if __name__ == "__main__":
    main()
