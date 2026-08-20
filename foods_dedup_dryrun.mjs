#!/usr/bin/env node
/*
 * foods_master 이름 중복 정리 드라이런 + 무손실 SQL 생성 (읽기 전용 — SQL 실행은 킷)
 *
 * 배경: name 유니크 제약이 없어 대소문자 무시 완전 동일 이름이 11그룹(2026-08-20 실측).
 * 처리 순서 (고양이 중복 정리와 동일 패턴):
 *   1) lower(trim(name)) 기준 그룹핑 → 중복 그룹 추출
 *   2) 유지 행(keeper) 선정: 비어있지 않은 필드 수 많은 쪽 → 동률이면 created_at 오래된 쪽
 *   3) keeper에 없는 필드는 다른 행 값으로 COALESCE 병합 (무손실)
 *   4) 삭제될 id가 user_settings(fd_v2_·favFoods_v1_ 계열)·daily_records에 참조되면 keeper id로 재매핑
 *   5) 나머지 행 DELETE → lower(trim(name)) 유니크 인덱스 생성
 *
 * 사용법: SB_SERVICE_KEY=<service_role_key> node foods_dedup_dryrun.mjs
 * 산출물: foods_dedup_zeroloss_<시각>.sql (검토 후 킷이 Supabase SQL Editor에서 실행)
 *
 * ⚠ 클라이언트 대응은 v0.8.9에 기배포: contributeFoodMaster가 23505에서 기존 행 채택.
 *   제약 생성 전에 이 SQL의 중복 정리가 선행돼야 함(제약 생성이 실패하므로 순서는 자동 강제됨).
 */

import fs from 'fs';

const SB_URL = 'https://lyrzrgvugntdqvxdxyfk.supabase.co';
const KEY = process.env.SB_SERVICE_KEY;
if (!KEY) { console.error('ERROR: SB_SERVICE_KEY 환경변수가 필요합니다 (service_role key).'); process.exit(1); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function rest(path, qs) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}?${qs}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

const MERGE_FIELDS = ['name_input','type','moisture','protein_af','fat_af','fiber_af','ash_af','carb_af',
  'kcal_per_100g','phosphorus_af','sodium_af','potassium_af','ingredients','ingredients_top5',
  'grain_free','main_protein_source','special_notes'];

const sqlStr = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

(async () => {
  const foods = await rest('foods_master', 'select=*');
  console.log('foods_master 총 행:', foods.length);

  // 1) 그룹핑
  const groups = new Map();
  for (const r of foods) {
    const k = String(r.name || '').trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const dups = [...groups.values()].filter(g => g.length > 1);
  console.log('중복 그룹:', dups.length);
  if (!dups.length) { console.log('중복 없음 — 유니크 인덱스 생성 SQL만 산출'); }

  const filled = r => MERGE_FIELDS.filter(f => r[f] != null && r[f] !== '').length;
  const lines = ['BEGIN;', ''];
  const loserIds = [];

  for (const g of dups) {
    g.sort((a, b) => (filled(b) - filled(a)) || (new Date(a.created_at) - new Date(b.created_at)));
    const keeper = g[0], losers = g.slice(1);
    console.log(`\n[그룹] ${keeper.name}`);
    console.log(`  유지: ${keeper.id} (채워진 필드 ${filled(keeper)}, ${keeper.created_at})`);
    lines.push(`-- 그룹: ${keeper.name} (유지 ${keeper.id})`);
    // 3) 무손실 병합: keeper의 빈 필드를 loser 값으로 채움 — FROM 절 참조로 컬럼 타입(text[]/jsonb 등) 무관
    const byDonor = new Map();
    for (const f of MERGE_FIELDS) {
      if (keeper[f] != null && keeper[f] !== '') continue;
      const donor = losers.find(l => l[f] != null && l[f] !== '');
      if (!donor) continue;
      if (!byDonor.has(donor.id)) byDonor.set(donor.id, []);
      byDonor.get(donor.id).push(f);
      console.log(`  병합: ${f} ← ${donor.id}`);
    }
    for (const [donorId, fields] of byDonor) {
      lines.push(`UPDATE foods_master k SET ${fields.map(f => `${f} = d.${f}`).join(', ')} FROM foods_master d WHERE k.id = '${keeper.id}' AND d.id = '${donorId}';`);
    }
    for (const l of losers) {
      console.log(`  삭제 예정: ${l.id} (채워진 필드 ${filled(l)}, ${l.created_at})`);
      loserIds.push({ loser: l.id, keeper: keeper.id });
    }
  }

  // 4) 참조 재매핑 — user_settings(JSON 내 masterId)·daily_records(data 내 참조) 텍스트 스캔
  console.log('\n참조 스캔 중 (user_settings / daily_records)...');
  let refCount = 0;
  for (const { loser, keeper } of loserIds) {
    const us = await rest('user_settings', `select=user_id,key&value=ilike.${encodeURIComponent('*' + loser + '*')}`);
    const dr = await rest('daily_records', `select=user_id,cat_name,record_date&data=ilike.${encodeURIComponent('*' + loser + '*')}`)
      .catch(() => []);   // data 컬럼 타입에 따라 ilike 불가 시 스킵(아래 광역 remap이 방어)
    if (us.length || dr.length) {
      refCount += us.length + dr.length;
      console.log(`  ${loser} 참조: user_settings ${us.length}행 ${us.map(r => r.key).join(',')} / daily_records ${dr.length}행`);
    }
    // 참조 유무와 무관하게 remap SQL은 항상 포함 (스캔 누락 방어 — 참조 없으면 0행 갱신으로 무해)
    lines.push(`UPDATE user_settings SET value = replace(value::text, '${loser}', '${keeper}')::jsonb WHERE value::text LIKE '%${loser}%';`);
    lines.push(`UPDATE daily_records SET data = replace(data::text, '${loser}', '${keeper}')::jsonb WHERE data::text LIKE '%${loser}%';`);
  }
  console.log('참조 발견 총계:', refCount);

  // 5) 삭제 + 유니크 인덱스
  if (loserIds.length) {
    lines.push('', `DELETE FROM foods_master WHERE id IN (${loserIds.map(x => `'${x.loser}'`).join(', ')});`);
  }
  lines.push('', '-- 대소문자·양끝 공백 무시 유니크 (클라이언트 v0.8.9 의 23505 복구 경로와 세트)');
  lines.push('CREATE UNIQUE INDEX IF NOT EXISTS foods_master_name_uniq ON foods_master (lower(trim(name)));');
  lines.push('', 'COMMIT;');
  lines.push('', '-- 검증: 아래가 0행이어야 함');
  lines.push('-- SELECT lower(trim(name)), count(*) FROM foods_master GROUP BY 1 HAVING count(*) > 1;');

  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const out = `foods_dedup_zeroloss_${ts}.sql`;
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log('\nSQL 생성:', out, `(중복 ${dups.length}그룹, 삭제 ${loserIds.length}행)`);
  console.log('킷 실행 순서: SQL 검토 → Supabase SQL Editor 실행 → 검증 쿼리 0행 확인');
})();
