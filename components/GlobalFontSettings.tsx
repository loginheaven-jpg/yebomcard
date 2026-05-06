"use client";

import { useFont, FONTS } from "@/contexts/FontContext";

interface Props {
  onClose: () => void;
}

export default function GlobalFontSettings({ onClose }: Props) {
  const { fontSize, setFontSize, fontKey, setFontKey, theme, setTheme } = useFont();

  return (
    <div className="fixed inset-0 z-[100] bg-black/30 animate-[fadeIn_0.2s_ease-out]" onClick={onClose}>
      <div 
        className="absolute inset-x-0 bottom-0 bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl overflow-hidden p-6 animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">화면 글꼴 설정</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 p-2 -mr-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">화면 테마</div>
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1.5">
              <button 
                onClick={() => setTheme("light")} 
                className={`flex-1 py-2 text-sm rounded-lg transition-all font-medium ${theme === "light" ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm dark:shadow-none" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:bg-gray-900"}`}
              >
                밝게
              </button>
              <button 
                onClick={() => setTheme("dark")} 
                className={`flex-1 py-2 text-sm rounded-lg transition-all font-medium ${theme === "dark" ? "bg-gray-800 text-white shadow-sm dark:shadow-none" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:bg-gray-900"}`}
              >
                어둡게
              </button>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">글자 크기</div>
            <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-900 p-2 rounded-xl">
              <button 
                onClick={() => setFontSize(Math.max(16, fontSize - 2))} 
                className="w-10 h-10 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm dark:shadow-none flex items-center justify-center hover:bg-gray-50 dark:bg-gray-900 active:scale-95 transition-all text-gray-600 dark:text-gray-400"
              >
                A-
              </button>
              <div className="flex-1 text-center font-medium text-gray-900 dark:text-gray-100">{fontSize}px</div>
              <button 
                onClick={() => setFontSize(Math.min(60, fontSize + 2))} 
                className="w-10 h-10 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm dark:shadow-none flex items-center justify-center hover:bg-gray-50 dark:bg-gray-900 active:scale-95 transition-all text-gray-600 dark:text-gray-400"
              >
                A+
              </button>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">글꼴 종류</div>
            <div className="grid grid-cols-3 gap-2">
              {FONTS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFontKey(f.key)}
                  className={`py-3 px-2 text-sm rounded-xl border transition-all text-center ${
                    fontKey === f.key 
                      ? "bg-gray-900 border-gray-900 text-white shadow-md dark:shadow-none ring-2 ring-gray-900 ring-offset-1" 
                      : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:bg-gray-900"
                  }`}
                  style={{ fontFamily: f.css, fontWeight: f.weight }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
