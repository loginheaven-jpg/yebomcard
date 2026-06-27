// PWA 설치 상태 싱글톤 — beforeinstallprompt 이벤트를 전역 보관해
// 플로팅 버튼(PwaInstall)과 설정 메뉴(앱으로 설치) 양쪽에서 설치를 트리거.

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BIPEvent | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** beforeinstallprompt 이벤트 보관 (PwaInstall 의 핸들러에서 호출) */
export function captureInstallPrompt(e: Event) {
  deferred = e as BIPEvent;
  notify();
}
export function clearInstallPrompt() {
  deferred = null;
  notify();
}
/** 네이티브 설치창을 띄울 수 있는 상태인지(이벤트 보관됨) */
export function canInstall() {
  return deferred !== null;
}
/** 상태 변화 구독 (버튼 표시/숨김 동기화용) */
export function subscribeInstall(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !("MSStream" in window);
}
export function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** 네이티브 설치창 띄우기. 이벤트 없으면 'unavailable'(설정에서 수동 안내). */
export async function triggerInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  try {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null; // prompt 는 1회용
    notify();
    return outcome;
  } catch {
    deferred = null;
    notify();
    return "unavailable";
  }
}
