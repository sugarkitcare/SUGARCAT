-- fill_food_kcal — 보호자 kcal 입력을 공유 DB(foods_master)에 반영하는 RPC (v0.7.28)
-- 배경: foods_master UPDATE 정책(foods_master_admin_update)은 관리자 계정만 허용.
--   일반 보호자의 kcal 입력을 공유 반영하려면 security definer로 RLS를 우회하되,
--   함수 내부에서 "kcal_per_100g IS NULL인 행만" UPDATE하도록 제한(기존 값 절대 미덮어씀).
-- 실행: Supabase SQL Editor에서 이 파일 전체 실행. 앱(index.html saveFdKcal)이 rpc('fill_food_kcal')로 호출.

CREATE OR REPLACE FUNCTION fill_food_kcal(food_id uuid, kcal numeric)
RETURNS integer          -- 영향받은 행 수 반환(0=이미 값 있거나 없는 id, 1=채움)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  -- kcal이 null인 행만 채움 (기존 값 보호). 양수만 허용.
  IF kcal IS NULL OR kcal <= 0 THEN
    RETURN 0;
  END IF;
  UPDATE foods_master
  SET kcal_per_100g = kcal
  WHERE id = food_id AND kcal_per_100g IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 로그인 사용자만 호출 가능 (anon 제외)
GRANT EXECUTE ON FUNCTION fill_food_kcal(uuid, numeric) TO authenticated;
