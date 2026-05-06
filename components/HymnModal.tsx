"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useWakeLock } from "@/hooks/useWakeLock";

import { useFont, FONTS } from "@/contexts/FontContext";

interface Hymn {
  id: number;
  number: number;
  korean_title: string;
  korean_lyrics: string;
  english_title?: string;
  english_lyrics?: string;
}

interface Props {
  onClose: () => void;
}

let cachedHymns: Hymn[] | null = null;

export default function HymnModal({ onClose }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<Hymn[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHymn, setSelectedHymn] = useState<Hymn | null>(null);
  
  useWakeLock(!!selectedHymn);

  // 검색 히스토리
  const HISTORY_KEY = "yebom_hymn_history";
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);

  function addToHistory(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 10);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const { fontSize, fontKey, theme } = useFont();

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);


  useEffect(() => {
    async function fetchAll() {
      if (cachedHymns) return;
      setLoading(true);
      const { data } = await supabase.from("hymns").select("*").order("number");
      if (data) cachedHymns = data;
      setLoading(false);
    }
    fetchAll();
  }, []);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    
    if (!searchTerm.trim()) {
      setResults([]);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      if (!cachedHymns) return;
      const term = searchTerm.trim();
      const isNumber = /^\d+$/.test(term);
      const cleanTerm = term.replace(/\s+/g, "").toLowerCase();

      const filtered = cachedHymns.filter((h) => {
        if (isNumber) return h.number === parseInt(term, 10);
        
        const cleanTitle = h.korean_title.replace(/\s+/g, "").toLowerCase();
        const cleanLyrics = h.korean_lyrics.replace(/\s+/g, "").toLowerCase();
        return cleanTitle.includes(cleanTerm) || cleanLyrics.includes(cleanTerm);
      });

      setResults(filtered.slice(0, 50));
    }, 150);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchTerm]);

  const currentFont = FONTS.find(f => f.key === fontKey) || FONTS[0];

  const formatLyrics = (lyrics: string) => {
    const lines = lyrics.split('\n').map(l => l.trim());
    const verses: string[][] = [];
    let currentVerse: string[] = [];

    lines.forEach((line) => {
      if (/^\d+\./.test(line)) {
        if (currentVerse.length > 0) verses.push(currentVerse);
        currentVerse = [line];
      } else {
        currentVerse.push(line);
      }
    });
    if (currentVerse.length > 0) verses.push(currentVerse);

    return verses.map((verseLines, i) => (
      <div key={i} className="mb-[1.5em] last:mb-0">
        {verseLines.map((line, j) => (
          <span key={j}>
            {line}
            {j < verseLines.length - 1 && <br />}
          </span>
        ))}
      </div>
    ));
  };

  const bgClass = theme === "dark" ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900";
  const cardClass = theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-100";
  const inputClass = theme === "dark" ? "bg-gray-800 text-white placeholder-gray-500 border-gray-700" : "bg-white text-gray-900 border-gray-200";

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col overflow-hidden animate-[fadeInUp_0.2s_ease-out] ${bgClass}`}>
      {/* Header */}
      <div className={`flex-none px-4 py-3 flex items-center justify-between border-b ${theme === "dark" ? "border-gray-800 bg-gray-900" : "border-gray-200 bg-white"} shadow-sm`}>
        <div className="flex items-center gap-3">
          {selectedHymn ? (
            <button
              onClick={() => setSelectedHymn(null)}
              className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${theme === "dark" ? "hover:bg-gray-800" : "hover:bg-gray-100"}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <button
              onClick={onClose}
              className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${theme === "dark" ? "hover:bg-gray-800" : "hover:bg-gray-100"}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <h1 className="text-lg font-bold">찬송가</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedHymn ? (
          // 검색 뷰
          <div className="max-w-2xl mx-auto p-4 md:p-8 w-full">
            <div className="relative mb-6">
              <input
                type="text"
                placeholder="장번호, 제목 또는 가사 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!cachedHymns || !searchTerm.trim()) return;
                    
                    const term = searchTerm.trim();
                    const isNumber = /^\d+$/.test(term);
                    const cleanTerm = term.replace(/\s+/g, "").toLowerCase();
              
                    const filtered = cachedHymns.filter((h) => {
                      if (isNumber) return h.number === parseInt(term, 10);
                      const cleanTitle = h.korean_title.replace(/\s+/g, "").toLowerCase();
                      const cleanLyrics = h.korean_lyrics.replace(/\s+/g, "").toLowerCase();
                      return cleanTitle.includes(cleanTerm) || cleanLyrics.includes(cleanTerm);
                    });

                    if (filtered.length === 1) {
                      setSelectedHymn(filtered[0]);
                      addToHistory(term);
                      setShowHistory(false);
                    }
                  }
                }}
                className={`w-full pl-12 pr-4 py-4 rounded-2xl text-lg outline-none border focus:border-[#B8860B] focus:ring-1 focus:ring-[#B8860B] transition-shadow ${inputClass}`}
              />
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>

              {showHistory && !searchTerm && searchHistory.length > 0 && (
                <div className={`absolute z-10 w-full mt-2 rounded-xl shadow-lg border overflow-hidden ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                  <div className="p-2">
                    <div className="px-3 py-1 text-xs text-gray-400 font-medium">최근 검색어</div>
                    {searchHistory.map((term, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer ${theme === "dark" ? "hover:bg-gray-700" : "hover:bg-gray-50"}`}>
                        <span className="flex-1 text-sm" onMouseDown={() => { setSearchTerm(term); setShowHistory(false); }}>{term}</span>
                        <button 
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const next = searchHistory.filter(h => h !== term);
                            setSearchHistory(next);
                            localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500">검색 중...</div>
            ) : results.length > 0 ? (
              <div className="space-y-3">
                {results.map((hymn) => (
                  <button
                    key={hymn.id}
                    onClick={() => {
                      setSelectedHymn(hymn);
                      addToHistory(searchTerm);
                    }}
                    className={`w-full text-left p-4 rounded-xl shadow-sm border transition-all active:scale-[0.98] ${cardClass} ${theme === "dark" ? "hover:border-gray-600" : "hover:border-gray-300"}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 flex items-center justify-center rounded-full font-bold text-lg ${theme === "dark" ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700"}`}>
                        {hymn.number}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold mb-1">{hymn.korean_title}</h3>
                        <p className={`text-sm truncate ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                          {hymn.korean_lyrics.split('\n')[0]}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : searchTerm ? (
              <div className="text-center py-12 text-gray-500">검색 결과가 없습니다</div>
            ) : (
              <div className="text-center py-12 text-gray-400">
                <p>장번호 숫자나, 가사 또는 제목을 검색해보세요.</p>
                <p className="mt-2 text-sm">(예: 1, 만복의, 은혜)</p>
              </div>
            )}
          </div>
        ) : (
          // 상세 뷰
          <div className="max-w-3xl mx-auto p-6 md:p-12 w-full h-full flex flex-col relative">
            <div className="text-center mb-10 mt-4 md:mt-8 relative flex items-center justify-center">
              <button 
                onClick={() => {
                   if (selectedHymn.number > 1 && cachedHymns) {
                     const prev = cachedHymns.find(h => h.number === selectedHymn.number - 1);
                     if (prev) setSelectedHymn(prev);
                   }
                }}
                disabled={selectedHymn.number <= 1}
                className="absolute left-0 p-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>

              <div>
                <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold tracking-wider mb-4 ${theme === "dark" ? "bg-gray-800 text-gray-400" : "bg-gray-200 text-gray-600"}`}>
                  새찬송가 {selectedHymn.number}장
                </span>
                <h2 className="text-2xl md:text-4xl font-bold" style={{ fontFamily: currentFont.css, fontWeight: 700 }}>
                  {selectedHymn.korean_title}
                </h2>
              </div>

              <button 
                onClick={() => {
                   if (cachedHymns) {
                     const next = cachedHymns.find(h => h.number === selectedHymn.number + 1);
                     if (next) setSelectedHymn(next);
                   }
                }}
                disabled={!cachedHymns || !cachedHymns.find(h => h.number === selectedHymn.number + 1)}
                className="absolute right-0 p-2 text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
            
            <div 
              className="flex-1 leading-[1.6] md:leading-[1.7] px-2 whitespace-pre-wrap break-keep pb-20"
              style={{ 
                fontFamily: currentFont.css, 
                fontWeight: currentFont.weight,
                fontSize: `${fontSize}px`
              }}
            >
              {formatLyrics(selectedHymn.korean_lyrics)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
