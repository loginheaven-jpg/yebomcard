"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

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

const FONTS = [
  { key: "noto-serif", label: "명조", css: "var(--font-noto-serif-kr), 'Noto Serif KR', serif", weight: 600 },
  { key: "noto-sans", label: "고딕", css: "var(--font-noto-sans-kr), 'Noto Sans KR', sans-serif", weight: 700 },
  { key: "gowun-dodum", label: "돋움", css: "var(--font-gowun-dodum), 'Gowun Dodum', sans-serif", weight: 400 },
  { key: "gothic-a1", label: "Gothic", css: "var(--font-gothic-a1), 'Gothic A1', sans-serif", weight: 600 },
  { key: "ibm-plex", label: "Plex", css: "var(--font-ibm-plex), 'IBM Plex Sans KR', sans-serif", weight: 600 },
] as const;

type FontKey = typeof FONTS[number]["key"];

export default function HymnModal({ onClose }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<Hymn[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHymn, setSelectedHymn] = useState<Hymn | null>(null);

  // 설정
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("hymnTheme") as "light" | "dark") || "light";
  });
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") return 24;
    return parseInt(localStorage.getItem("hymnFontSize") || "24");
  });
  const [fontKey, setFontKey] = useState<FontKey>(() => {
    if (typeof window === "undefined") return "noto-serif";
    return (localStorage.getItem("hymnFont") as FontKey) || "noto-serif";
  });

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    localStorage.setItem("hymnTheme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("hymnFontSize", String(fontSize));
  }, [fontSize]);
  useEffect(() => {
    localStorage.setItem("hymnFont", fontKey);
  }, [fontKey]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    
    if (!searchTerm.trim()) {
      setResults([]);
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      setLoading(true);
      let query = supabase.from("hymns").select("*");
      
      const term = searchTerm.trim();
      const isNumber = /^\d+$/.test(term);
      
      if (isNumber) {
        query = query.eq("number", parseInt(term, 10));
      } else {
        query = query.or(`korean_title.ilike.%${term}%,korean_lyrics.ilike.%${term}%`);
      }
      
      const { data, error } = await query.order("number").limit(50);
      if (data && !error) {
        setResults(data);
      }
      setLoading(false);
    }, 300);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchTerm]);

  const currentFont = FONTS.find(f => f.key === fontKey) || FONTS[0];

  const formatLyrics = (lyrics: string) => {
    return lyrics.split('\n').map((line, i) => (
      <span key={i}>
        {line}
        <br />
      </span>
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

        {selectedHymn && (
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${theme === "dark" ? "hover:bg-gray-800 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showSettings && (
              <div className={`absolute right-0 top-full mt-2 w-64 rounded-2xl shadow-xl border overflow-hidden p-4 ${theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
                <div className="space-y-4">
                  {/* 테마 */}
                  <div className="flex bg-gray-100 dark:bg-gray-900 rounded-lg p-1">
                    <button onClick={() => setTheme("light")} className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${theme === "light" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>밝게</button>
                    <button onClick={() => setTheme("dark")} className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${theme === "dark" ? "bg-gray-800 text-white shadow-sm" : "text-gray-500"}`}>어둡게</button>
                  </div>
                  {/* 폰트 크기 */}
                  <div className="flex items-center gap-3">
                    <button onClick={() => setFontSize(Math.max(16, fontSize - 2))} className={`w-8 h-8 rounded-full border flex items-center justify-center ${theme === "dark" ? "border-gray-600 hover:bg-gray-700" : "border-gray-200 hover:bg-gray-50"}`}>A-</button>
                    <div className="flex-1 text-center text-sm">{fontSize}px</div>
                    <button onClick={() => setFontSize(Math.min(60, fontSize + 2))} className={`w-8 h-8 rounded-full border flex items-center justify-center ${theme === "dark" ? "border-gray-600 hover:bg-gray-700" : "border-gray-200 hover:bg-gray-50"}`}>A+</button>
                  </div>
                  {/* 폰트 선택 */}
                  <div className="grid grid-cols-2 gap-2">
                    {FONTS.map(f => (
                      <button
                        key={f.key}
                        onClick={() => setFontKey(f.key)}
                        className={`py-2 text-sm rounded-lg border transition-colors ${fontKey === f.key ? (theme === "dark" ? "bg-gray-700 border-gray-500 text-white" : "bg-gray-900 text-white border-gray-900") : (theme === "dark" ? "border-gray-700 text-gray-400 hover:bg-gray-750" : "border-gray-200 text-gray-600 hover:bg-gray-50")}`}
                        style={{ fontFamily: f.css, fontWeight: f.weight }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" onClick={() => setShowSettings(false)}>
        {!selectedHymn ? (
          // 검색 뷰
          <div className="max-w-2xl mx-auto p-4 md:p-8 w-full">
            <div className="relative mb-6">
              <input
                type="text"
                placeholder="장번호, 제목 또는 가사 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full pl-12 pr-4 py-4 rounded-2xl text-lg outline-none border focus:border-[#B8860B] focus:ring-1 focus:ring-[#B8860B] transition-shadow ${inputClass}`}
              />
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500">검색 중...</div>
            ) : results.length > 0 ? (
              <div className="space-y-3">
                {results.map((hymn) => (
                  <button
                    key={hymn.id}
                    onClick={() => setSelectedHymn(hymn)}
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
          <div className="max-w-3xl mx-auto p-6 md:p-12 w-full h-full flex flex-col">
            <div className="text-center mb-10 mt-4 md:mt-8">
              <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold tracking-wider mb-4 ${theme === "dark" ? "bg-gray-800 text-gray-400" : "bg-gray-200 text-gray-600"}`}>
                새찬송가 {selectedHymn.number}장
              </span>
              <h2 className="text-2xl md:text-4xl font-bold" style={{ fontFamily: currentFont.css, fontWeight: 700 }}>
                {selectedHymn.korean_title}
              </h2>
            </div>
            
            <div 
              className="flex-1 leading-[2.2] md:leading-[2.4] px-2 whitespace-pre-wrap break-keep pb-20"
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
