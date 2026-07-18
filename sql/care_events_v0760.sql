-- 케어 이벤트 테이블 — 스펙 ③ (v0.7.60, v0.7.62에서 필드 축소: hospital·cost 미수집, reason→symptom)
-- 실행 위치: Supabase Dashboard → SQL Editor. RLS로 본인 행만 접근.
-- ⚠ 이미 이전(hospital·cost 포함) 버전을 실행했다면 이 파일 대신
--    sql/care_events_reduce_v0762.sql(ALTER)를 실행하세요.
--
-- 프라이버시: 병원명·비용은 수집하지 않음. 남는 증상·처치·진단도 민감 건강정보이므로
--   개인정보처리방침 저장 항목에 반영 필요. RLS로 사용자별 격리(운영자 수집·분석 없음).

create table if not exists public.care_events (
  id          uuid primary key default gen_random_uuid(),
  cat_id      uuid not null references public.cats(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null default '통원',        -- '통원' | '입원' | '응급'
  start_date  date not null,                        -- 입원일 / 방문일
  end_date    date,                                 -- 퇴원일 (통원=start와 동일, 입원중=null)
  symptom     text,                                 -- 증상 / 주호소
  diagnosis   text,                                 -- 진단(선택)
  treatment   text,                                 -- 처치 방향·내역
  procedures  jsonb default '[]'::jsonb,            -- [{date,name,note}] 주사·시술 이벤트(Phase 3 조혈 오버레이용)
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists care_events_cat_start_idx on public.care_events (cat_id, start_date desc);
create index if not exists care_events_user_idx       on public.care_events (user_id);

alter table public.care_events enable row level security;

drop policy if exists care_events_select on public.care_events;
create policy care_events_select on public.care_events
  for select using (auth.uid() = user_id);

drop policy if exists care_events_insert on public.care_events;
create policy care_events_insert on public.care_events
  for insert with check (auth.uid() = user_id);

drop policy if exists care_events_update on public.care_events;
create policy care_events_update on public.care_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists care_events_delete on public.care_events;
create policy care_events_delete on public.care_events
  for delete using (auth.uid() = user_id);

create or replace function public.touch_care_events_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists care_events_touch on public.care_events;
create trigger care_events_touch before update on public.care_events
  for each row execute function public.touch_care_events_updated_at();

-- 검증:
-- select id, type, start_date, end_date, symptom from public.care_events order by start_date desc;
