import { extractKeywords } from "./keywords";

/** 글자가 잘 읽히는 검증된 색 조합. 색상 배경에는 유료 AI를 쓰지 않는다. */
export function gradientBackgrounds(text: string) {
  const warm = extractKeywords(text).some((k) => ["사랑", "기쁨", "영광"].includes(k));
  return warm
    ? [
        { name: "따뜻한 빛", gradient: "linear-gradient(135deg, #78350f, #9f1239)", textColor: "white" },
        { name: "아침 햇살", gradient: "linear-gradient(135deg, #fef3c7, #fce7f3)", textColor: "dark" },
      ]
    : [
        { name: "고요한 숲", gradient: "linear-gradient(135deg, #134e4a, #1e3a5f)", textColor: "white" },
        { name: "평안한 아침", gradient: "linear-gradient(135deg, #d1fae5, #e0f2fe)", textColor: "dark" },
      ];
}
