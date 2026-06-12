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
    // Chrome "trivial session history context": 히스토리 항목이 하나뿐(length 1)인 탭에선
    // pushState 가 replaceState 로 처리되어 새 항목이 추가되지 않는다.
    // 그 경우 닫을 때 history.back() 을 부르면 앱 밖(이전 페이지/빈 탭)으로 튕긴다 → back() 금지.
    // 비-trivial(length>1) 컨텍스트에선 pushState 가 항상 항목을 추가하므로 back() 으로 되돌린다.
    // (length 는 forward 항목 제거로 줄 수 있어, 증가 여부와 length>1 을 함께 본다)
    const addedHistoryEntry = lenBefore > 1 || window.history.length > lenBefore;

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
