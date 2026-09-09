import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 음원 생성 스튜디오 소스를 서버리스 번들에 포함시킨다.
  // 이 라우트들이 voice/ 의 .py 파일을 런타임에 읽어 설치된 PC 로 내려주는데,
  // Next 는 코드에서 import 하지 않은 파일을 기본적으로 빼버린다.
  outputFileTracingIncludes: {
    "/api/voice-studio/code": ["./voice/*.py", "./voice/README.md"],
    "/api/voice-studio/bootstrap": ["./voice/bootstrap.py"],
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
