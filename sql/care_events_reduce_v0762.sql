-- 케어 이벤트 필드 축소 마이그레이션 (v0.7.62)
-- 대상: 이전(hospital·cost·reason 포함) care_events 테이블을 이미 생성한 경우만.
-- 신규 설치(테이블 아직 없음)는 이 파일 대신 sql/care_events_v0760.sql을 실행하세요.
--
-- ⚠ 실행 전 반드시 care_events CSV 백업 (Supabase Table Editor → Export).
-- ⚠ hospital·cost 데이터는 영구 삭제됩니다. reason 값은 symptom으로 보존됩니다.

-- 1) dry-run 검증 — 현재 컬럼/행 확인 (먼저 이것만 실행해 상태 확인)
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='care_events' order by ordinal_position;
--   select count(*) as rows,
--          count(hospital) as has_hospital, count(cost) as has_cost, count(reason) as has_reason
--     from public.care_events;

-- 2) 실행 (백업·검증 후)
begin;
  -- reason → symptom 리네임 (값 보존). 이미 symptom이면 skip되도록 조건 처리
  do $$
  begin
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='care_events' and column_name='reason')
       and not exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='care_events' and column_name='symptom') then
      alter table public.care_events rename column reason to symptom;
    end if;
  end $$;

  alter table public.care_events drop column if exists hospital;
  alter table public.care_events drop column if exists cost;
commit;

-- 3) 사후 검증
--   select id, type, start_date, end_date, symptom from public.care_events order by start_date desc;
