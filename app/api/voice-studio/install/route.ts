/**
 * GET /api/voice-studio/install — 관리자 전용. 설치용 배치파일을 내려준다.
 *
 * 브라우저는 방문자 PC 에 프로그램을 설치할 수 없다(샌드박스). 그래서 대신
 * **토큰이 박힌 설치 파일 하나**를 내려주고, 사람은 더블클릭만 한다.
 *
 * 배치파일이 하는 일은 딱 세 가지다. 나머지 판단은 전부 bootstrap.py 가 한다
 * (배치 스크립트는 한글·오류 처리가 취약해서 최소한만 맡긴다):
 *   1. 파이썬이 없으면 winget 으로 설치
 *   2. bootstrap.py 를 서버에서 받아온다
 *   3. 실행한다
 *
 * 토큰이 파일 안에 들어 있으므로 이 파일 자체가 자격증명이다. 유출되면
 * 관리자 화면에서 폐기(revoke)할 수 있다.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/voiceStudio/auth";
import { issueToken } from "@/lib/voiceStudio/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILENAME = "예봄성경-음원생성-설치.bat";

function batch(baseUrl: string, token: string, label: string): string {
  // 주의: 배치파일은 CRLF 여야 한다. LF 로 저장되면 명령이 통째로 깨진다.
  return [
    `@echo off`,
    `chcp 65001 > nul`,
    `title 예봄성경 음원 생성 PC 설치`,
    `setlocal`,
    ``,
    `set "YEBOM_BASE=${baseUrl}"`,
    `set "YEBOM_TOKEN=${token}"`,
    `set "YEBOM_HOME=%LOCALAPPDATA%\\YebomVoice"`,
    ``,
    `echo.`,
    `echo   예봄성경 음원 생성 PC 설치`,
    `echo   발급: ${label}`,
    `echo   설치 위치: %YEBOM_HOME%`,
    `echo.`,
    ``,
    `rem ── 1. 파이썬 확인, 없으면 설치 ──`,
    `set "PY="`,
    `for /f "delims=" %%i in ('where python 2^>nul') do if not defined PY set "PY=%%i"`,
    `if not defined PY (`,
    `  echo   파이썬이 없습니다. 자동으로 설치합니다 ^(3~5분^)...`,
    `  winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements`,
    `  if errorlevel 1 (`,
    `    echo.`,
    `    echo   [실패] 파이썬 자동 설치에 실패했습니다.`,
    `    echo   https://www.python.org/downloads/ 에서 직접 설치한 뒤 이 파일을 다시 실행해 주세요.`,
    `    echo   설치할 때 "Add python.exe to PATH" 를 반드시 체크하세요.`,
    `    pause & exit /b 1`,
    `  )`,
    `  rem winget 설치 직후에는 PATH 가 이 창에 반영되지 않는다 — 알려진 경로에서 직접 찾는다`,
    `  set "PY=%LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe"`,
    `)`,
    `if not exist "%PY%" (`,
    `  for /f "delims=" %%i in ('where python 2^>nul') do set "PY=%%i"`,
    `)`,
    `if not exist "%PY%" (`,
    `  echo   [실패] 파이썬을 찾지 못했습니다. PC 를 다시 시작한 뒤 이 파일을 다시 실행해 주세요.`,
    `  pause & exit /b 1`,
    `)`,
    ``,
    `rem ── 2. 설치 스크립트 받기 ──`,
    `if not exist "%YEBOM_HOME%" mkdir "%YEBOM_HOME%"`,
    `echo   설치 스크립트를 내려받는 중...`,
    `curl -sS -f -H "Authorization: Bearer %YEBOM_TOKEN%" -o "%YEBOM_HOME%\\bootstrap.py" "%YEBOM_BASE%/api/voice-studio/bootstrap"`,
    `if errorlevel 1 (`,
    `  echo.`,
    `  echo   [실패] 서버에서 설치 스크립트를 받지 못했습니다.`,
    `  echo   인터넷 연결을 확인하시고, 그래도 안 되면 설치 파일을 새로 받아 주세요`,
    `  echo   ^(토큰이 만료되었을 수 있습니다^).`,
    `  pause & exit /b 1`,
    `)`,
    ``,
    `rem ── 3. 나머지는 파이썬이 처리 ──`,
    `"%PY%" "%YEBOM_HOME%\\bootstrap.py"`,
    `set "RC=%ERRORLEVEL%"`,
    `if not "%RC%"=="0" (`,
    `  echo.`,
    `  echo   설치가 완료되지 못했습니다. 위 메시지를 확인해 주세요.`,
    `  pause`,
    `)`,
    `endlocal`,
    `exit /b %RC%`,
  ].join("\r\n");
}

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const email = gate.session.email || "관리자";
  let token: string;
  try {
    token = issueToken(email).token;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "토큰 발급 실패" },
      { status: 500 },
    );
  }

  const baseUrl = new URL(req.url).origin;
  const label = `${email} · ${new Date().toLocaleDateString("ko-KR")}`;
  const body = batch(baseUrl, token, label);

  // 파일명이 한글이라 filename* (RFC 5987) 로 준다. 구형 대비 ASCII 이름도 병기.
  const encoded = encodeURIComponent(FILENAME);
  return new NextResponse(body, {
    status: 200,
    headers: {
      // BOM 은 붙이지 않는다 — cmd.exe 가 첫 줄에서 깨진 문자를 출력한다.
      // 대신 배치 첫 줄의 chcp 65001 로 한글을 처리한다.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="yebom-voice-setup.bat"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
