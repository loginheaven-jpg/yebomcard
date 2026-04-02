/**
 * 키워드 추출 + Unsplash 매핑
 */

const KEYWORD_BANK: Record<string, string[]> = {
  평안: ["평안", "안식", "쉬", "위로", "편안"],
  소망: ["소망", "바람", "희망", "기다", "기대"],
  능력: ["능력", "힘", "강", "권능", "승리"],
  사랑: ["사랑", "자비", "긍휼", "은총"],
  기쁨: ["기쁨", "즐거", "기뻐", "찬양", "감사"],
  생명: ["생명", "살", "치유", "회복", "고치"],
  믿음: ["믿", "신뢰", "의지"],
  지혜: ["지혜", "명철", "총명", "깨달"],
  영광: ["영광", "빛", "광채", "거룩"],
  구원: ["구원", "구속", "해방", "건지"],
};

const KEYWORD_TO_UNSPLASH: Record<string, string> = {
  평안: "peaceful lake calm water",
  소망: "sunrise golden light hope",
  능력: "mountain summit majestic",
  사랑: "flower garden warmth spring",
  기쁨: "meadow spring sunshine field",
  감사: "autumn harvest warm golden",
  생명: "green forest fresh morning",
  치유: "ocean waves serene healing",
  묵상: "misty morning quiet forest",
  영광: "golden sky clouds dramatic",
  구원: "dramatic sky light breaking clouds",
  믿음: "path road journey light",
  지혜: "library ancient wisdom light",
};

/**
 * 성경 텍스트에서 키워드 추출
 */
export function extractKeywords(text: string): string[] {
  const found: string[] = [];
  for (const [keyword, synonyms] of Object.entries(KEYWORD_BANK)) {
    if (synonyms.some((s) => text.includes(s))) {
      found.push(keyword);
    }
  }
  return found.length > 0 ? found : ["평안"]; // 기본값
}

/**
 * 본문에서 구체적 풍경 단어 추출 → 영문 변환
 */
const SCENE_WORDS: Record<string, string> = {
  풀밭: "green pasture meadow",
  초원: "green meadow field",
  풀: "green grass field",
  푸른: "green bright",
  산: "mountain",
  바다: "ocean sea",
  물: "water stream river",
  강: "river stream",
  호수: "lake",
  하늘: "sky clouds",
  꽃: "flowers bloom",
  나무: "tree forest",
  숲: "forest woodland",
  별: "stars night sky",
  빛: "sunlight rays bright",
  길: "path road",
  들: "field meadow",
  비: "rain",
  눈: "snow winter",
  바위: "rock cliff",
  양: "sheep lamb pasture",
  목자: "shepherd green pasture sheep",
  포도: "vineyard grapes",
};

/**
 * 키워드 → Unsplash 검색어 변환
 * 1순위: 본문에서 구체적 풍경 단어 추출
 * 2순위: 추상 키워드 매핑
 */
export function getUnsplashQuery(keywords: string[], text?: string): string {
  // 본문에서 구체적 풍경 단어 찾기
  if (text) {
    const sceneTerms: string[] = [];
    for (const [kr, en] of Object.entries(SCENE_WORDS)) {
      if (text.includes(kr)) {
        sceneTerms.push(en);
      }
    }
    if (sceneTerms.length > 0) {
      return sceneTerms.slice(0, 3).join(" ") + " bright beautiful";
    }
  }

  // fallback: 추상 키워드 매핑
  for (const kw of keywords) {
    if (KEYWORD_TO_UNSPLASH[kw]) {
      return KEYWORD_TO_UNSPLASH[kw];
    }
  }
  return "nature peaceful landscape bright";
}
