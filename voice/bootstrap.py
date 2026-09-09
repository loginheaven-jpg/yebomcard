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
import webbrowser
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


# ── 5. 실행 ──────────────────────────────────────────────────
def register_protocol():
    """yebomtts:// 를 등록해 예봄성경 웹에서 '로컬 실행' 버튼이 동작하게 한다.

    실패해도 설치는 성공이다 — 바탕화면 바로가기로도 실행할 수 있다."""
    try:
        import winreg
        launcher = HOME / "실행.bat"
        launcher.write_text(
            "@echo off\r\n"
            "chcp 65001 > nul\r\n"
            "title 예봄성경 음원 생성\r\n"
            # studio.json 이 없어져도 실행되도록 접속 정보를 런처에도 박아 둔다
            f'set "YEBOM_BASE={BASE}"\r\n'
            f'set "YEBOM_TOKEN={TOKEN}"\r\n'
            f'set "YEBOM_HOME={HOME}"\r\n'
            f'cd /d "{HOME}"\r\n'
            f'"{sys.executable}" "{HOME / "bootstrap.py"}" --run\r\n'
            "if errorlevel 1 pause\r\n",
            encoding="utf-8", newline="",
        )
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
    src = HOME / "실행.bat"
    if not src.exists():
        return None
    d = desktop_dir()
    if not d:
        return None
    try:
        dst = d / "예봄성경 음원생성.bat"
        dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8", newline="")
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
    print("  브라우저가 열립니다: http://127.0.0.1:7860", flush=True)
    print("  (이 창을 닫으면 스튜디오도 종료됩니다)", flush=True)
    webbrowser.open("http://127.0.0.1:7860")
    subprocess.call([sys.executable, str(app_py)])


def main():
    if not BASE or not TOKEN:
        die("설치 정보가 없습니다.", "예봄성경 설정 화면에서 설치 파일을 다시 받아 주세요.")

    # --run: 이미 설치된 PC 에서 바로 실행 (바로가기·yebomtts:// 가 쓰는 경로)
    if "--run" in sys.argv:
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
        run_studio()
        return

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
        print(f"     {HOME / '실행.bat'}", flush=True)
    print("", flush=True)
    print(f"  설치 폴더: {HOME}", flush=True)
    print("=" * 56, flush=True)
    run_studio()


if __name__ == "__main__":
    main()
