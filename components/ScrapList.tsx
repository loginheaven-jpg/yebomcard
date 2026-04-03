"use client";

import { useState, useEffect } from "react";
import { getScraps, removeScrap, formatScrapTime } from "@/lib/scrap";
import type { ScrapItem } from "@/lib/types";

interface ScrapListProps {
  onBack: () => void;
  onSelectScrap: (scrap: ScrapItem) => void;
  onScrapCountChange: (count: number) => void;
}

export default function ScrapList({
  onBack,
  onSelectScrap,
  onScrapCountChange,
}: ScrapListProps) {
  const [scraps, setScraps] = useState<ScrapItem[]>([]);

  useEffect(() => {
    setScraps(getScraps());
  }, []);

  const handleRemove = (id: string) => {
    removeScrap(id);
    const updated = getScraps();
    setScraps(updated);
    onScrapCountChange(updated.length);
  };

  const versionLabel = (v: string) =>
    v === "nkrv" ? "개역개정" : v === "rnksv" ? "새번역" : v;

  return (
    <div className="w-full max-w-[1200px] mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">
          스크랩 <span className="text-sm font-normal text-gray-400">{scraps.length}개</span>
        </h2>
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          닫기
        </button>
      </div>

      {/* Empty state */}
      {scraps.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="w-12 h-12 text-gray-300 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
            />
          </svg>
          <p className="text-sm text-gray-500 mb-1">저장된 말씀이 없습니다</p>
          <p className="text-xs text-gray-400">
            말씀을 복사하거나 카드를 만들면<br />자동으로 저장됩니다
          </p>
        </div>
      )}

      {/* Scrap list */}
      <div className="space-y-2">
        {scraps.map((scrap) => (
          <div
            key={scrap.id}
            className="bg-white rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors cursor-pointer"
            onClick={() => onSelectScrap(scrap)}
          >
            <div className="flex items-start justify-between">
              <p className="text-sm font-semibold text-gray-800">
                {scrap.reference}
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(scrap.id);
                }}
                className="p-1 text-gray-300 hover:text-gray-500 transition-colors shrink-0 ml-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">
              {scrap.preview}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {versionLabel(scrap.version)} · {formatScrapTime(scrap.savedAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
