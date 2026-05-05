import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://iityjmjgnjtvqujpivjg.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY5MDkyOCwiZXhwIjoyMDgyMjY2OTI4fQ.P7zoXy1eje-V8RU6xkwhKDHWkxBkg1KZXSGjbJdVJXk";

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixData() {
  const { data, error } = await supabase
    .from("bible_verses")
    .select("id, book_name, chapter, verse, text")
    .eq("version", "rnksv");

  if (error) {
    console.error("Error fetching:", error);
    return;
  }
  
  let fixedCount = 0;

  for (const row of data) {
    let text = row.text || "";
    const originalText = text;
    
    const openCount = (text.match(/\(/g) || []).length;
    const closeCount = (text.match(/\)/g) || []).length;
    
    let isModified = false;

    // 열린 괄호가 닫힌 괄호보다 많으면 끝에 ')' 추가
    if (openCount > closeCount) {
      text = text + ")".repeat(openCount - closeCount);
      isModified = true;
    }
    // 닫힌 괄호가 더 많은 경우
    else if (closeCount > openCount) {
      // 1. 역대상 1:17 의 경우: ") (주: ...(" -> 이런 경우 사실상 수작업에 가깝지만,
      // 가장 간단한 방식은 닫는 괄호를 제거하는 것입니다.
      // 맨 앞에 있는 닫는 괄호나 이상한 닫는 괄호를 없앨 수 있지만
      // 안전하게 맨 처음 나오는 불일치 ')'를 삭제하거나 끝에 '('를 붙이는 건 이상하므로
      // 수동 규칙을 적용합니다.
      
      if (text.includes("이다.) (주:")) {
        text = text.replace("이다.) (주:", "이다. (주:");
        isModified = true;
      }
      
      // 혹시 또 다른 닫힌 괄호 과다가 있다면 정규식으로 안전하게 처리
      // 그냥 닫는 괄호 중 매칭되지 않는 것을 제거하는 로직
      if (!isModified) {
         let depth = 0;
         let newText = "";
         for (let i = 0; i < text.length; i++) {
           if (text[i] === '(') depth++;
           else if (text[i] === ')') {
             if (depth === 0) continue; // 매칭 안된 ')' 스킵
             depth--;
           }
           newText += text[i];
         }
         text = newText;
         isModified = true;
      }
    }
    
    // 특이 케이스: 개수는 같으나 꼬여있는 경우 (예: ") (")
    if (text.includes(") (") && openCount === closeCount) {
      // "문장이다.) (주:..." 같은 경우가 많음
      text = text.replace(/\)\s*\(/g, " ("); // ") (" -> " (" 로 치환
      isModified = true;
    }

    // 변경사항이 있으면 DB 업데이트
    if (isModified && originalText !== text) {
      // 다시 한 번 괄호 개수 보정 (위에서 치환하면서 개수가 틀어질 수 있음)
      const finalOpen = (text.match(/\(/g) || []).length;
      const finalClose = (text.match(/\)/g) || []).length;
      if (finalOpen > finalClose) {
        text = text + ")".repeat(finalOpen - finalClose);
      } else if (finalClose > finalOpen) {
        text = text.replace(/\)$/, ""); // 끝에 있는 닫는 괄호 하나 제거
      }

      console.log(`[${row.book_name} ${row.chapter}:${row.verse}] 수정됨`);
      console.log(`- 기존: ${originalText}`);
      console.log(`- 수정: ${text}\n`);
      
      const { error: updateError } = await supabase
        .from("bible_verses")
        .update({ text: text })
        .eq("id", row.id);
        
      if (updateError) {
        console.error(`업데이트 실패 (id: ${row.id}):`, updateError);
      } else {
        fixedCount++;
      }
    }
  }
  
  console.log(`총 ${fixedCount}개의 괄호 오류 데이터가 수정되었습니다.`);
}

fixData();
