# 예봄카드 — 로그인 & 회원관리 통합 가이드

> **작성일**: 2026-04-01
> **대상**: 예봄카드 개발자
> **전제**: 예봄서비스 통합 인증 체계 (교적부 중심 SSO)

---

## 1. 인증 아키텍처 개요

예봄서비스는 **교적부(saint.yebom.org)가 인증의 중심**이다.
모든 서비스는 교적부의 로그인/가입 페이지를 공유하며, SSO 쿠키로 인증 상태를 전파한다.

```
사용자 → 예봄카드 접속
  ↓
SSO 쿠키 확인 (saint_record_session)
  ├─ 있음 → 세션 복호화 → 로그인 완료
  └─ 없음 → saint.yebom.org/login?from=card 로 리다이렉트
              ↓
         이메일+비밀번호 또는 카카오 로그인
              ↓
         SSO 쿠키 발급 (.yebom.org 도메인)
              ↓
         예봄카드로 리다이렉트 → 쿠키 자동 인식
```

---

## 2. 예봄카드에서 구현할 것

### 2.1 구현 필요 (3가지만)

| # | 항목 | 설명 |
|---|------|------|
| 1 | **미들웨어** | SSO 쿠키 확인 → 없으면 교적부 로그인으로 리다이렉트 |
| 2 | **세션 API** | `/api/auth/session` — 쿠키 복호화 후 세션 정보 반환 |
| 3 | **로그아웃 API** | `/api/auth/logout` — 쿠키 삭제 |

### 2.2 구현 불필요 (교적부가 처리)

- ~~로그인 페이지~~ → 교적부 `/login?from=card`
- ~~회원가입 페이지~~ → 교적부 `/join?from=card`
- ~~카카오 OAuth~~ → 교적부에서 처리
- ~~비밀번호 찾기~~ → 교적부에서 처리
- ~~회원 DB 관리~~ → 교적부 `users` + `members` 테이블

---

## 3. 구현 코드

### 3.1 환경변수

```env
# .env.local에 추가
SESSION_SECRET=교적부와_동일한_32자_이상_시크릿
```

**중요**: `SESSION_SECRET`은 교적부/기도의집/재정부와 **반드시 동일**해야 한다.
이 값이 다르면 SSO 쿠키를 복호화할 수 없다.

### 3.2 필요 패키지

```bash
npm install iron-session
```

### 3.3 세션 설정 (`lib/auth/session.ts`)

```typescript
export const sessionOptions = {
  cookieName: 'saint_record_session',
  password: process.env.SESSION_SECRET!,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7일
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.yebom.org' : undefined,
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

### 3.4 미들웨어 (`middleware.ts`)

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const COOKIE_NAME = 'saint_record_session'

// 인증 불필요 경로
const publicPaths = ['/api/auth', '/api/bible']

export function middleware(request: NextRequest) {
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

  // SSO 쿠키 확인
  const sessionCookie = request.cookies.get(COOKIE_NAME)
  if (!sessionCookie) {
    // 교적부 통합 로그인으로 리다이렉트
    return NextResponse.redirect('https://saint.yebom.org/login?from=card')
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

### 3.5 세션 API (`app/api/auth/session/route.ts`)

```typescript
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { unsealData } from 'iron-session'
import { sessionOptions, SessionData } from '@/lib/auth/session'

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

### 3.6 로그아웃 API (`app/api/auth/logout/route.ts`)

```typescript
import { NextResponse } from 'next/server'
import { sessionOptions } from '@/lib/auth/session'

export async function POST() {
  const response = NextResponse.json({ success: true })
  const opts = sessionOptions.cookieOptions
  response.cookies.set(sessionOptions.cookieName, '', { ...opts, maxAge: 0 })
  return response
}
```

### 3.7 클라이언트 훅 (`hooks/use-session.ts`)

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
    window.location.href = 'https://saint.yebom.org/login?from=card'
  }

  return { session, loading, logout }
}
```

---

## 4. 교적부 연동 설정 (1회)

교적부 로그인 페이지의 `SERVICE_INFO`에 예봄카드를 추가해야 한다.

**교적부 `src/app/(auth)/login/page.tsx`에 추가**:
```typescript
const SERVICE_INFO = {
  prayer: { label: '기도의 집을 이용하려면', redirect: 'https://prayer.yebom.org' },
  radio: { label: '라디오를 이용하려면', redirect: 'https://radio-axi.pages.dev' },
  finance: { label: '재정부를 이용하려면', redirect: 'https://finance.yebom.org' },
  card: { label: '예봄카드를 이용하려면', redirect: 'https://card.yebom.org' }, // 추가
}
```

교적부 `/join` 페이지의 from 파라미터에도 `card` 추가.

---

## 5. 접근 권한

예봄카드는 **모든 가입 회원이 사용 가능**하다. 별도 권한 체크 불필요.

| 기능 | 권한 |
|------|------|
| 성경 검색 | 비로그인 허용 (public API) |
| 카드 생성 | 로그인 필수 |
| 카드 다운로드 | 로그인 필수 |
| AI 추천 | 로그인 필수 |

미들웨어에서 `/api/bible` 경로는 publicPaths에 포함하여 비로그인도 검색 가능하게 할 수 있다.

---

## 6. 도메인 설정

| 환경 | URL |
|------|-----|
| 로컬 개발 | `localhost:3000` (SSO 쿠키 도메인 무시, 개발 시 세션 직접 설정) |
| 프로덕션 | `card.yebom.org` (SSO 쿠키 `.yebom.org` 도메인으로 자동 공유) |

Vercel에서 커스텀 도메인 `card.yebom.org` 설정 후,
DNS에 CNAME 레코드 추가가 필요하다.

---

## 7. 체크리스트

- [ ] `SESSION_SECRET` 환경변수 설정 (교적부와 동일 값)
- [ ] `iron-session` 패키지 설치
- [ ] `lib/auth/session.ts` 생성
- [ ] `middleware.ts` 생성
- [ ] `/api/auth/session` API 생성
- [ ] `/api/auth/logout` API 생성
- [ ] 교적부 `SERVICE_INFO`에 `card` 추가 요청
- [ ] Vercel에 `card.yebom.org` 도메인 연결
- [ ] DNS CNAME 레코드 추가
