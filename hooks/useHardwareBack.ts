import { useEffect, useRef } from "react";

/**
 * 하드웨어(또는 브라우저) 뒤로가기 버튼을 제어하기 위한 훅입니다.
 * 
 * @param isActive 현재 UI 레이어(모달, 풀스크린, 서브 뷰 등)가 활성화되어 있는지 여부
 * @param onBack 뒤로가기 버튼이 눌렸을 때 실행할 콜백 (일반적으로 isActive를 false로 만드는 함수)
 */
export function useHardwareBack(isActive: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const isBackingOut = useRef(false);

  useEffect(() => {
    if (!isActive) return;

    // 현재 활성화된 레이어를 추적하기 위해 고유 ID를 부여하여 히스토리에 푸시
    const stateId = Math.random().toString(36).substring(2, 9);
    window.history.pushState({ modalId: stateId }, "");

    const handlePopState = (e: PopStateEvent) => {
      // 뒤로가기 이벤트가 발생하면 콜백을 실행하여 모달/뷰를 닫음
      isBackingOut.current = true;
      onBackRef.current();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      
      // 만약 뒤로가기 버튼이 아니라 UI상의 "X" 버튼 등을 눌러서 닫힌 경우(isActive가 false가 됨),
      // 브라우저 히스토리 스택에 남아있는 더미 상태를 수동으로 제거해야 합니다.
      if (!isBackingOut.current) {
        window.history.back();
      }
      isBackingOut.current = false;
    };
  }, [isActive]);
}
