# 예봄성경 — 보류·차기 검토 사항

> 흩어진 .md 대신 보류·연기·차기 검토 항목을 한 곳에 누적 기록.
> 최신 항목이 위쪽. 완료/취소된 항목은 ~~취소선~~ 후 일정 기간 보관 후 정리.

---

## WEB 역본 후속 — 음원 통합 + 부가 정합 (대기, 2026-06-10)

WEB(World English Bible) 31,098절 적재 완료(또는 적재 진행 중). 후속 정합 항목들.

### A. WEB 음원 통합 (대기 — 음원 미확보)

**현재 상태**: 사용자가 WEB 음원을 확보하는 대로 장 단위 음원(현 통독성경/개역개정 패턴) 으로 통합 예정.

**도입 트리거**: 음원 파일 확보 + Supabase Storage 적재 가능 상태

**작업 내용**:
1. `bible-audio` Storage 버킷에 `web/<book_code>/<NNN>.mp3` 업로드 (upload-bible-audio.mjs 재사용, `--version web` 지정)
2. `bible_audio` 테이블에 (version='web', book_code, chapter, audio_url) 매핑 적재
3. 코드 변경 0줄 — `TtsContext.transformWithChapterAudio` 가 이미 version 무관하게 동작 (lookupChapterAudio 가 매핑 있으면 mp3 우선)
4. 미니플레이어 "녹음" 배지 자동 적용

**예상 작업량** 음원 확보 후 ~30분 (시편 시범 → 전체 batch)

### B. 영문 TTS voice 분기 (보류 — 우선순위 낮음)

현재 KJV/NIrV/GNT/WEB 모두 ko-KR Chirp3-HD voice 로 영문 합성 → 발음 어색.

**도입 트리거**: 영문 본문 청취 사용자 비율 측정 후 결정. WEB 음원 적재 완료 시 자동 우회되므로 우선순위 낮음.

**옵션**:
- `/api/tts/route.ts` 에 voice 분기 추가: ENGLISH_VERSIONS 인 경우 en-US-... voice 사용
- 또는 영문 mainVersion 시 TTS 버튼 비활성

**예상 작업량** ~2시간

### C. 시편 표제(superscription) 절 매칭 보정 (보류)

**문제**: WEB(Classic)은 히브리어 전통에 따라 시편 표제를 1절로 셈. KJV/nkrv는 표제를 절로 안 셈. 병기 모드에서 시 51:1 같은 절이 한국어(기도) vs WEB(표제) 어긋남.

**도입 트리거**: 사용자 피드백 누적 후 결정. 영향 절 ~116편의 1절 위주.

**옵션**:
- A. 표제 자동 매칭 보정 (UI 측 verse offset)
- B. WEBU 에디션(표제 미카운트) 으로 재적재
- C. 그대로 유지 (학계 표준)

**예상 작업량** ~3시간 (옵션 A) / 데이터 재적재 (옵션 B)

### D. AI 추천 — WEB 호환 (보류)

`/api/ai/recommend` 가 책명 한글 매칭(`book_name='시편'`) 기준. mainVersion=web 일 때 영문 book_name(`Psalms`) 와 어긋남 → 검색 0건.

**해결**: 응답 매칭을 book_code 기준으로 변경 (모든 버전 자동 호환).

**예상 작업량** ~30분

### E. KJV 데살로니가전·후 보충 (별건, 보류)

KJV 64권/66권 적재 — `1th`/`2th` 약 135절 누락. WEB 적재 후 병기 모드에서 KJV 측 빈칸 노출.

**해결**: KJV 원본에서 데살로니가전·후 본문 추출 후 별도 import

**예상 작업량** ~30분

### F. WEBU 에디션 (LORD 표기) 재수급 (보류, 선택)

현재 WEB Classic(Yahweh 표기). 일부 사용자는 영어 전통 LORD 표기 선호.

**도입 트리거**: 사용자 명시 요청 시. WEBU 에디션 별도 확보 + DELETE WHERE version='web' + 재import.

---

## 음원 호스팅 이전 — Supabase → Cloudflare R2 (보류, 트래픽 임계 도달 시)

**현재 상태**
음원은 Supabase Storage `bible-audio` 버킷에 호스팅. 시편 150편(414MB) 적재 완료. 전체 성경(통독 구약 + 신약 추정) ≈ 6.5GB 예상.

**비교**

| 항목 | Supabase Storage | Cloudflare R2 |
|---|---|---|
| Free tier 용량 | 1GB | 10GB |
| Free tier egress | 월 2GB | **무제한** |
| 추가 용량 | $0.021/GB/월 | $0.015/GB/월 |
| 추가 egress | $0.09/GB | **$0/GB** (Cloudflare 정책: egress 무료) |
| CDN | Smart CDN (region-based) | 전 세계 Cloudflare edge |
| 인증 | RLS + signed URL | Public bucket 또는 signed URL |
| 통합도 | yebomcard 가 이미 Supabase 사용 | 별도 설정 필요 |

**시나리오별 월 비용 추산** (전체 성경 6.5GB 적재 가정, 사용자 1인당 월 30장 ≈ 120MB 청취)

| 사용자 수 | 월 egress | Supabase 비용 | R2 비용 |
|---|---|---|---|
| 10 | 1.2GB | $0 (free) | $0 |
| 100 | 12GB | $0.9 | $0 |
| 500 | 60GB | $5.2 | $0 |
| 1000 | 120GB | $10.6 | $0 |

스토리지 자체 비용(6.5GB)은 양쪽 다 free tier 내. **차이는 egress 에서 발생**.

**왜 보류했나**
- 현재 사용자 규모(개인/소그룹)에서 비용 차이 미미 (월 $1 이내)
- Supabase 통합도 유지가 운영 단순함
- R2 이전 시 추가 작업: AWS S3 호환 SDK 설치, R2 access key 발급, custom domain 또는 public URL 패턴 변경, bible_audio.audio_url 일괄 업데이트

**도입 트리거**
- 활성 사용자 100명 초과 또는 월 egress 50GB 초과
- 또는 Supabase 월 청구액에 Storage 항목이 $5 초과로 잡힐 때

**이전 작업량** ~2시간
1. R2 계정 + 버킷 생성, custom domain 설정 (예: `audio.yebom.org`)
2. `upload-bible-audio.mjs` 의 Supabase Storage 업로드 부분만 R2 S3 호환 SDK 호출로 교체 (10-20줄)
3. 새 URL 형식으로 bible_audio.audio_url 일괄 UPDATE (단일 SQL)
4. 기존 Supabase Storage 음원은 정합 확인 후 정리

---

## TTS 음질 추가 개선 — ElevenLabs 통합 (보류, 2026-06-01)

**현재 상태**
GCP Chirp 3 HD voice(Aoede/Charon) + Neural2 폴백으로 사용자 청취 만족 확인 (2026-06-01). 본 항목은 향후 만족도 저하 시 활성화.

**도입 트리거**
- 사용자가 "Chirp 도 부자연스럽다" 피드백을 명시적으로 줄 때
- 또는 새 voice 모델 출시 후 비교 필요 시점

**작업 내용**
- `/api/tts/route.ts` 에 `provider` 분기 추가 (`gcp` | `elevenlabs`)
- ElevenLabs Korean voice (Rachel/Bella multilingual v2) 통합
- API key 발급 후 `.env.local` + Vercel env 추가
- 미니 플레이어에 "고품질 음성" 토글 (운영비 통제용)
- IndexedDB 캐시 키에 provider 포함 → 엔진 전환 시 자동 분리 캐시

**비용**
- Starter $5/월 (30K자) — 한국어 60~70장 분량
- Creator $22/월 (100K자)
- 무료 tier 10K자/월
- pay-as-you-go: 1M자 $165 (Creator 가격)

**예상 작업량** ~3시간 (라우트 분기 1h + UI 토글 0.5h + 키 등록/배포 0.5h + 비교 검증 1h)

---

## Supabase 일괄 사전 캐싱 — bible_audio 인프라 재활용 (보류, 사용자 임계 도달 시)

**현재 상태**
인프라(bible_audio 테이블 + Storage 버킷 + download-audio.mjs)는 이미 구축됨 (bskorea 다운로드용으로 만들었으나 그 시도는 취소됨 — 아래 ~~취소 항목~~ 참고). 이 인프라를 GCP TTS 일괄 합성용으로 **재활용** 가능.

**왜 보류했나**
현재 IndexedDB 클라이언트 캐시로 충분 (개인/소그룹 무료 tier 안). 사용자 규모 확장 시점에만 효용.

**도입 트리거**
- 활성 사용자 100명 초과
- 또는 GCP Cloud TTS 월 청구액 $50 초과
- 또는 동일 본문을 여러 사용자가 자주 청취해서 first-fetch 비용이 누적될 때

**작업 내용**
1. `download-audio.mjs` 수정 — bskorea 다운로드 로직 제거하고 GCP Chirp 합성 호출 로직으로 교체
   - 입력: 절 별 텍스트 (또는 장 합본)
   - 출력: mp3 blob → Supabase Storage 적재 → bible_audio 매핑 INSERT
2. `lib/bibleAudio.ts` 신설 — `lookupChapterAudio(version, bookCode, chapter)` Supabase 조회 + 메모리 캐시
3. `contexts/TtsContext.tsx` 분기:
   - L1: bible_audio 매핑 hit → public URL 의 mp3 재생
   - L2: 매핑 miss → 기존 /api/tts (Chirp on-demand) 폴백
4. 미니 플레이어 엔진 배지 확장: `Real`(파랑, Supabase 적재) | Chirp | N2 | Web

**비용 추산**
- 일회성 합성: 1,189장 × 2 버전 × 2 voice = 4,756 트랙 × 500자 × 3bytes ≈ 7.1MB → $213 (무료 tier 차감 시 ~$200)
- 합성 후 운영비 0 (Supabase Storage free tier 1GB 안에 충분)
- voice/속도 추가 조합은 별도 합성 필요 → 1.0배속 + 여/남만 기본 적재 권장

**예상 작업량** ~3시간 (스크립트 변환 1.5h + bibleAudio.ts + Context 분기 1h + UI/검증 0.5h)

**보유 자산 (재활용 대상)**
- [bible_audio_create_table.sql](bible_audio_create_table.sql) — 테이블 스키마 + RLS (그대로 사용)
- [download-audio.mjs](download-audio.mjs) — 동시성·재시도·MP3 검증 패턴 (소스 부분만 GCP 합성으로 교체)

---

## TTS 절 단위 타임스탬프 — seek 정확도 향상 (보류, 우선순위 낮음)

**현재 상태**
미니 플레이어 진행바는 "절 N / 전체 M" 단위. 사용자가 화면 중간 절을 클릭해서 "이 절부터 듣기"는 가능하지만, 한 절 안에서 seek (예: 절 5의 중간으로 이동)은 불가.

**도입 트리거**
- 사용자가 "긴 절 중간으로 점프하고 싶다"는 피드백
- 또는 장 단위 음원(Supabase 캐시) 도입 후 절 동기화 정확도 필요할 때

**작업 내용**
- GCP Chirp 3 HD 의 timepoint 지원 확인 (SSML `<mark>` 또는 word-level boundary API)
- 또는 클라이언트 측 절 길이 추정 (텍스트 길이 비례) 후 진행바 분할
- 미니 플레이어에 절 간 ◀ ▶ 버튼 추가 (현재 절 다시 / 다음 절)

**예상 작업량** ~2시간 (조사 1h + 구현 1h)

---

## TTS 백그라운드 재생 keep-alive (보류, 2026-06-01)

**무엇이 보류되었나**
TTS 재생 중 모바일 화면 잠금 / 백그라운드 전환 시에도 오디오가 끊기지 않도록 유지하는 기능. prayer-house-v2의 `src/features/tts/lib/bg-audio.ts`(227줄, 7계층 방어 패턴)에 구현된 것과 동등 수준.

**왜 보류했나**
- 코드량이 크고 (227줄) OS·브라우저별 동작 편차가 커서 회귀 위험이 높음
- 현재 TTS 기능을 처음 도입하는 단계 — 사용자가 모바일 백그라운드 재생을 얼마나 요구할지 데이터 부족
- Phase 1+2의 핵심(절 단위 재생, 미니 플레이어, 자동 다음 장, 재개 위치)만으로도 데스크탑·모바일 포그라운드 사용엔 충분
- 메모리 룰 "빈도·심각도 낮은 이슈는 변경 자제" 정신 — 검증 후 도입

**도입 트리거 조건**
- 사용자가 "잠금 화면에서도 듣고 싶다"는 피드백을 명시적으로 줄 때
- 또는 TTS 일일 활성 사용자 비율이 일정 수준(예: 활성 사용자의 10%) 넘었을 때

**구현 시 7계층 방어 (prayer-house-v2 그대로 차용)**
1. 무음 WAV 앵커 — 5초 루프, ±3 micro-noise
2. Web Worker keep-alive — inline worker, 20초 간격 tick
3. Fallback Timer — Worker 실패 시 setInterval
4. Wake Lock API — `navigator.wakeLock.request('screen')`
5. Media Session — 시스템 컨트롤 메타데이터 (제목, 위치)
6. Visibility Listener — 포그라운드 복귀 시 resume
7. 20초 통합 핸들러 — anchor 재생 + Wake Lock 재획득 + position 업데이트

**참고**
- 원본: `C:\dev\yebom\prayer-house-v2\src\features\tts\lib\bg-audio.ts`
- 통합 지점: `hooks/useVerseTTS` 또는 `contexts/TtsContext` 의 play/pause/stop 라이프사이클
- 모바일 iOS Safari는 Wake Lock 미지원 — 무음 앵커만으로 부분 동작

**예상 작업량** ~3시간 (포팅 1h + yebom TTS 컨텍스트와 통합 1h + iOS/Android 실기 검증 1h)

---

## ~~성경 음원 다운로드 — 대한성서공회 bskorea (취소, 2026-06-01)~~

~~bskorea.or.kr 의 성경듣기 음원을 받아 Supabase Storage 에 재호스팅하려 했음.~~

**취소 이유**: bskorea 음원이 실제 성우 녹음이 아니라 **AI 합성 음성**으로 확인됨 (2026-06-01). GCP Chirp 와 본질적으로 같은 카테고리라 다운로드 가치 없음. 또한 실제 URL 이 CloudFront signed URL 패턴(3개월 만료)이라 정적 경로 가정도 어긋남.

**보존되는 자산** (다른 항목에서 재활용)
- `bible_audio_create_table.sql` — Supabase 사전 캐싱 (위 #2 항목) 에서 그대로 사용
- `download-audio.mjs` — 동시성·재시도·MP3 검증 패턴 추출용. 소스 부분만 GCP 합성 호출로 교체하면 #2 항목 스크립트로 변신

---
