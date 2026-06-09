"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { parseReference, type ParsedReference } from "@/lib/parseReference";
import { getBookByCode } from "@/lib/books";
import { stripNotes, type BibleVerse, type BibleVersion } from "@/lib/types";

interface CardBuilderProps {
  onClose: () => void;
  onStart: (verses: BibleVerse[]) => void;
}

interface ParsedItem {
  ref: ParsedReference;
  verses: BibleVerse[];
  label: string;
}

const INPUT_KEY = "yebom_card_input";

// 입력 문자열 분리 (WorshipBible과 동일 규칙)
function splitReferences(input: string): string[] {
  const segments = input.split(";").map((s) => s.trim()).filter(Boolean);
  const tokens: string[] = [];
  for (const seg of segments) {
    const parts = seg.split(/[,\s]+(?=[가-힣])/).map((s) => s.trim()).filter(Boolean);
    tokens.push(...parts);
  }
  return tokens;
}

function formatVerseRange(verses: number[]): string {
  if (verses.length === 0) return "";
  const sorted = [...verses].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) end = sorted[i];
    else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = sorted[i]; end = sorted[i]; }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(",");
}

export default function CardBuilder({ onClose, onStart }: CardBuilderProps) {
  const [input, setInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(INPUT_KEY) || "";
  });
  const [version, setVersion] = useState<BibleVersion>("rnksv");
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 모달 열림 시 입력창 자동 포커스
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(INPUT_KEY, input); } catch {}
  }, [input]);

  async function handleParse() {
    if (!input.trim()) return;
    setLoading(true);
    setParsedItems([]);
    setParseErrors([]);

    const tokens = splitReferences(input);
    const items: ParsedItem[] = [];
    const errors: string[] = [];

    for (const token of tokens) {
      const parsed = parseReference(token);
      if (!parsed) { errors.push(token); continue; }
      const book = getBookByCode(parsed.bookCode);
      if (!book) { errors.push(token); continue; }

      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", parsed.bookCode)
        .eq("chapter", parsed.chapter);
      if (parsed.verses.length > 0) query = query.in("verse", parsed.verses);

      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        items.push({
          ref: parsed,
          verses: data as BibleVerse[],
          label: `${book.nameKr} ${parsed.chapter}장 ${formatVerseRange(data.map((v: BibleVerse) => v.verse))}절`,
        });
      } else {
        errors.push(token);
      }
    }

    setParsedItems(items);
    setParseErrors(errors);
    setLoading(false);
  }

  function removeItem(index: number) {
    setParsedItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleStart() {
    const allVerses = parsedItems.flatMap((item) => item.verses);
    if (allVerses.length === 0) return;
    onStart(allVerses);
  }

  const totalVerses = parsedItems.reduce((sum, item) => sum + item.verses.length, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 max-h-[90vh] bg-gray-50 dark:bg-gray-900 rounded-t-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 pt-2 max-w-[800px] mx-auto">
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />

          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">성경카드</h2>
            <button onClick={onClose} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-300">닫기</button>
          </div>

          {/* 입력 영역 */}
          <div className="flex gap-2 mb-2">
            <textarea
              ref={inputRef}
              lang="ko"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleParse(); } }}
              placeholder="요3:16, 시23:1-6"
              rows={2}
              className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
            />
            <button
              onClick={handleParse}
              disabled={loading || !input.trim()}
              className="shrink-0 px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors self-end"
            >
              {loading ? "..." : "구절 확인"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            쉼표 또는 스페이스로 구분 · 예: 요3:16, 시23:1-6 롬8:28
          </p>

          {/* 버전 선택 */}
          <div className="flex gap-1 mb-3">
            {(["nkrv", "rnksv"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVersion(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  version === v ? "bg-gray-900 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:bg-gray-800"
                }`}
              >
                {v === "nkrv" ? "개역" : "새번역"}
              </button>
            ))}
          </div>

          {/* 파싱 에러 */}
          {parseErrors.length > 0 && (
            <div className="mb-3 p-2 bg-red-50 rounded-lg">
              {parseErrors.map((err, i) => (
                <p key={i} className="text-xs text-red-500">✗ &ldquo;{err}&rdquo; — 인식 불가</p>
              ))}
            </div>
          )}

          {/* 파싱 결과 */}
          {parsedItems.length > 0 && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg mb-3 divide-y divide-gray-100">
              {parsedItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 dark:bg-gray-900">
                  <span className="text-green-500 mt-0.5 shrink-0 text-sm">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                      {item.verses.map((v) => stripNotes(v.text)).join(" ").slice(0, 60)}...
                    </p>
                  </div>
                  <button
                    onClick={() => removeItem(i)}
                    className="text-gray-300 hover:text-gray-500 dark:text-gray-400 shrink-0 mt-0.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 카드 만들기 시작 */}
          {totalVerses > 0 && (
            <button
              onClick={handleStart}
              className="w-full py-3.5 bg-[var(--amber)] text-white rounded-xl text-sm font-semibold shadow-lg dark:shadow-none hover:bg-[var(--amber-deep)] transition-colors"
            >
              카드 만들기 시작 ({totalVerses}절)
            </button>
          )}

          {parsedItems.length === 0 && !loading && (
            <p className="text-center text-xs text-gray-300 py-6">
              구절을 입력하고 &ldquo;구절 확인&rdquo;을 누르세요
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
