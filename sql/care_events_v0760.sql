-- 병원 카드(케어 이벤트) 테이블 — 스펙 ③ 1단계 (v0.7.60)
-- 실행 전: Supabase Table Editor에서 기존 테이블 CSV 백업(신규 테이블이라 기존 데이터 영향 없음).
-- 실행 위치: Supabase Dashboard → SQL Editor. RLS로 본인 행만 접근.

create table if not exists public.care_events (
  id          uuid primary key default gen_random_uuid(),
  cat_id      uuid not null references public.cats(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null default '통원',        -- '통원' | '입원' | '응급'
  hospital    text,                                 -- 병원명 (다중병원 구분 기준)
  start_date  date not null,                        -- 입원일 / 방문일
  end_date    date,                                 -- 퇴원일 (통원=start와 동일, 입원중=null)
  reason      text,                                 -- 사유 / 주호소
  diagnosis   text,                                 -- 진단(선택)
  treatment   text,                                 -- 처치 요약
  procedures  jsonb default '[]'::jsonb,            -- [{date,name,note}] 주사·시술 이벤트(선택)
  cost        numeric,                              -- 비용(선택)
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists care_events_cat_start_idx on public.care_events (cat_id, start_date desc);
create index if not exists care_events_user_idx       on public.care_events (user_id);

alter table public.care_events enable row level security;

-- 본인(user_id = auth.uid()) 행만 CRUD
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

-- updated_at 자동 갱신
create or replace function public.touch_care_events_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists care_events_touch on public.care_events;
create trigger care_events_touch before update on public.care_events
  for each row execute function public.touch_care_events_updated_at();

-- 검증:
-- select id, type, hospital, start_date, end_date from public.care_events order by start_date desc;
