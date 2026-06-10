# AI Gateway 작업요청 — 이미지 편집 엔드포인트 추가

> **요청자**: 예봄성경 (bible.yebom.org)
> **요청일**: 2026-04-13
> **우선순위**: 높음 — 예봄성경 카드 만들기 기능에서 대기 중

---

## 요청 요약

사용자가 업로드한 사진에서 **글자/워터마크를 제거**하고 깨끗한 이미지를 반환하는 엔드포인트가 필요합니다.

기존 `/api/ai/image`는 텍스트 프롬프트 → 새 이미지 생성만 지원하므로,
**기존 이미지를 입력받아 편집된 이미지를 반환**하는 새 엔드포인트를 요청합니다.

---

## API 사양

### 엔드포인트

```
POST {AI_GATEWAY_URL}/api/ai/image/edit
Content-Type: application/json
```

### Request

기존 `/api/ai/image`와 동일한 패턴을 따릅니다.

```json
{
  "image": "iVBORw0KGgoAAAA...",
  "media_type": "image/jpeg",
  "edit_type": "remove_text",
  "caller": "yebom-card:upload"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `image` | string | O | 원본 이미지 base64 (기존 Vision API와 동일 형식) |
| `media_type` | string | O | `image/jpeg` 또는 `image/png` |
| `edit_type` | string | O | `remove_text` (향후 다른 편집 유형 확장 가능) |
| `provider` | string | X | 미지정 시 Gateway 기본값 |
| `caller` | string | X | 호출자 식별 (사용량 추적) |

### Response

기존 `/api/ai/image` 응답과 **동일한 형식**입니다.

```json
{
  "data": "iVBORw0KGgoAAAA...",
  "media_type": "image/png",
  "provider": "imagen",
  "model": "imagen-3",
  "elapsed_ms": 4200
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `data` | string | **편집된 이미지** base64 |
| `media_type` | string | 이미지 MIME 타입 |
| `provider` | string | 사용된 엔진 |
| `model` | string | 사용된 모델 |
| `elapsed_ms` | number | 처리 시간 |

### 에러 응답

기존 Gateway 에러 패턴과 동일:

```json
{ "detail": "Image edit failed: ..." }
```

글자가 없는 이미지가 입력되면 **원본을 그대로 반환** (에러 아님).

---

## 사용 시나리오

```
[사용자가 간판이 있는 풍경 사진 업로드]
    ↓
[예봄성경 → POST /api/ai/image/edit { image, edit_type: "remove_text" }]
    ↓
[Gateway → 글자 영역 탐지 → 주변 배경으로 채움 → 편집된 이미지 반환]
    ↓
[예봄성경 → 깨끗한 사진 위에 성경 말씀 배치 → 카드 생성]
```

---

## 구현 참고

Gateway 내부 구현은 자유이며, 아래는 참고용입니다.

### 방법 A: 2단계 (탐지 + 인페인팅)

1. **텍스트 탐지**: Gemini Vision / Google Cloud Vision OCR → bounding box 추출 → 마스크 생성
2. **인페인팅**: Imagen 3 `editImage` / DALL-E 2 edit / Stable Diffusion Inpainting → 마스크 영역 복원

### 방법 B: 단일 모델

Imagen 3의 editImage에 프롬프트만으로 처리:
```
prompt: "Remove all visible text, watermarks, signs and writing from this image. 
         Fill removed areas seamlessly with surrounding background."
```

### 방법 C: 전용 모델

LaMa (Large Mask Inpainting) — 텍스트 제거에 특화된 오픈소스 모델. Replicate 등에서 호스팅 가능.

---

## 예봄성경 측 준비 상태

- [x] 사용자 사진 업로드 UI 구현 완료
- [x] "글자지움 | 그냥" 토글 UI 자리 확보
- [x] `callImageEdit()` 클라이언트 코드 준비 (Gateway 응답 형식이 `/api/ai/image`과 동일하면 즉시 연동)
- [ ] **Gateway에 `/api/ai/image/edit` 추가 대기 중**

엔드포인트가 추가되면 예봄성경 측 연동은 **1시간 이내** 완료 가능합니다.

---

## 비용 예상

- 예상 사용량: 10~30건/일
- 건당 비용: ~$0.04 (Imagen 3 기준)
- 일 비용: $0.40~$1.20
- 사용자별 사진이 모두 다르므로 캐싱 효과 없음
