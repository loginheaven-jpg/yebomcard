export interface GradientPreset {
  name: string;
  gradient: string;
  keywords: string[];
  textColor: "white" | "dark";
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    name: "새벽기도",
    gradient: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
    keywords: ["새벽", "기도", "경건"],
    textColor: "white",
  },
  {
    name: "봄날",
    gradient: "linear-gradient(135deg, #a8e6cf, #dcedc1, #ffd3b6)",
    keywords: ["소망", "새로움", "기쁨"],
    textColor: "dark",
  },
  {
    name: "은혜",
    gradient: "linear-gradient(135deg, #667eea, #764ba2)",
    keywords: ["은혜", "영광", "하늘"],
    textColor: "white",
  },
  {
    name: "석양",
    gradient: "linear-gradient(135deg, #fa709a, #fee140)",
    keywords: ["감사", "찬양"],
    textColor: "dark",
  },
  {
    name: "평안",
    gradient: "linear-gradient(135deg, #a1c4fd, #c2e9fb)",
    keywords: ["평안", "안식", "위로"],
    textColor: "dark",
  },
  {
    name: "산위에서",
    gradient: "linear-gradient(135deg, #2c3e50, #4ca1af)",
    keywords: ["능력", "힘", "승리"],
    textColor: "white",
  },
  {
    name: "들꽃",
    gradient: "linear-gradient(135deg, #f093fb, #f5576c)",
    keywords: ["사랑", "아름다움"],
    textColor: "white",
  },
  {
    name: "순금",
    gradient: "linear-gradient(135deg, #f7971e, #ffd200)",
    keywords: ["말씀", "진리", "보배"],
    textColor: "dark",
  },
  {
    name: "밤하늘",
    gradient: "linear-gradient(135deg, #0c0c1d, #1a1a3e, #2d2d5e)",
    keywords: ["묵상", "깊음"],
    textColor: "white",
  },
  {
    name: "초원",
    gradient: "linear-gradient(135deg, #11998e, #38ef7d)",
    keywords: ["생명", "치유", "회복"],
    textColor: "white",
  },
  {
    name: "구름위",
    gradient: "linear-gradient(135deg, #e0c3fc, #8ec5fc)",
    keywords: ["천국", "영원"],
    textColor: "dark",
  },
  {
    name: "불기둥",
    gradient: "linear-gradient(135deg, #eb3349, #f45c43)",
    keywords: ["열정", "심판"],
    textColor: "white",
  },
];

/**
 * 말씀 텍스트에서 매칭되는 그라데이션 찾기
 * 매칭 안 되면 랜덤 반환
 */
export function findGradient(text: string): GradientPreset {
  for (const preset of GRADIENT_PRESETS) {
    if (preset.keywords.some((kw) => text.includes(kw))) {
      return preset;
    }
  }
  return GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)];
}

/**
 * 5개 추천: 매칭된 것 우선 + 나머지 랜덤 채움
 */
export function findGradients(text: string, count = 5): GradientPreset[] {
  const matched = GRADIENT_PRESETS.filter((p) =>
    p.keywords.some((kw) => text.includes(kw))
  );
  const rest = GRADIENT_PRESETS.filter((p) => !matched.includes(p));
  const shuffled = rest.sort(() => Math.random() - 0.5);
  return [...matched, ...shuffled].slice(0, count);
}
