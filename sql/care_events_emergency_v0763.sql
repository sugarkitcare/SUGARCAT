-- 케어 이벤트 응급 태그 추가 (v0.7.63) — 스펙 ③ 개정2
-- care_events 테이블·RLS는 이미 프로덕션 생성·검증됨 → 이 파일은 ADD COLUMN만. 재생성 금지.
-- 실행 전 care_events CSV 백업 권장 (Supabase Table Editor → Export).
--
-- 배경: type 통원/입원/응급(3택) → 통원/입원(2택) + is_emergency(별개 응급 태그).
--   입원중 모드·음영·자동연결은 type='입원'만 보므로 응급 분리에 영향 없음.

-- 1) dry-run — 현재 컬럼/응급행 상태 (먼저 이것만 실행해 확인)
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='care_events' order by ordinal_position;
--   select type, count(*) from public.care_events group by type;

-- 2) 실행 (백업·확인 후)
begin;
  alter table public.care_events
    add column if not exists is_emergency boolean not null default false;

  -- 기존 type='응급' 행 소급 전환: 기간(end≠start)이면 입원, 아니면 통원. 모두 is_emergency=true.
  update public.care_events
     set is_emergency = true,
         type = case when end_date is not null and end_date <> start_date then '입원' else '통원' end
   where type = '응급';
commit;

-- 3) 사후 검증
--   select type, is_emergency, count(*) from public.care_events group by type, is_emergency;
