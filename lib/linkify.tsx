import React from "react";

// http(s) URL만 매칭 (javascript: 등 위험 스킴 제외 → XSS 안전). 공백/꺾쇠 전까지.
const URL_RE = /(https?:\/\/[^\s<]+)/g;

/**
 * 사용자 텍스트(메모 등)의 http(s) URL을 클릭 가능한 링크로 변환.
 * dangerouslySetInnerHTML 미사용(React 노드로 렌더 → XSS 안전), 새 탭 + noopener.
 * 절 행/메모가 클릭 토글 안에 있으므로 링크 클릭은 stopPropagation.
 */
export function linkify(text: string | null | undefined): React.ReactNode {
  if (!text) return text ?? "";
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    // 끝에 붙은 문장부호는 링크에서 제외(., ), ], 따옴표 등)
    let url = m[0];
    let trail = "";
    const trailMatch = url.match(/[.,)\]}"'»›]+$/);
    if (trailMatch) {
      trail = trailMatch[0];
      url = url.slice(0, -trail.length);
    }
    out.push(
      <span
        key={key++}
        role="link"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          window.open(url, "_blank", "noopener,noreferrer");
        }}
        className="underline text-blue-600 dark:text-blue-400 cursor-pointer break-all"
      >
        {url}
      </span>,
    );
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
