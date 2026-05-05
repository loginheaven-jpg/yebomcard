"use client";

import { useState, useEffect } from "react";
import {
  fetchMyScraps,
  fetchCommunityScraps,
  removeScrapFromServer,
  formatScrapTime,
  type ServerScrap,
  type CommunityScrap,
} from "@/lib/scrap";
import { supabase } from "@/lib/supabase";
import type { BibleVerse } from "@/lib/types";
import { getVersionLabel } from "@/lib/versions";

interface ScrapListProps {
  onBack: () => void;
  onSelectScrap: (version: string, bookCode: string, chapter: number, verseStart: number, verseEnd: number) => void;
  onScrapCountChange: (count: number) => void;
}

type ScrapTab = "mine" | "community";

export default function ScrapList({
  onBack,
  onSelectScrap,
  onScrapCountChange,
}: ScrapListProps) {
  const [tab, setTab] = useState<ScrapTab>("mine");
  const [myScraps, setMyScraps] = useState<ServerScrap[]>([]);
  const [communityScraps, setCommunityScraps] = useState<CommunityScrap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMyScraps();
  }, []);

  async function loadMyScraps() {
    setLoading(true);
    const scraps = await fetchMyScraps();
    setMyScraps(scraps);
    onScrapCountChange(scraps.length);
    setLoading(false);
  }

  async function loadCommunity() {
    setLoading(true);
    const scraps = await fetchCommunityScraps();
    setCommunityScraps(scraps);
    setLoading(false);
  }

  function handleTabChange(t: ScrapTab) {
    setTab(t);
    if (t === "community" && communityScraps.length === 0) {
      loadCommunity();
    }
  }

  async function handleRemove(id: number) {
    await removeScrapFromServer(id);
    setMyScraps((prev) => prev.filter((s) => s.id !== id));
    onScrapCountChange(myScraps.length - 1);
  }

  const versionLabel = (v: string) => getVersionLabel(v as any);

  const tabClass = (t: ScrapTab) =>
    `flex-1 py-1.5 text-xs font-medium text-center rounded-lg transition-colors ${
      tab === t ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
    }`;

  return (
    <div className="w-full max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-900">
          스크랩{" "}
          {tab === "mine" && (
            <span className="text-sm font-normal text-gray-400">{myScraps.length}개</span>
          )}
        </h2>
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          닫기
        </button>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 mb-4 bg-gray-50 p-0.5 rounded-lg">
        <button onClick={() => handleTabChange("mine")} className={tabClass("mine")}>
          나의 스크랩
        </button>
        <button onClick={() => handleTabChange("community")} className={tabClass("community")}>
          다른 성도님의 스크랩
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center text-gray-400 text-sm">불러오는 중...</div>
      )}

      {/* 나의 스크랩 */}
      {!loading && tab === "mine" && (
        <>
          {myScraps.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              <p className="text-sm text-gray-500 mb-1">저장된 말씀이 없습니다</p>
              <p className="text-xs text-gray-400">
                말씀을 복사하거나 카드를 만들면<br />자동으로 저장됩니다
              </p>
            </div>
          )}

          <div className="space-y-2">
            {myScraps.map((scrap) => (
              <div
                key={scrap.id}
                className="bg-white rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() =>
                  onSelectScrap(scrap.version, scrap.book_code, scrap.chapter, scrap.verse_start, scrap.verse_end)
                }
              >
                <div className="flex items-start justify-between">
                  <p className="text-sm font-semibold text-gray-800">{scrap.reference}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(scrap.id); }}
                    className="p-1 text-gray-400 hover:text-gray-700 transition-colors shrink-0 ml-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {scrap.image_url ? (
                  <div className="mt-2 relative w-full h-32 rounded-lg overflow-hidden bg-gray-100">
                    <img src={scrap.image_url} alt="카드" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{scrap.preview}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  {versionLabel(scrap.version)} · {formatScrapTime(scrap.created_at)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 커뮤니티 스크랩 */}
      {!loading && tab === "community" && (
        <>
          {communityScraps.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-400">아직 다른 성도님의 스크랩이 없습니다</p>
            </div>
          )}

          <div className="space-y-2">
            {communityScraps.map((scrap, i) => (
              <div
                key={`${scrap.book_code}-${scrap.chapter}-${scrap.verse_start}-${i}`}
                className="bg-white rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() =>
                  onSelectScrap(scrap.version, scrap.book_code, scrap.chapter, scrap.verse_start, scrap.verse_end)
                }
              >
                <div className="flex items-start justify-between">
                  <p className="text-sm font-semibold text-gray-800">{scrap.reference}</p>
                  <span className="text-xs text-gray-400 shrink-0 ml-2 bg-gray-100 px-2 py-0.5 rounded-full">
                    {scrap.scrap_count}명
                  </span>
                </div>
                {scrap.image_url ? (
                  <div className="mt-2 relative w-full h-32 rounded-lg overflow-hidden bg-gray-100">
                    <img src={scrap.image_url} alt="카드" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{scrap.preview}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  {versionLabel(scrap.version)} · {formatScrapTime(scrap.latest_at)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
