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
    window.history.pushState({ ...currentState, modalId: stateId }, "", window.location.href);

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
      
      // UI 버튼("X" 등)으로 닫힌 경우, 브라우저 히스토리에서 해당 상태를 빼주어야 함
      if (!isBackingOut.current) {
        skipPopstateCount++;
        window.history.back();
      }
      isBackingOut.current = false;
    };
  }, [isActive]);
}
