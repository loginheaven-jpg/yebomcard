-- 성경 질문 — 함께보기(응답 공유) (2026-09-21 지휘부)
--
-- 앱은 한 번만 답한다. 그래서 같은 절을 두고 비슷한 궁금증이 생긴 교인은 각자 새로 물어야 했고,
-- 그때마다 게이트웨이 호출이 한 번씩 더 나갔다. 저장한 질문을 **이름 없이** 서로 보이게 하면
-- 중복 질문이 줄고, 한 절에 쌓인 질문이 그 절의 주석이 된다.
--
-- 정한 것(지휘부 2026-09-21)
--  * 저장할 때 '비공개' 체크박스. **기본은 공개**(체크 안 함) — 개인 신앙상담이 아니라
--    성경 구절 자체에 대한 질문이므로 공유 가치가 보안 가치보다 높다.
--  * **저장한 사람이 누구인지는 안 보인다.** 이름도 user_id 도 화면에 내려보내지 않는다.
--  * **로그인한 교인만 본다.** 비로그인·검색엔진에는 내려보내지 않는다.
--  * 위기·거절 건은 **공유하지 않는다**(화면에 저장 단추가 없고, 서버가 한 번 더 막는다).
--  * 수퍼어드민은 부적절한 것을 **내릴 수 있다**(행은 남는다 — 기록은 §B-10 대로 무기한).
--
-- 멱등 — 여러 번 실행해도 안전하다.

-- 함께보기로 내놓았는가. `saved` 와 따로 둔다:
--   saved  = '내 절에 둔다'(본인 화면)
--   shared = '남에게 보인다'(함께보기)
-- 저장을 내리면 공유도 함께 내려간다(앱이 그렇게 쓴다) — 내가 버린 것이 남에게 남아 있으면 안 된다.
alter table public.ai_questions add column if not exists shared boolean not null default false;
alter table public.ai_questions add column if not exists shared_at timestamptz;

-- 수퍼어드민이 목록에서 내린 것(부적절·오답). 행은 지우지 않는다.
alter table public.ai_questions add column if not exists share_hidden_at timestamptz;
alter table public.ai_questions add column if not exists share_hidden_by text;

-- 함께보기 목록 조회 — 한 장을 열 때마다 도는 길이라 선두가 book_code·chapter 여야 한다.
create index if not exists ai_questions_shared_idx
  on public.ai_questions (book_code, chapter, shared, share_hidden_at);

-- '나의 질문' 화면 — 내가 한 모든 질문을 최근 것부터.
create index if not exists ai_questions_mine_idx
  on public.ai_questions (user_id, asked_at desc);
