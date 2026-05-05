# 예봄성경 SSO 보완 작업 가이드

> **작성일**: 2026-04-06
> **대상**: 예봄성경 개발 세션
> **전제**: AUTH_INTEGRATION_GUIDE.md의 가이드를 기반으로 SSO가 75% 구현된 상태

---

## 현재 상태

### 구현 완료 (변경 불필요)

| 파일 | 상태 |
|------|------|
| `lib/auth/session.ts` | ✅ 세션 설정 완료 (cookieName, COOKIE_DOMAIN 환경변수 사용) |
| `app/api/auth/session/route.ts` | ✅ 세션 조회 API |
| `app/api/auth/logout/route.ts` | ✅ 로그아웃 (양쪽 도메인 쿠키 삭제) |
| `hooks/useSession.ts` | ✅ 클라이언트 훅 (requireAuth 포함) |
| 교적부 SERVICE_INFO | ✅ `bible` 코드 추가 완료 (커밋 `9d371bb`) |
| Vercel 환경변수 | ✅ SESSION_SECRET, COOKIE_DOMAIN 설정 완료 |

### 보완 필요 (3가지)

---

## 보완 1: middleware.ts 생성

**파일**: `middleware.ts` (프로젝트 루트)

예봄성경은 **기능별 로그인** 구조이므로, 미들웨어에서 페이지를 차단하면 안 된다.
AUTH_INTEGRATION_GUIDE.md **섹션 5.2.1 "기능별 로그인 미들웨어 (비차단형)"** 코드를 그대로 사용한다.

**역할**: 유효하지 않은 SSO 쿠키만 정리 (만료/손상 쿠키 삭제)
**하지 않는 것**: 비로그인 사용자를 로그인 페이지로 리다이렉트

로그인 필요 시점은 기존 `useSession().requireAuth()`가 처리하므로 컴포넌트 코드 변경 불필요.

---

## 보완 2: session.ts dev 기본값 제거

**파일**: `lib/auth/session.ts` 라인 4

```typescript
// 현재
password: process.env.SESSION_SECRET || "dev-secret-must-be-32-chars-long!!",

// 변경
password: process.env.SESSION_SECRET!,
```

**이유**: dev 기본값이 있으면 환경변수 미설정을 놓칠 수 있다. 빌드 시 에러로 조기 발견하는 것이 안전하다.

---

## 보완 3: .env.local에 SSO 환경변수 추가 (로컬 개발용)

Vercel에는 이미 설정되어 있으나, 로컬에서 SSO를 테스트하려면 `.env.local`에도 추가 필요.
단, 로컬(localhost)에서는 `.yebom.org` 쿠키를 받을 수 없으므로 SSO 자체는 작동하지 않는다.
로컬에서는 `requireAuth()`가 교적부로 리다이렉트하지만 돌아올 수 없다.

```env
# .env.local에 추가
SESSION_SECRET=LLLjLbleMRXZcaSCAAp+xi9CD/3TSlEGfgJ0Rv29TWo=
# COOKIE_DOMAIN은 로컬에서 설정하지 않음 (프로덕션 Vercel에만)
```

---

## card vs bible 혼선 — 확인 완료

| 용도 | 값 | 위치 | 혼선? |
|------|-----|------|-------|
| SSO 서비스코드 | `bible` | useSession.ts, 교적부 SERVICE_INFO | ❌ 정상 |
| SSO 리다이렉트 URL | `bible.yebom.org` | 교적부 SERVICE_INFO | ❌ 정상 |
| AI Gateway 호출자 | `yebom-card` | aiGateway.ts, API routes | ❌ 무관 (SSO 아님) |
| Unsplash UTM | `yebom_card` | unsplash/route.ts | ❌ 무관 (SSO 아님) |

`card`는 프로젝트 내부 식별자, `bible`은 SSO 서비스코드 — 역할이 다르므로 혼선 아님.

---

## 검증 방법

1. `npx next build` → 빌드 에러 없음 확인
2. Vercel 배포 후 `bible.yebom.org` 접속 → 비로그인으로 검색 가능 확인
3. 카드 생성 클릭 → `saint.yebom.org/login?from=bible`로 리다이렉트 확인
4. 로그인 화면에 "예봄성경을 이용하려면 로그인이 필요합니다" 표시 확인
5. 로그인 후 `bible.yebom.org`로 돌아옴 → 카드 생성 정상 확인
6. 로그아웃 → 검색은 여전히 가능, 카드 생성은 다시 로그인 요구 확인
