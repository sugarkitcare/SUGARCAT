-- 혈검 데이터 정합성 점검 (읽기 전용 SELECT). 수정 전 반드시 blood_tests CSV 백업.
-- 목적: 스펙 ①에서 다룬 구조적 오염을 기존 데이터에서 찾아낸다.
--   (a) 혈청 CREA 자리에 뇨 CREA(~100) 값이 들어간 레코드
--   (b) 같은 (abbr,category) 항목이 한 레코드에 2개 이상(구버전 last-wins 이전 잔재)
--   (c) 혈당 자리에 뇨당(정성값)이 섞였는지 육안 검토용 목록
-- 실행 후 결과를 보고 수동으로 items를 고친다(자동 UPDATE 없음).

-- ─────────────────────────────────────────────────────────────
-- (a) 혈청 CREA 자리에 뇨 CREA로 의심되는 값 (serum CREA는 CKD여도 통상 <20 mg/dL)
--     category가 뇨검이 아니고 abbr=CREA인데 value가 20 초과 → 뇨 CREA(U-CREA)로 옮겨야 할 후보
SELECT bt.id, bt.cat_id, bt.test_date,
       it->>'abbr'  AS abbr,
       it->>'value' AS value,
       it->>'unit'  AS unit,
       COALESCE(it->>'category','(none)') AS category
FROM blood_tests bt,
     LATERAL jsonb_array_elements(bt.items) AS it
WHERE it->>'abbr' = 'CREA'
  AND COALESCE(it->>'category','') <> '뇨검'
  AND (it->>'value') ~ '^[0-9.]+$'
  AND (it->>'value')::numeric > 20
ORDER BY bt.test_date;

-- ─────────────────────────────────────────────────────────────
-- (b) 한 레코드 안에서 같은 (abbr,category)가 중복된 항목 (있으면 안 됨)
SELECT bt.id, bt.cat_id, bt.test_date,
       (it->>'abbr') || '|' || COALESCE(it->>'category','기타') AS key,
       COUNT(*) AS n,
       jsonb_agg(it->>'value') AS values
FROM blood_tests bt,
     LATERAL jsonb_array_elements(bt.items) AS it
GROUP BY bt.id, bt.cat_id, bt.test_date, key
HAVING COUNT(*) > 1
ORDER BY bt.test_date;

-- ─────────────────────────────────────────────────────────────
-- (c) 혈당(GLU)·크레아티닌(CREA) 항목 전수 목록 — category/source 오분류 육안 검토
--     뇨 항목이면 abbr이 U-GLU / U-CREA, category '뇨검'이어야 정상.
SELECT bt.test_date,
       it->>'abbr'     AS abbr,
       it->>'value'    AS value,
       COALESCE(it->>'category','(none)') AS category,
       COALESCE(it->>'source','(none)')   AS source
FROM blood_tests bt,
     LATERAL jsonb_array_elements(bt.items) AS it
WHERE it->>'abbr' IN ('GLU','CREA','U-GLU','U-CREA')
ORDER BY bt.test_date, abbr;

-- ─────────────────────────────────────────────────────────────
-- (d) 같은 날 HCT/HGB가 2개 이상(혈액가스 vs CBC) 남아있는 레코드 — CBC로 통일할 후보
SELECT bt.id, bt.test_date, it->>'abbr' AS abbr,
       jsonb_agg(jsonb_build_object('value', it->>'value', 'source', it->>'source')) AS variants,
       COUNT(*) AS n
FROM blood_tests bt,
     LATERAL jsonb_array_elements(bt.items) AS it
WHERE it->>'abbr' IN ('HCT','HGB')
GROUP BY bt.id, bt.test_date, abbr
HAVING COUNT(*) > 1
ORDER BY bt.test_date;
