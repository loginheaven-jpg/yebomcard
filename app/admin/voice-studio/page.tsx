"use client";

/**
 * 음원 생성 PC 설치 — 관리자 전용.
 *
 * 브라우저는 방문자 PC 에 프로그램을 설치할 수 없다(샌드박스). 그래서 여기서는
 * **토큰이 박힌 설치 파일**을 내려주고, 사람은 그걸 더블클릭만 한다.
 *
 * 이 파일 자체가 자격증명이므로, 받는 순간부터 유출에 주의해야 한다는 점을
 * 화면에서 분명히 말해 준다.
 */

import { useState } from "react";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";

export default function VoiceStudioInstallPage() {
  const { session, loading } = useSession();
  const admin = isAdmin(session);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setError("");
    setDownloading(true);
    try {
      const res = await fetch("/api/voice-studio/install");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `요청 실패 (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "예봄성경-음원생성-설치.bat";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "설치 파일을 받지 못했습니다");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">확인 중…</div>;
  if (!admin)
    return <div className="p-6 text-sm text-red-600">관리자(운영자·수퍼어드민) 전용 페이지입니다.</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">음원 생성 PC 설치</h1>
      <p className="text-xs text-gray-400 mb-5">
        커스텀 보이스로 성경 음원을 만드는 PC 를 준비합니다. 만들어진 음원은 자동으로 예봄성경에 올라갑니다.
      </p>

      {/* 요건 — 이걸 못 넘기면 설치해도 소용없다 */}
      <section className="mb-5 border border-amber-300 dark:border-amber-800 rounded-xl p-4 bg-amber-50 dark:bg-amber-950/20">
        <h2 className="text-sm font-bold text-amber-900 dark:text-amber-300 mb-2">먼저 확인하세요</h2>
        <ul className="text-xs text-amber-900/90 dark:text-amber-200/90 space-y-1.5 list-disc pl-4">
          <li>
            <b>NVIDIA 그래픽카드가 반드시 필요합니다</b> (RTX 3060 12GB 이상 권장).
            없으면 설치 프로그램이 시작 단계에서 멈춥니다 — 그래픽카드 없이는 한 권 만드는 데 몇 주가 걸려 의미가 없습니다.
          </li>
          <li>디스크 여유 공간 <b>15GB</b> 이상</li>
          <li>
            첫 설치 때 <b>약 6GB</b> 를 내려받습니다 (10~40분). 이후 실행은 즉시 시작됩니다.
          </li>
          <li>Windows 10 이상</li>
        </ul>
        <p className="text-[11px] text-amber-800/80 dark:text-amber-300/70 mt-2">
          그래픽카드 확인: 작업 관리자(Ctrl+Shift+Esc) → 성능 탭 → GPU 항목에 &quot;NVIDIA&quot; 가 있으면 됩니다.
        </p>
      </section>

      <button
        onClick={download}
        disabled={downloading}
        className="w-full px-4 py-3 rounded-xl bg-[var(--amber)] text-white text-sm font-bold hover:brightness-95 disabled:opacity-50"
      >
        {downloading ? "준비 중…" : "설치 파일 받기"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <section className="mt-6">
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">설치 방법</h2>
        <ol className="text-xs text-gray-600 dark:text-gray-300 space-y-2 list-decimal pl-4">
          <li>위 버튼으로 받은 <b>예봄성경-음원생성-설치.bat</b> 를 음원을 만들 PC 로 옮깁니다.</li>
          <li>
            더블클릭합니다. Windows 가 &quot;PC 를 보호했습니다&quot; 경고를 띄우면{" "}
            <b>추가 정보 → 실행</b> 을 누릅니다.
            <span className="block text-[11px] text-gray-400 mt-0.5">
              인터넷에서 받은 파일이라 나오는 일반적인 경고입니다.
            </span>
          </li>
          <li>검은 창에서 설치가 진행됩니다. 파이썬·필요 프로그램·보이스를 모두 자동으로 준비합니다.</li>
          <li>끝나면 브라우저에 작업 화면이 열립니다. 보이스와 성경 범위를 고르고 생성을 시작하면 됩니다.</li>
          <li>
            다음부터는 설치된 폴더의 <b>실행.bat</b> 를 더블클릭하면 바로 열립니다.
          </li>
        </ol>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">여러 PC 로 나눠 만들 때</h2>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          각 PC 는 서로 다른 책을 맡으면 됩니다. 조율이나 순서 맞추기는 필요 없습니다 —
          음원이 <b>본문 내용으로 주소가 정해져</b> 같은 절을 두 번 만들어도 같은 자리에 덮일 뿐이고,
          서로 다른 책은 절대 겹치지 않습니다. 참조음도 서버에서 같은 파일을 받아가므로
          PC 가 달라도 목소리가 흔들리지 않습니다.
        </p>
      </section>

      <section className="mt-6 border border-red-200 dark:border-red-900 rounded-xl p-4 bg-red-50 dark:bg-red-950/20">
        <h2 className="text-sm font-bold text-red-800 dark:text-red-300 mb-1.5">설치 파일 취급 주의</h2>
        <p className="text-xs text-red-800/90 dark:text-red-200/90 leading-relaxed">
          이 파일에는 서버 접속 권한이 들어 있고, 설치된 PC 는 <b>등록된 보이스(목소리 복제 데이터)</b> 를
          내려받을 수 있습니다. 받아 간 쪽은 그 목소리로 무엇이든 말하게 만들 수 있으므로,
          믿을 수 있는 PC 에만 설치하고 파일을 다른 사람에게 전달하지 마십시오.
          필요할 때마다 이 화면에서 새로 받으면 됩니다.
        </p>
      </section>
    </div>
  );
}
