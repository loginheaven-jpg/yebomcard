-- ============================================================
-- 성경 음원(장 단위) 매핑 테이블 — bible_audio
-- 대한성서공회 음원을 Supabase Storage(bible-audio 버킷)에
-- 재호스팅하고 (version, book_code, chapter) → audio_url 매핑.
--
-- 사전 작업:
--   1) Supabase 대시보드 → Storage → 'bible-audio' 버킷 생성, Public 체크
--   2) 본 SQL 실행 (Supabase SQL Editor 또는 apply_migration)
--   3) 로컬에서 download-audio.mjs 실행하여 음원 적재
-- ============================================================

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS bible_audio (
    id           SERIAL PRIMARY KEY,
    version      VARCHAR(16) NOT NULL,        -- 'nkrv' | 'rnksv'
    book_code    VARCHAR(8)  NOT NULL,        -- 'gen' ~ 'rev' (bible_verses 와 동일 코드)
    chapter      SMALLINT    NOT NULL,
    audio_url    TEXT        NOT NULL,        -- Supabase Storage public URL
    duration_ms  INTEGER,                     -- (선택) 재생 길이 ms — 미니 플레이어 ETA 계산용
    file_bytes   INTEGER,                     -- (선택) 파일 크기 — 무결성 검증용
    narrator     VARCHAR(64),                 -- 성우 식별자 (예: "대한성서공회 GAE m")
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (version, book_code, chapter)
);

-- 2. 조회 인덱스 — 재생 시 (version, book_code, chapter) 단일 lookup
CREATE INDEX IF NOT EXISTS idx_bible_audio_lookup
    ON bible_audio (version, book_code, chapter);

-- 3. RLS — 공개 읽기, 변경은 service_role 만
ALTER TABLE bible_audio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bible_audio_public_read" ON bible_audio;
CREATE POLICY "bible_audio_public_read" ON bible_audio
    FOR SELECT TO public USING (true);

-- INSERT/UPDATE/DELETE 정책 미부여 → service_role 키로만 변경 가능
-- (download-audio.mjs 가 SUPABASE_SERVICE_ROLE_KEY 사용)
