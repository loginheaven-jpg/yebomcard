"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { parseReference, type ParsedReference } from "@/lib/parseReference";
import { getBookByCode } from "@/lib/books";
import { stripNotes, type BibleVerse, type BibleVersion } from "@/lib/types";
import FullscreenReader, { type FullscreenVerseItem } from "./FullscreenReader";

interface WorshipBibleProps {
  onClose: () => void;
}

interface WorshipSlot {
  name: string;
  input: string;
}

interface ParsedItem {
  ref: ParsedReference;
  verses: BibleVerse[];
  label: string; // "요한복음 2장 1절"
}

const STORAGE_KEY = "yebom_worship_lists";
const CURRENT_KEY = "yebom_worship_current";
const MAX_SLOTS = 10;

// ─── 입력 문자열을 개별 레퍼런스 토큰으로 분리 ───
// 규칙: 세미콜론은 항상 구분. 쉼표/스페이스 뒤에 한글이면 새 구절.
function splitReferences(input: string): string[] {
  // 세미콜론으로 먼저 분리
  const segments = input.split(";").map((s) => s.trim()).filter(Boolean);
  const tokens: string[] = [];

  for (const seg of segments) {
    // 쉼표 또는 스페이스 뒤에 한글이 오는 지점에서 분리
    const parts = seg.split(/[,\s]+(?=[가-힣])/).map((s) => s.trim()).filter(Boolean);
    tokens.push(...parts);
  }
  return tokens;
}

// ─── 절 범위 포맷 ───
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

export default function WorshipBible({ onClose }: WorshipBibleProps) {
  const [input, setInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(CURRENT_KEY) || "";
  });
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState<BibleVersion>("rnksv");
  const [parallel, setParallel] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);

  // 슬롯 관리
  const [slots, setSlots] = useState<WorshipSlot[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [showSlotMenu, setShowSlotMenu] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  // 자동저장 (입력 변경마다)
  useEffect(() => {
    try { localStorage.setItem(CURRENT_KEY, input); } catch {}
  }, [input]);

  // 슬롯 저장
  function saveSlot() {
    const name = saveName.trim() || new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
    const next = [{ name, input }, ...slots.filter((s) => s.name !== name)].slice(0, MAX_SLOTS);
    setSlots(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    setShowSaveInput(false);
    setSaveName("");
  }

  function loadSlot(slot: WorshipSlot) {
    setInput(slot.input);
    setShowSlotMenu(false);
  }

  function deleteSlot(name: string) {
    const next = slots.filter((s) => s.name !== name);
    setSlots(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  // ─── 구절 파싱 + DB 조회 ───
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
      if (!parsed) {
        errors.push(token);
        continue;
      }

      const book = getBookByCode(parsed.bookCode);
      if (!book) { errors.push(token); continue; }

      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", parsed.bookCode)
        .eq("chapter", parsed.chapter);

      if (parsed.verses.length > 0) {
        query = query.in("verse", parsed.verses);
      }

      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        const verseNums = data.map((v: BibleVerse) => v.verse);
        const range = formatVerseRange(verseNums);
        items.push({
          ref: parsed,
          verses: data as BibleVerse[],
          label: `${book.nameKr} ${parsed.chapter}장 ${range}절`,
        });
      } else {
        errors.push(token);
      }
    }

    setParsedItems(items);
    setParseErrors(errors);
    setLoading(false);
  }

  // ─── 버전 변경 시 re-fetch ───
  async function refetchAllItems(newVersion: BibleVersion) {
    setVersion(newVersion);
    if (parsedItems.length === 0) return;
    const updated: ParsedItem[] = [];
    for (const item of parsedItems) {
      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", newVersion)
        .eq("book_code", item.ref.bookCode)
        .eq("chapter", item.ref.chapter);
      if (item.ref.verses.length > 0) query = query.in("verse", item.ref.verses);
      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        updated.push({ ...item, verses: data as BibleVerse[] });
      }
    }
    setParsedItems(updated);
  }

  // ─── 풀스크린에서 구절 추가 (onAddVerses 콜백) ───
  async function handleAddFromFullscreen(inputStr: string) {
    const tokens = splitReferences(inputStr);
    const newItems: ParsedItem[] = [];
    for (const token of tokens) {
      const parsed = parseReference(token);
      if (!parsed) continue;
      const book = getBookByCode(parsed.bookCode);
      if (!book) continue;
      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", parsed.bookCode)
        .eq("chapter", parsed.chapter);
      if (parsed.verses.length > 0) query = query.in("verse", parsed.verses);
      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        const verseNums = data.map((v: BibleVerse) => v.verse);
        newItems.push({
          ref: parsed,
          verses: data as BibleVerse[],
          label: `${book.nameKr} ${parsed.chapter}장 ${formatVerseRange(verseNums)}절`,
        });
      }
    }
    if (newItems.length > 0) setParsedItems((prev) => [...prev, ...newItems]);
  }

  // ─── 풀스크린 데이터 생성 ───
  const allVerses = parsedItems.flatMap((item) => item.verses);

  const fsVerses: FullscreenVerseItem[] = allVerses.map((v) => ({
    ref: `${v.book_name} ${v.chapter}장 ${v.verse}절`,
    main: stripNotes(v.text),
  }));

  const jumpRefs = allVerses.map((v) => ({
    book_abbr: v.book_abbr,
    book_code: v.book_code,
    chapter: v.chapter,
    verse: v.verse,
  }));

  // ─── 항목 삭제 ───
  function removeItem(index: number) {
    setParsedItems((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
        <div
          className="absolute inset-x-0 bottom-0 max-h-[90vh] bg-gray-50 rounded-t-2xl overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 pt-2 max-w-[800px] mx-auto">
            {/* 핸들 바 */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />

            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">예배성경</h2>
              <button
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                닫기
              </button>
            </div>

            {/* 슬롯 관리 */}
            <div className="flex gap-2 mb-3 items-center">
              <div className="relative flex-1">
                <button
                  onClick={() => setShowSlotMenu(!showSlotMenu)}
                  className="w-full py-2 px-3 text-left text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center justify-between"
                >
                  <span>{slots.length > 0 ? "저장된 목록 불러오기" : "저장된 목록 없음"}</span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {showSlotMenu && slots.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {slots.map((slot) => (
                      <div key={slot.name} className="flex items-center hover:bg-gray-50">
                        <button
                          onClick={() => loadSlot(slot)}
                          className="flex-1 px-3 py-2.5 text-left text-sm text-gray-700"
                        >
                          <span className="font-medium">{slot.name}</span>
                          <span className="block text-xs text-gray-400 mt-0.5 truncate">{slot.input}</span>
                        </button>
                        <button
                          onClick={() => deleteSlot(slot.name)}
                          className="px-3 text-gray-300 hover:text-gray-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {showSaveInput ? (
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveSlot()}
                    placeholder="이름 (예: 주일예배)"
                    className="w-28 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-400"
                    autoFocus
                  />
                  <button onClick={saveSlot} className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg">
                    확인
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveInput(true)}
                  className="px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  저장
                </button>
              )}
            </div>

            {/* 입력 영역 */}
            <div className="flex gap-2 mb-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleParse(); } }}
                placeholder="요2:1, 신12:10-12, 계10:10,17 요일2:1"
                rows={2}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
              />
              <button
                onClick={handleParse}
                disabled={loading || !input.trim()}
                className="shrink-0 px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors self-end"
              >
                {loading ? "..." : "구절 추가"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              쉼표 또는 스페이스로 구분 · 예: 요2:1, 시23:1-6 롬8:28
            </p>

            {/* 파싱 에러 */}
            {parseErrors.length > 0 && (
              <div className="mb-3 p-2 bg-red-50 rounded-lg">
                {parseErrors.map((err, i) => (
                  <p key={i} className="text-xs text-red-500">✗ &ldquo;{err}&rdquo; — 인식 불가</p>
                ))}
              </div>
            )}

            {/* 파싱 결과 리스트 */}
            {parsedItems.length > 0 && (
              <div className="border border-gray-200 rounded-lg mb-3 divide-y divide-gray-100">
                {parsedItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50">
                    <span className="text-green-500 mt-0.5 shrink-0 text-sm">✓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                        {item.verses.map((v) => stripNotes(v.text)).join(" ").slice(0, 60)}...
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(i)}
                      className="text-gray-300 hover:text-gray-500 shrink-0 mt-0.5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 풀스크린 시작 버튼 */}
            {allVerses.length > 0 && (
              <button
                onClick={() => setShowFullscreen(true)}
                className="w-full py-3.5 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[#9A7009] transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-11.25 11.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
                </svg>
                풀스크린 시작 ({allVerses.length}절)
              </button>
            )}

            {parsedItems.length === 0 && !loading && (
              <p className="text-center text-xs text-gray-300 py-6">
                구절을 입력하고 &ldquo;구절 추가&rdquo;를 누르세요
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 풀스크린 리더 */}
      {showFullscreen && fsVerses.length > 0 && (
        <FullscreenReader
          verses={fsVerses}
          version={version}
          onVersionChange={refetchAllItems}
          parallel={parallel}
          onParallelToggle={() => setParallel(!parallel)}
          onClose={() => setShowFullscreen(false)}
          jumpMode
          jumpRefs={jumpRefs}
          hideVersionButtons={false}
          onAddVerses={handleAddFromFullscreen}
        />
      )}
    </>
  );
}
