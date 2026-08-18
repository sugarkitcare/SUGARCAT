-- ============================================================
-- 고양이 중복 행 정리 + 재발 방지 유니크 제약 (v0.7.91 P1)
--
-- 원인: 클라이언트 레이스(saveS→saveToDB와 명시적 upsertCatToDB가 ms 차 동시 실행)로
--       같은 (user_id, name) 고양이가 2행 insert됨. 클라이언트는 v0.7.91에서
--       단일 비행 가드 + 23505 복구로 수정. 이 SQL은 기존 중복 정리 + DB 차원 재발 방지.
--
-- ⚠ 실행 전 반드시 백업 (Supabase Dashboard → Database → Backups 또는 pg_dump)
-- ⚠ 단계별로 나눠 실행하고, 각 단계의 결과 행 수를 확인할 것
-- 정리 원칙: 자식 기록(daily_records+blood_tests+care_events+cgm_daily) 많은 행 유지,
--            동수면 created_at 빠른 행 유지. 자식 행은 키 충돌 없는 것만 keeper로 이관,
--            (cat_id,날짜) 충돌 행은 keeper 것을 남기고 loser 것은 CASCADE로 삭제됨.
-- ============================================================

-- ── 0) 현황 확인 (읽기 전용) — 중복 그룹과 각 행의 자식 수 ──
select c.user_id, c.name, c.id, c.created_at,
  (select count(*) from daily_records d where d.cat_id=c.id) as daily,
  (select count(*) from blood_tests b where b.cat_id=c.id) as bt,
  (select count(*) from care_events e where e.cat_id=c.id) as care,
  (select count(*) from cgm_daily g where g.cat_id=c.id) as cgm
from cats c
where (c.user_id, c.name) in (
  select user_id, name from cats group by user_id, name having count(*)>1
)
order by c.user_id, c.name, c.created_at;

-- 참고: 앞뒤 공백만 다른 이름 변형(자동 정리 대상 아님 — user_settings 키가 이름 기반이라 수동 판단)
select user_id, name, length(name) as len from cats
where (user_id, trim(name)) in (
  select user_id, trim(name) from cats group by user_id, trim(name) having count(*)>1
) and (user_id, name) not in (
  select user_id, name from cats group by user_id, name having count(*)>1
)
order by user_id;

-- ── 1) 정리 실행 (트랜잭션) ──
begin;

-- keeper/loser 매핑
create temp table _dup_map on commit drop as
with child_counts as (
  select c.id,
    (select count(*) from daily_records d where d.cat_id=c.id)
    + (select count(*) from blood_tests b where b.cat_id=c.id)
    + (select count(*) from care_events e where e.cat_id=c.id)
    + (select count(*) from cgm_daily g where g.cat_id=c.id) as n_child
  from cats c
),
ranked as (
  select c.id, c.user_id, c.name, cc.n_child, c.created_at,
    row_number() over (partition by c.user_id, c.name
                       order by cc.n_child desc, c.created_at asc, c.id) as rn,
    count(*) over (partition by c.user_id, c.name) as grp_n
  from cats c join child_counts cc on cc.id = c.id
)
select l.id as loser_id, k.id as keeper_id, l.user_id, l.name,
       l.n_child as loser_children, k.n_child as keeper_children
from ranked l
join ranked k on k.user_id = l.user_id and k.name = l.name and k.rn = 1
where l.grp_n > 1 and l.rn > 1;

-- 매핑 확인 (loser_children이 0인 행이 대부분이어야 정상)
select * from _dup_map order by user_id, name;

-- 자식 이관 ①: daily_records — (cat_id, record_date) 충돌 없는 행만
update daily_records d set cat_id = m.keeper_id
from _dup_map m
where d.cat_id = m.loser_id
  and not exists (select 1 from daily_records k
                  where k.cat_id = m.keeper_id and k.record_date = d.record_date);

-- 자식 이관 ②: blood_tests — (cat_id, test_date) 충돌 없는 행만
update blood_tests b set cat_id = m.keeper_id
from _dup_map m
where b.cat_id = m.loser_id
  and not exists (select 1 from blood_tests k
                  where k.cat_id = m.keeper_id and k.test_date = b.test_date);

-- 자식 이관 ③: care_events — 유니크 키 없음 → 전부 이관
update care_events e set cat_id = m.keeper_id
from _dup_map m
where e.cat_id = m.loser_id;

-- 자식 이관 ④: cgm_daily — (cat_id, date) 충돌 없는 행만
update cgm_daily g set cat_id = m.keeper_id
from _dup_map m
where g.cat_id = m.loser_id
  and not exists (select 1 from cgm_daily k
                  where k.cat_id = m.keeper_id and k.date = g.date);

-- 이관 후 loser에 남은(=키 충돌) 자식 수 확인 — 이 행들은 아래 delete의 CASCADE로 삭제됨
select m.user_id, m.name,
  (select count(*) from daily_records d where d.cat_id=m.loser_id) as leftover_daily,
  (select count(*) from blood_tests b where b.cat_id=m.loser_id) as leftover_bt,
  (select count(*) from cgm_daily g where g.cat_id=m.loser_id) as leftover_cgm
from _dup_map m
order by 3 desc, 4 desc;

-- loser 삭제 (FK CASCADE로 잔여 충돌 자식 동반 삭제)
delete from cats c using _dup_map m where c.id = m.loser_id;

-- 정리 결과 확인 — 0행이어야 함
select user_id, name, count(*) from cats
group by user_id, name having count(*)>1;

commit;
-- 문제 발견 시 commit 대신 rollback;

-- ── 2) 재발 방지: 유니크 제약 (정리 커밋 후 별도 실행) ──
-- 클라이언트 v0.7.91이 23505 오류를 기존 행 채택으로 처리하므로 안전
alter table cats add constraint cats_user_name_uniq unique (user_id, name);

-- ── 3) 최종 검증 ──
-- 제약 확인
select conname from pg_constraint where conrelid = 'cats'::regclass and contype = 'u';
-- 계정당 고양이 수 분포 (정리 전 평균 2.2마리 → 하락해야 정상)
select cnt as cats_per_user, count(*) as users from (
  select user_id, count(*) as cnt from cats group by user_id
) t group by cnt order by cnt;
