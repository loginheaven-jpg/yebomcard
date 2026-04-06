# 예봄서비스 — 신규 서비스 SSO 로그인 통합 가이드

> **최종 수정**: 2026-04-06
> **대상**: 예봄카드 및 향후 신규 서비스 개발자
> **전제**: 예봄서비스 통합 인증 체계 (교적부 중심 SSO)

---

## 1. 인증 아키텍처 개요

예봄서비스는 **교적부(saint.yebom.org)가 인증의 중심**이다.
모든 서비스는 교적부의 로그인/가입 페이지를 공유하며, SSO 쿠키로 인증 상태를 전파한다.

```
사용자 → 신규 서비스 접속
  ↓
미들웨어: saint_record_session 쿠키 확인
  ├─ 있음 → unsealData로 복호화 → 유효하면 통과
  │                              → 유효하지 않으면 쿠키 삭제 → 로그인으로
  └─ 없음 → saint.yebom.org/login?from=서비스코드 로 리다이렉트
              ↓
         이메일+비밀번호 또는 카카오 로그인
              ↓
         SSO 쿠키 발급 (.yebom.org 도메인)
              ↓
         원래 서비스로 리다이렉트 → 쿠키 자동 인식
```

---

## 2. 구현할 것 / 안 할 것

### 2.1 구현 필요 (3가지만)

| # | 항목 | 설명 |
|---|------|------|
| 1 | **미들웨어** | SSO 쿠키 확인 + **유효성 검증** → 실패 시 교적부 로그인으로 리다이렉트 |
| 2 | **세션 API** | `/api/auth/session` — 쿠키 복호화 후 세션 정보 반환 |
| 3 | **로그아웃 API** | `/api/auth/logout` — **양쪽 도메인** 쿠키 삭제 |

### 2.2 구현 불필요 (교적부가 처리)

- ~~로그인 페이지~~ → 교적부 `/login?from=서비스코드`
- ~~회원가입 페이지~~ → 교적부 `/join?from=서비스코드`
- ~~카카오 OAuth~~ → 교적부에서 처리
- ~~비밀번호 찾기~~ → 교적부에서 처리
- ~~회원 DB 관리~~ → 교적부 `users` + `members` 테이블

---

## 3. 환경변수

```env
# .env.local
SESSION_SECRET=교적부와_동일한_32자_이상_시크릿
COOKIE_DOMAIN=.yebom.org
```

| 변수 | 설명 | 주의 |
|------|------|------|
| `SESSION_SECRET` | iron-session 암호화 키 | **교적부/기도의집/재정부와 반드시 동일**. 다르면 SSO 실패 |
| `COOKIE_DOMAIN` | 쿠키 공유 도메인 | 프로덕션: `.yebom.org`, 로컬 개발: 설정하지 않음 |

**Vercel 환경변수에도 동일하게 설정해야 한다.**

---

## 4. 필요 패키지

```bash
npm install iron-session
```

---

## 5. 구현 코드

### 5.1 세션 설정 (`lib/auth/session.ts`)

```typescript
import { SessionOptions } from 'iron-session'

const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'saint_record_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7일
    path: '/',
    domain: COOKIE_DOMAIN,
  },
}

export interface SessionData {
  user_id: string
  name: string
  email: string
  permission_level: string
  is_approved: boolean
  member_id: string | null
  group_id: string | null
  group_role: string | null
  finance_role: string
  isLoggedIn: boolean
}
```

> **주의**: 쿠키 도메인은 반드시 `COOKIE_DOMAIN` 환경변수를 사용한다.
> `NODE_ENV === 'production'` 조건으로 하드코딩하면 Vercel 환경에서 불일치가 발생할 수 있다.

---

### 5.2 미들웨어 (`middleware.ts`)

**중요**: 쿠키 **존재 여부**만 확인하면 안 된다. 반드시 `unsealData`로 **유효성을 검증**해야 한다.
유효하지 않은 쿠키(만료/손상)가 남아있으면 빈 화면이 표시되는 문제가 발생한다.

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { unsealData } from 'iron-session'

const COOKIE_NAME = 'saint_record_session'
const SERVICE_CODE = 'bible' // 서비스별로 변경: prayer, finance, radio, bible 등

// 인증 불필요 경로 (서비스에 맞게 수정)
const publicPaths = ['/api/auth', '/api/bible']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 정적 파일, public API 무시
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.') ||
    publicPaths.some(p => pathname.startsWith(p))
  ) {
    return NextResponse.next()
  }

  // SSO 쿠키 유효성 검증
  const sessionCookie = request.cookies.get(COOKIE_NAME)
  if (sessionCookie) {
    try {
      const session = await unsealData(sessionCookie.value, {
        password: process.env.SESSION_SECRET!,
      }) as { isLoggedIn?: boolean }
      if (session?.isLoggedIn) {
        return NextResponse.next()
      }
    } catch {
      // 복호화 실패 → 쿠키 삭제
    }
    // 유효하지 않은 쿠키 삭제 후 로그인으로
    const response = NextResponse.redirect(
      `https://saint.yebom.org/login?from=${SERVICE_CODE}`
    )
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    const domain = process.env.COOKIE_DOMAIN
    if (domain) response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/', domain })
    return response
  }

  // 쿠키 없음 → 교적부 통합 로그인으로 리다이렉트
  return NextResponse.redirect(
    `https://saint.yebom.org/login?from=${SERVICE_CODE}`
  )
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

---

### 5.3 세션 API (`app/api/auth/session/route.ts`)

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { unsealData } from 'iron-session'
import { sessionOptions, SessionData } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const sealed = cookieStore.get(sessionOptions.cookieName)

    if (!sealed) {
      return NextResponse.json({ session: null })
    }

    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    })

    if (!session?.isLoggedIn) {
      return NextResponse.json({ session: null })
    }

    return NextResponse.json({ session })
  } catch {
    return NextResponse.json({ session: null })
  }
}
```

---

### 5.4 로그아웃 API (`app/api/auth/logout/route.ts`)

**중요**: 쿠키를 **양쪽 도메인**(현재 호스트 + `.yebom.org`)에서 모두 삭제해야 한다.
한쪽만 삭제하면 구 쿠키가 남아서 로그인 루프가 발생한다.

```typescript
import { NextResponse } from 'next/server'
import { sessionOptions } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({ success: true })
  const cookieOpts = sessionOptions.cookieOptions || {}

  // 양쪽 도메인의 쿠키 모두 삭제 (도메인 불일치 잔존 방지)
  response.cookies.set(sessionOptions.cookieName, '', { maxAge: 0, path: '/' })
  if (cookieOpts.domain) {
    response.cookies.set(sessionOptions.cookieName, '', {
      maxAge: 0, path: '/', domain: cookieOpts.domain,
    })
  }

  return response
}
```

---

### 5.5 클라이언트 훅 (`hooks/use-session.ts`)

```typescript
'use client'
import { useState, useEffect } from 'react'
import type { SessionData } from '@/lib/auth/session'

export function useSession() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(d => setSession(d.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = 'https://saint.yebom.org/login?from=bible'
  }

  return { session, loading, logout }
}
```

> **주의**: 클라이언트에서 세션이 null일 때 `/login`으로 리다이렉트하는 코드를 **넣지 마라**.
> 인증 리다이렉트는 미들웨어가 서버 사이드에서 처리한다.
> 클라이언트에서 중복 리다이렉트하면 SSO 쿠키 타이밍 경합으로 로그인 루프가 발생한다 (스마트폰).

---

## 6. 교적부 연동 설정 (1회)

교적부 로그인 페이지의 `SERVICE_INFO`에 신규 서비스를 추가해야 한다.

**교적부 `src/app/(auth)/login/page.tsx`에 추가**:
```typescript
const SERVICE_INFO = {
  prayer: { label: '기도의 집을 이용하려면', redirect: 'https://prayer.yebom.org' },
  radio:  { label: '라디오를 이용하려면',    redirect: 'https://radio-axi.pages.dev' },
  finance:{ label: '재정부를 이용하려면',    redirect: 'https://finance.yebom.org' },
  bible:  { label: '예봄성경을 이용하려면',   redirect: 'https://bible.yebom.org' },
}
```

---

## 7. 접근 권한

예봄카드는 **모든 가입 회원이 사용 가능**하다. 별도 권한 체크 불필요.

| 기능 | 권한 |
|------|------|
| 성경 검색 | 비로그인 허용 (public API) |
| 카드 생성 | 로그인 필수 |
| 카드 다운로드 | 로그인 필수 |
| AI 추천 | 로그인 필수 |

미들웨어에서 `/api/bible` 경로는 publicPaths에 포함하여 비로그인도 검색 가능하게 할 수 있다.

---

## 8. 도메인 설정

| 환경 | URL | COOKIE_DOMAIN |
|------|-----|---------------|
| 로컬 개발 | `localhost:3000` | 설정하지 않음 (undefined) |
| 프로덕션 | `bible.yebom.org` | `.yebom.org` |

Vercel에서 커스텀 도메인 `bible.yebom.org` 설정 후,
DNS에 CNAME 레코드 추가가 필요하다.

### 로컬 개발 시 SSO 테스트

로컬(localhost)에서는 `.yebom.org` 쿠키를 받을 수 없으므로 SSO가 작동하지 않는다.
로컬 개발 시 세션 우회 방법:

```typescript
// 개발 전용: /api/auth/dev-login 생성 (프로덕션 배포 금지)
if (process.env.NODE_ENV !== 'production') {
  // 임시 세션을 직접 생성하여 개발 테스트
}
```

또는 Vercel Preview URL로 테스트 (`.vercel.app` 도메인에서는 SSO 불가, `bible.yebom.org`에서만 SSO 가능).

---

## 9. 운영 중 발견된 주의사항 (필독)

### 9.1 쿠키 도메인 불일치 문제

교적부에서 `.yebom.org` 도메인으로 설정된 쿠키와, 신규 서비스에서 도메인 없이 설정된 쿠키가 공존하면 **로그인 루프**가 발생한다.

**방지법**: `COOKIE_DOMAIN` 환경변수를 반드시 Vercel에 설정하고, 코드에서 `process.env.COOKIE_DOMAIN`을 사용한다.

### 9.2 클라이언트 리다이렉트 금지

SessionProvider나 useEffect에서 `session === null → window.location.href = '/login'` 패턴을 **사용하지 마라**.
미들웨어가 이미 서버 사이드에서 인증 리다이렉트를 처리하므로, 클라이언트 리다이렉트는 타이밍 경합만 유발한다.

### 9.3 비밀번호 정책

- **8자 이상 + 숫자 포함** (2026-04 기준)
- 신규 서비스에서 비밀번호 입력 UI가 있다면 이 정책을 반영할 것

### 9.4 member_id=null 계정

super_admin(관리자 전용 계정)은 `member_id=null`이다. 세션의 `member_id`가 null일 수 있으므로, member_id를 필수값으로 가정하는 코드를 작성하지 마라.

---

## 10. 체크리스트

- [ ] `SESSION_SECRET` 환경변수 설정 (교적부와 동일 값)
- [ ] `COOKIE_DOMAIN` 환경변수 설정 (프로덕션: `.yebom.org`)
- [ ] `iron-session` 패키지 설치
- [ ] `lib/auth/session.ts` 생성
- [ ] `middleware.ts` 생성 (unsealData 유효성 검증 포함)
- [ ] `/api/auth/session` API 생성
- [ ] `/api/auth/logout` API 생성 (양쪽 도메인 쿠키 삭제)
- [ ] 교적부 `SERVICE_INFO`에 서비스코드 추가 요청
- [ ] Vercel에 커스텀 도메인 연결
- [ ] DNS CNAME 레코드 추가
- [ ] 클라이언트에서 세션 null → 로그인 리다이렉트 코드 **없는지** 확인
