-- ══════════════════════════════════════════════════════════
-- CGM CSV 업로드 — cgm_daily 테이블 + RLS (v0.7.53)
-- 실행: Supabase 대시보드 → SQL Editor에서 전체 실행
-- 일별 JSONB 묶음 저장 (5분 간격 288개/일 → 행 1개, 행 폭발 방지)
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cgm_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id uuid NOT NULL REFERENCES cats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  device text,                    -- 'CareSens Air'
  serial text,                    -- 센서 일련번호 (교체 시 '·'로 연결한 복수 값)
  readings jsonb NOT NULL,        -- [{"t":"00:04","v":191,"r":-0.7}, ...] (t=HH:MM, v=mg/dL, r=trend 선택)
  summary jsonb,                  -- {"avg":..,"min":..,"max":..,"low_count":..,"high_count":..,"count":..}
                                  -- low: v<60, high: v>=300 (앱 공용 기준 — bgLabel·병원 리포트와 동일)
  source text DEFAULT 'csv',      -- 'csv' | 'screenshot' (현재 CSV만 이 테이블 사용)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(cat_id, date)            -- upsert onConflict 키 + 일별 조회 인덱스 겸용
);

-- 유저 단위 조회 대비 (RLS 필터 성능)
CREATE INDEX IF NOT EXISTS idx_cgm_daily_user ON cgm_daily(user_id);

-- ── RLS ──
ALTER TABLE cgm_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cgm_daily_select_own" ON cgm_daily
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "cgm_daily_insert_own" ON cgm_daily
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cgm_daily_update_own" ON cgm_daily
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cgm_daily_delete_own" ON cgm_daily
  FOR DELETE USING (auth.uid() = user_id);
