# 하단 6탭 IA + 통합 SettingsSheet 정책

> Phase 2a~3 리디자인으로 도입된 정보 구조(IA). 2026-09-09 '말씀의삶' 탭 추가로 6탭.
> 2026-09-12 네 번째 탭이 '말씀의삶' → '찬송가' 로 바뀌었다(말씀의삶은 본문 상단 ⋮ 메뉴로).
> (파일명은 이력 보존을 위해 IA_5TAB.md 를 유지한다)

---

## 1. 하단 6탭 (BottomTabBar)

`view === "search" || view === "plan"` 일 때 렌더 (display/card 뷰에서는 숨김).

| 탭 | 동작 |
|---|---|
| **목차** (toc) | `navRequest.target="toc"` — SearchPanel 의 책·장 선택 모드 |
| **검색** (search) | `navRequest.target="search"` — 단어·주제 검색 모드 |
| **본문** (read) | `navRequest.target="read"` — 본문 chapter 직진입 |
| **찬송가** (hymn) | `setShowHymn(true)` — 창을 띄운다(view 변경 없음). 2026-09-12 이 자리의 '말씀의삶' 을 대신했다 |
| **책갈피** (bookmark) | `navRequest.target="bookmark"` — 책갈피 메뉴 노출 (+ 스크랩 진입) |
| **설정** (settings) | `SettingsSheet` 띄움 (view 변경 안 함) |

### 말씀의삶(plan 뷰)에서 주의할 것 세 가지

**하나 — 진입로가 탭이 아니라 본문 상단 ⋮ 메뉴다(2026-09-12).**
`SearchPanel` 의 ⋮ 메뉴가 `onOpenPlan` 을 부르고, page 가 `setView("plan")` 한다. plan 은 이제
`ActiveTab` 에 없다 — 탭에서 다루려 하면 `setView("search")` 가 먼저 걸려 검색 뷰만 뜬다(옛 함정).
회차를 읽는 중에는 `PlanHeader` 의 '진도표로' 로도 돌아온다.

**둘 — 탭바 자동 숨김을 반드시 제외한다.**
판정식은 `autoHideTabBar && isReadingView && view === "search"`(`shouldAutoHideTabBar`).
SearchPanel 은 `display:none` 으로만 가려져 언마운트되지 않으므로 `isReadingView` 가
plan 뷰에서도 true 로 남는다. 이 식은 **세 곳**(revealTabBar · 재평가 effect ·
스크롤 리스너)에서 쓰이므로 파생값 하나로 묶었다 — 한 곳만 고치면 타이머는 멈추는데
스크롤 리스너가 남거나 그 반대가 된다.

**셋 — `useHardwareBack(view === "plan", …)` 는 키보드 격리도 겸한다.**
SearchPanel 의 ←/→/Space 장 이동 리스너가 plan 뷰에서도 살아 있는데,
이 훅 등록으로 `modalStack` 이 2 가 되어 SearchPanel 쪽 가드
(`getActiveModalCount() > 1`)에 걸린다. 빼먹으면 PC 에서 진도표를 보며 방향키를
누를 때 보이지 않는 본문의 장이 바뀐다.

`ReadingPlanPanel` 만 **조건부 마운트**다(다른 뷰는 display:none 유지).
`display:none` 요소는 `offsetTop` 이 0 이라 "지금 회차를 화면 상단 1/3 에" 스크롤이
동작하지 않는다. 진입할 때마다 마운트되므로 진도도 매번 최신으로 다시 읽는다.

### 라우팅 메커니즘

`page.tsx` 의 `handleTabChange`:
- tab="settings" → `setShowSettingsSheet(true)`, 그 외엔 `setView("search")` + `navRequest` 갱신
- `SearchPanel` 이 `navRequest.nonce` 변화 감지 시 해당 모드로 전환

### 책갈피 뱃지

`SettingsSheet` 외부에서 추가/삭제되므로 5초 폴링으로 동기화:
```ts
useEffect(() => {
  const refresh = () => setBookmarkCount(readBookmarks().length);
  refresh();
  const id = setInterval(refresh, 5000);
  return () => clearInterval(id);
}, []);
```

## 2. SettingsSheet — 통합 설정 시트

bottom sheet 패턴. 그립 드래그로 닫기 + 우상단 X 버튼.

### 섹션 (위→아래)

1. **계정** — 로그인/로그아웃, 사용자 정보, 관리자 모드 토글
2. **찬송가** — HymnModal 열기
3. **예배성경** — WorshipBible 패널 열기
4. **카드 빌더** — CardBuilder 열기 (절 선택된 상태에서만 활성)
5. **풀스크린** — 현재 본문을 FullscreenReader 로 전환
6. **글꼴** — 미리보기 카드 + 압축 바 (Kindle 패턴)
   - 일반 모드: 시 23:1 샘플로 즉시 미리보기
   - 압축 모드: 본문 보이는 채로 사이즈/폰트 조정
7. **음성 (TTS)** — 재생속도 7단계 / 합성음성 segmented / 영문음성 segmented / 자동 다음 장 / 절 번호 읽기
8. **테마** — light / dark / system
9. **종료** — 앱 종료 (PWA 환경)

### 그립 드래그 ↔ X 버튼 충돌 주의

그립 영역에 `setPointerCapture` 적용되어 그 안 자식 버튼 클릭 가로채짐.

**해결**: X 버튼에 `onPointerDown={(e) => e.stopPropagation()}` 부여.

이 패턴은 다른 그립 드래그 시트 신설 시 반복 필요.

## 3. QuickNavFab — 우상단 빠른 네비

본문 화면 우상단 고정. 책·장 빠른 점프.

### 위치 토글

- TR (기본): 우상단 코너 `top: 12px, right: 12px`
- BR: 우하단 (헤더와 충돌 시 사용) `bottom: 80px, right: 12px`
- localStorage `yebom_quicknav_pos` 영속

### 인터랙션

- 탭: 패널 열기/닫기
- 더블탭: 위치 토글 (TR ↔ BR)
- 길게누르기 (500ms): 전체화면 진입

## 4. 모달 스택 + 하드웨어 백

`hooks/useHardwareBack.ts` 에 글로벌 `modalStack` + popstate listener.

### 동작 흐름

```
모달 열기:
  useHardwareBack(isActive=true, onBack) effect 실행
  → modalStack.push({id, onBack})
  → history.pushState({...currentState, modalId})

브라우저 back 또는 UI 닫기:
  popstate fires → 가장 최근 modalStack.top.onBack() 호출
  또는 UI 닫기 → cleanup → history.back() + skipPopstateCount++

modalStack 비었을 때 popstate:
  page.tsx 의 handlePop 가 isAppRoot 체크 → 종료 팝업
```

### 적용 위치

- showScrap (스크랩 리스트)
- showHymn (찬송가)
- showWorship (예배성경)
- showCardBuilder (카드 빌더)
- showFontSettings (글꼴 설정)
- view === "card" / "display"
- isAddingMore (절 추가 모드)
- showFullscreen (풀스크린 리더)

### 신규 모달 추가 시 체크

```tsx
useHardwareBack(show모달, () => set모달(false));
```

이 한 줄만 page.tsx 또는 부모 컴포넌트에 두면 됨.

## 5. 좌우 스와이프 — 장 이동

본문 영역에서 좌→우 스와이프: 이전 장. 우→좌: 다음 장.

### 인식 기준

- 시작: 화면 좌 20% / 우 80% 사이 (가장자리는 OS gesture 회피)
- 50px 이상 이동 + 수평/수직 각도 30도 이내 → 장 이동 트리거
- 길게 누름(500ms) 우선 → 전체화면 진입 (Q1=B)

isAddingMore 모드일 땐 스와이프 비활성.

## 6. 시스템 다크 추종

`contexts/FontContext.tsx` 의 `theme: "light" | "dark" | "system"`:
- "system" 일 때 `matchMedia("(prefers-color-scheme: dark)")` 추종
- 변경 시 즉시 반영 (이벤트 리스너)
- 사용자가 light/dark 명시 시 시스템 무관 고정

Tailwind: `dark:` variant + Next.js theme attribute.

## 7. 제거된 UI (참고)

리디자인 과정에서 흡수·제거된 항목:
- 좌하단 스크랩 FAB → 책갈피 탭 안 "스크랩" 버튼으로 흡수
- 우하단 도구함 FAB → SettingsSheet 로 흡수
- 우상단 GlobalFontSettings 아이콘 → SettingsSheet 글꼴 섹션
- 상단 4탭 (성경목차/본문검색/주제추천/책갈피) → 하단 5탭 + 검색 세그먼트로 흡수
- "전체화면" 버튼 → 그립 길게 누름 또는 SettingsSheet 진입

## 8. 보류 (plan.md)

- VersionCheck 자동 reload 정책 (영구 배너 모드 권장)
- 시편 표제 절 매칭 보정
- 영문 TTS 가중치 변경 시 사용자 안내
