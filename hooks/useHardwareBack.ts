import { useEffect, useRef } from "react";

// 글로벌 스택: 여러 개의 useHardwareBack이 동시에 활성화될 때,
// 가장 마지막에(최상단에) 열린 뷰만 뒤로가기 이벤트를 처리하도록 합니다.
export const modalStack: { id: string; onBack: () => void }[] = [];
let skipPopstateCount = 0;

// 외부에서 modalStack 크기 조회 (app/page.tsx에서 종료 팝업 발화 가드용)
export function getActiveModalCount(): number {
  return modalStack.length;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", (e: PopStateEvent) => {
    if (skipPopstateCount > 0) {
      skipPopstateCount--;
      return;
    }
    
    // 가장 위에 있는(최근에 추가된) 핸들러만 실행
    if (modalStack.length > 0) {
      const topModal = modalStack[modalStack.length - 1];
      topModal.onBack();
    }
  });
}

/**
 * 하드웨어(또는 브라우저) 뒤로가기 버튼을 제어하기 위한 훅입니다.
 * 
 * @param isActive 현재 UI 레이어(모달, 풀스크린, 서브 뷰 등)가 활성화되어 있는지 여부
 * @param onBack 뒤로가기 버튼이 눌렸을 때 실행할 콜백
 */
export function useHardwareBack(isActive: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const isBackingOut = useRef(false);
  const stateIdRef = useRef<string>("");

  useEffect(() => {
    if (!isActive) return;

    // 고유 ID 생성 및 히스토리 푸시
    const stateId = Math.random().toString(36).substring(2, 9);
    stateIdRef.current = stateId;
    const currentState = window.history.state || {};
    const lenBefore = window.history.length;
    window.history.pushState({ ...currentState, modalId: stateId }, "", window.location.href);
    // Chrome 은 (a) trivial session history context(항목 1개) 또는 (b) 사용자 제스처 없이
    // useEffect 안에서 호출된 pushState 를 replaceState 로 강등/건너뛴다 → 새 항목이 실제로
    // 추가되지 않는다. 이때 닫으면서 history.back() 을 부르면 앱 밖(빈 탭/이전 사이트)으로 튕긴다.
    // 따라서 "실제로 length 가 늘었을 때"만 추가로 간주해 back() 한다 (lenBefore>1 가정 제거).
    // 강등으로 항목이 안 늘면 back() 을 건너뛴다 — 잔여 항목은 무해(다음 뒤로가기에서 정리).
    const addedHistoryEntry = window.history.length > lenBefore;

    // 스택에 등록할 핸들러
    const handler = () => {
      isBackingOut.current = true;
      onBackRef.current();
    };

    modalStack.push({ id: stateId, onBack: handler });

    return () => {
      // 컴포넌트 언마운트 또는 isActive false 시 스택에서 제거
      const index = modalStack.findIndex((m) => m.id === stateIdRef.current);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }

      // UI 버튼("X" 등)으로 닫힌 경우, 우리가 실제로 추가한 히스토리 항목만 되돌린다.
      // (항목이 추가되지 않은 trivial context 에선 back() 시 앱 밖으로 튕기므로 skip)
      if (!isBackingOut.current && addedHistoryEntry) {
        skipPopstateCount++;
        window.history.back();
      }
      isBackingOut.current = false;
    };
  }, [isActive]);
}
