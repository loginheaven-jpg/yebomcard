import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 음원 생성 스튜디오 소스를 서버리스 번들에 포함시킨다.
  // 이 라우트들이 voice/ 의 .py 파일을 런타임에 읽어 설치된 PC 로 내려주는데,
  // Next 는 코드에서 import 하지 않은 파일을 기본적으로 빼버린다.
  outputFileTracingIncludes: {
    "/api/voice-studio/code": ["./voice/*.py", "./voice/README.md"],
    "/api/voice-studio/bootstrap": ["./voice/bootstrap.py"],
    // 성경 질문 — 교리 기준 본문(§1~§10)과 선별 프롬프트(§A)를 문서에서 읽어
    // system_prompt 로 보낸다(docs/BIBLE_QA_DOCTRINE.md §B-11). 재가받은 글이라
    // DB 가 아니라 저장소에 두고 git 에 이력을 남긴다.
    // 이 줄을 빠뜨리면 로컬에서는 되고 **배포에서만** 문서를 못 찾는다.
    "/api/bible-qa": [
      "./docs/BIBLE_QA_DOCTRINE.md",
      "./docs/BIBLE_QA_HOUSECHURCH.md",
    ],
  },
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
