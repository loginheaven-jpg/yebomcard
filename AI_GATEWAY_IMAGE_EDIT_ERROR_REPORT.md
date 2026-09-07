# AI Gateway 장애 리포트 — 이미지 편집(`/api/ai/image/edit`) 전면 불가

> 작성일: 2026-09-07 · 작성: 예봄성경(yebomcard) 클라이언트 측 · 수신: AI Gateway 개발팀
> 대상 서비스: `https://ai-gateway20251125.up.railway.app` (`POST /api/ai/image/edit`)
> 심각도: **Critical** — 편집 provider **2종 전부** 실패 → 기능 100% 불가(폴백 없음)

---

## 0. TL;DR

`/api/ai/image/edit` 가 지원하는 provider는 `imagen`·`dall-e` **둘뿐인데 현재 둘 다 실패**합니다.
게이트웨이는 편집 경로에 **provider 폴백이 없어**, 어느 쪽을 지정해도 그대로 500 이 반환됩니다.

| # | provider | HTTP | 원인 | 성격 |
|---|---|---|---|---|
| 1 | **`dall-e`** *(게이트웨이 기본값)* | 500 ← OpenAI 400 | 요청에 **폐기된 `response_format` 파라미터**를 계속 전송 | **게이트웨이 코드 버그 — 즉시 수정 가능** |
| 2 | **`imagen`** | 500 ← Vertex 404 | `imagen-3.0-capability-001` 모델에 프로젝트 접근 권한 없음 | GCP 모델 접근 권한 문제 |

→ **1번(`response_format` 제거)만 고치면 기능이 즉시 복구**됩니다. 가장 빠른 복구 경로입니다.

---

## 1. 영향

- 예봄성경 성경카드 **`내사진 > 글자 지우고 사용`** 기능 전면 불가.
- 사용자 화면에 원문 에러가 그대로 노출됨(아래 5장 스크린샷 대응 문구).
- 클라이언트(`app/api/upload/clean/route.ts`)는 `provider: "imagen"` 고정 호출 → 2번 경로로 실패.

---

## 2. 재현 (클라이언트 직접 probe · 2026-09-07)

글자가 포함된 640x360 PNG 1장을 `edit_type: "remove_text"` 로 전송.

### 2-1. `provider: "imagen"` → 500
```
{"detail":"Image edit failed: Imagen inpainting failed: 404 NOT_FOUND.
{'error': {'code': 404, 'message': 'Publisher model
`projects/yebom-1e875/locations/us-central1/publishers/google/models/imagen-3.0-capability-001`
was not found or your project does not have access to it. ...', 'status': 'NOT_FOUND'}}"}
```

### 2-2. `provider: "dall-e"` → 500
```
{"detail":"Image edit failed: DALL-E inpainting failed: Error code: 400 -
{'error': {'message': \"Unknown parameter: 'response_format'.\",
           'type': 'invalid_request_error', 'param': 'response_format',
           'code': 'unknown_parameter'}}","code":"EDIT_ERROR"}
```

### 2-3. 지원 provider 확인 — 제3의 대안 없음
`GET /api/ai/image/edit/providers`
```json
{"providers":[{"id":"imagen",...},{"id":"dall-e",...}],"default":"dall-e"}
```

---

## 3. 원인 분석

### 3-1. `dall-e` — 폐기된 `response_format` 전송 (게이트웨이 코드 버그)
OpenAI 이미지 편집(`images/edits`)은 **`response_format` 파라미터를 더 이상 받지 않습니다**
(응답은 기본적으로 base64 로 반환). 게이트웨이가 이 파라미터를 계속 보내 **400 unknown_parameter** 로 거절됩니다.

- **조치**: 편집 호출에서 `response_format` 인자 **제거**. 응답 파싱은 기존 b64 경로 그대로 사용.
- 이 provider가 **게이트웨이의 편집 기본값**이므로, 수정 시 기본 경로가 곧바로 살아납니다.

### 3-2. `imagen` — 편집 전용 모델 접근 권한 없음
`imagen-3.0-capability-001`(마스크 기반 inpainting 전용 모델)에 대해
프로젝트 `yebom-1e875` / `us-central1` 이 **404 NOT_FOUND** 를 반환합니다.

중요 단서 — **자격증명·리전 문제가 아닙니다**:
`GET /api/ai/image/providers` 기준 이미지 *생성*용 `imagen-3.0-generate-002` 는
`enabled: true, has_api_key: true, is_default: true` 로 정상 동작 중입니다.
즉 같은 프로젝트에서 **생성 모델은 되고 편집(capability) 모델만 접근 불가** 상태입니다.

- **조치**: Vertex AI 콘솔에서 해당 편집 모델 **접근 권한(허용 목록) 신청**,
  또는 현재 사용 가능한 편집 지원 모델/리전으로 교체.

### 3-3. 편집 경로에 provider 폴백 부재 (구조적)
`/api/ai/chat` 는 provider 폴백 체인이 있으나, `/api/ai/image/edit` 는 없습니다.
그래서 한쪽만 죽어도 전면 장애가 됩니다.

- **권고**: 편집에도 `imagen ↔ dall-e` 상호 폴백 적용. 둘 중 하나만 살아 있어도 서비스 지속.

---

## 4. 권고 (우선순위)

| 우선 | 조치 | 대상 | 기대 효과 |
|---|---|---|---|
| **P0** | DALL-E 호출에서 `response_format` 제거 | 게이트웨이 코드 | **기능 즉시 복구** |
| P1 | 편집 경로 `imagen ↔ dall-e` 폴백 추가 | 게이트웨이 코드 | 단일 provider 장애 내성 |
| P2 | Vertex `imagen-3.0-capability-001` 접근 권한 확보(또는 대체 모델) | GCP 프로젝트 | 고품질·원본크기 편집 복원 |
| P3 | 편집 실패 시 `code`/`provider` 필드를 일관되게 반환 | 게이트웨이 코드 | 클라이언트 폴백 판단 용이 |

---

## 5. 클라이언트 측 대응 (예봄성경)

- 현재 `app/api/upload/clean/route.ts` 는 `IMAGE_EDIT_PROVIDER || "imagen"` 로 **imagen 고정**.
  (과거 DALL-E 400 이슈로 imagen 강제한 이력 — 지금은 그 imagen도 죽은 상태)
- 게이트웨이 P0 수정 후에는 `IMAGE_EDIT_PROVIDER=dall-e` 로 환경변수만 바꾸면 즉시 사용 가능.
- 사용자 안내: 복구 전까지는 카드 만들기에서 **`그냥`(원본 사용)** 옵션으로 우회.
