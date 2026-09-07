"use client";

/**
 * 하단 5탭 네비게이션 — 리디자인 Phase 2a
 *
 * 탭: 목차 / 검색 / 읽기 / 책갈피 / 설정
 *
 * Phase 2a 는 *전환기* — 기존 상단 탭(성경목차/본문검색/주제추천/책갈피)도 살아있고,
 * 사용자는 양쪽 어디서든 진입 가능. Phase 2b 에서 상단 탭 제거 + 시트 통합 완료.
 */

import type { ReactNode } from "react";

export type ActiveTab = "toc" | "search" | "read" | "bookmark" | "settings";

interface Tab {
  id: ActiveTab;
  label: string;
  icon: ReactNode;
}

const TABS: Tab[] = [
  {
    id: "toc",
    label: "목차",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "검색",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  {
    id: "read",
    label: "본문",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    id: "bookmark",
    label: "책갈피",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "설정",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface Props {
  active: ActiveTab | null;
  onTabChange: (tab: ActiveTab) => void;
  bookmarkCount?: number;
  /** 설정 탭에 빨간 점 — 운영자 미처리 신고 있을 때 */
  settingsDot?: boolean;
  /** 미니플레이어 활성 등 하단에 다른 UI 가 있으면 위로 올림 */
  liftPx?: number;
  /** 본문 몰입 - 아래로 내려 감춤(얇은 손잡이만 남김) */
  hidden?: boolean;
  /** 감춘 상태에서 하단 손잡이를 누르면 호출 */
  onReveal?: () => void;
  /** 탭바를 만지는 동안 자동 숨김 타이머 재무장 */
  onInteract?: () => void;
}

export default function BottomTabBar({
  active,
  onTabChange,
  bookmarkCount,
  settingsDot = false,
  liftPx = 0,
  hidden = false,
  onReveal,
  onInteract,
}: Props) {
  return (
    <>
    <nav
      role="tablist"
      aria-label="주 네비게이션"
      aria-hidden={hidden || undefined}
      onPointerDown={onInteract}
      className="fixed inset-x-0 z-30 bg-[var(--paper)] dark:bg-gray-900 border-t border-[var(--line)] dark:border-gray-700 transition-transform duration-200 ease-out"
      style={{
        bottom: liftPx,
        paddingBottom: "env(safe-area-inset-bottom, 0)",
        transform: hidden ? "translateY(100%)" : "translateY(0)",
        pointerEvents: hidden ? "none" : undefined,
      }}
    >
      <div className="grid grid-cols-5 max-w-2xl mx-auto">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              aria-label={t.label}
              data-bookmark-tab={t.id === "bookmark" ? "true" : undefined}
              onClick={() => onTabChange(t.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[54px] transition-colors ${
                isActive
                  ? "text-[var(--amber-deep)]"
                  : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]"
              }`}
            >
              <span className="w-[22px] h-[22px] flex items-center justify-center" aria-hidden>
                {t.icon}
              </span>
              <span
                className={`text-[10.5px] tracking-tight ${
                  isActive ? "font-bold" : "font-medium"
                }`}
              >
                {t.label}
              </span>
              {t.id === "bookmark" && bookmarkCount !== undefined && bookmarkCount > 0 && (
                <span
                  className="absolute top-1.5 right-[28%] min-w-[16px] h-[16px] bg-[var(--amber)] text-white text-[9px] rounded-full flex items-center justify-center px-1 font-semibold"
                  aria-hidden
                >
                  {bookmarkCount > 99 ? "99+" : bookmarkCount}
                </span>
              )}
              {t.id === "settings" && settingsDot && (
                <span
                  className="absolute top-2 right-[30%] w-[9px] h-[9px] bg-red-500 rounded-full ring-2 ring-[var(--paper)] dark:ring-gray-900"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
    {/* 감춤 상태의 리빌 존 + 얇은 손잡이.
        iOS 홈 인디케이터(safe-area) 바로 위에 두어 시스템 스와이프와 충돌하지 않게 함.
        스와이프가 아닌 탭(onPointerDown)으로만 반응. */}
    {hidden && (
      <button
        type="button"
        aria-label="메뉴 표시"
        onPointerDown={(e) => {
          e.preventDefault();
          onReveal?.();
        }}
        className="fixed inset-x-0 z-30 flex items-start justify-center bg-transparent border-0 p-0 cursor-pointer"
        style={{ bottom: "env(safe-area-inset-bottom, 0)", height: 28 }}
      >
        <span
          aria-hidden
          className="mt-1.5 block rounded-full bg-gray-400/60 dark:bg-gray-500/60"
          style={{ width: 36, height: 4 }}
        />
      </button>
    )}
    </>
  );
}
