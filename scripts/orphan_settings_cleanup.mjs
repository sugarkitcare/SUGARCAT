#!/usr/bin/env node
/*
 * 고아 user_settings 정리 (v0.7.97 ③) — 삭제된 고양이의 이름 키 파기 (개인정보보호법 제21조)
 *
 * 사용법:
 *   SB_SERVICE_KEY=<service_role_key> node scripts/orphan_settings_cleanup.mjs            # dry-run (기본)
 *   SB_SERVICE_KEY=<service_role_key> node scripts/orphan_settings_cleanup.mjs --execute  # 실제 삭제
 *
 * ⚠ 실행 전제:
 *   1) v0.7.97(이름 변경 키 이관)이 프로덕션에 배포된 뒤 실행할 것 — 이관 전 고아를 지우면 데이터 유실
 *   2) dry-run 리포트 검토 → 백업 파일 확인 → --execute
 *   3) 리포트의 'rename?' 표시 계정은 이름 변경 고아일 수 있음 — 수동 확인 후 판단
 *
 * 판정: 고양이별 접두사 18종 키의 이름 부분이 그 계정의 현재 cats.name 목록에 없으면 고아.
 * 백업: 삭제 대상 전체 행을 orphan_settings_backup_<ts>.json(복구용) + .csv(검토용)로 저장 후 삭제.
 */
import fs from 'node:fs';

const SB_URL = 'https://lyrzrgvugntdqvxdxyfk.supabase.co';
const KEY = process.env.SB_SERVICE_KEY;
const EXECUTE = process.argv.includes('--execute');
if (!KEY) { console.error('ERROR: SB_SERVICE_KEY 환경변수가 필요합니다 (service_role key).'); process.exit(1); }

// index.html CAT_US_PREFIXES와 동일해야 함 — 최장 접두사 우선 매칭(memorial_msg_ vs memorial_)
const PREFIXES = ['fd_v2_','favFoods_v1_','manualFoods_v1_','tubeRecipes_v1_','cgm_data_',
  'routine_items_','routine_versions_','med_notif_','emerg_state_','fluid_state_',
  'card_order_','card_hidden_','tile_config_','memorial_msg_','memorial_',
  'next_visit_','vet_questions_','last_inputs_'].sort((a,b)=>b.length-a.length);

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function rest(path, qs, opts) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}?${qs}`, { headers: { ...H, ...(opts?.headers||{}) }, method: opts?.method||'GET', body: opts?.body });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return opts?.method==='DELETE' ? null : res.json();
}
async function fetchAll(path, qs) {
  const rows = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const batch = await rest(path, qs, { headers: { Range: `${from}-${from+PAGE-1}`, 'Range-Unit': 'items' } });
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

(async () => {
  console.log(`── 고아 user_settings 스캔 (${EXECUTE ? '⚠ EXECUTE' : 'dry-run'}) ──`);
  const [cats, settings] = await Promise.all([
    fetchAll('cats', 'select=user_id,name'),
    fetchAll('user_settings', 'select=user_id,key,value'),
  ]);
  const catNames = new Map(); // user_id -> Set(names)
  cats.forEach(c => { if (!catNames.has(c.user_id)) catNames.set(c.user_id, new Set()); catNames.get(c.user_id).add(c.name); });

  const orphans = [];
  settings.forEach(r => {
    const p = PREFIXES.find(px => r.key.startsWith(px));
    if (!p) return;                                   // 고양이별 키 아님 (consent 등) — 제외
    const name = r.key.slice(p.length);
    if (!name) return;
    const names = catNames.get(r.user_id) || new Set();
    if (!names.has(name)) orphans.push({ ...r, _prefix: p, _name: name });
  });

  // 리포트: 계정별 고아 이름·키 수 + rename 의심(고아 이름이 하나이고 현재 고양이도 있음)
  const byUser = new Map();
  orphans.forEach(o => {
    if (!byUser.has(o.user_id)) byUser.set(o.user_id, { names: new Set(), n: 0 });
    const u = byUser.get(o.user_id); u.names.add(o._name); u.n++;
  });
  console.log(`user_settings ${settings.length}행 중 고아 ${orphans.length}행 · 영향 계정 ${byUser.size}곳\n`);
  for (const [uid, u] of byUser) {
    const cur = [...(catNames.get(uid) || [])];
    const renameHint = u.names.size === 1 && cur.length >= 1 ? ' rename?' : '';
    console.log(`${uid.slice(0,8)}… | 현재 고양이 [${cur.join(', ')}] | 고아 이름 [${[...u.names].join(', ')}] | 키 ${u.n}개${renameHint}`);
  }

  if (!orphans.length) { console.log('\n고아 키 없음 — 종료'); return; }

  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const jsonPath = `orphan_settings_backup_${ts}.json`;
  const csvPath = `orphan_settings_backup_${ts}.csv`;
  fs.writeFileSync(jsonPath, JSON.stringify(orphans, null, 2));
  fs.writeFileSync(csvPath, 'user_id,key,orphan_name\n' + orphans.map(o => `${o.user_id},"${o.key.replace(/"/g,'""')}","${o._name.replace(/"/g,'""')}"`).join('\n'));
  console.log(`\n백업 저장: ${jsonPath} (복구용 value 포함) / ${csvPath} (검토용)`);

  if (!EXECUTE) { console.log('\ndry-run 종료 — 검토 후 --execute로 실행하세요.'); return; }

  console.log('\n삭제 실행 중...');
  let deleted = 0;
  for (const o of orphans) {
    // 키 단건 삭제 — 인코딩 이슈 없이 안전 (고아 수백 건 수준이라 충분히 빠름)
    await rest('user_settings', `user_id=eq.${o.user_id}&key=eq.${encodeURIComponent(o.key)}`, { method: 'DELETE' });
    deleted++;
  }
  console.log(`삭제 완료: ${deleted}행. 재실행 시 고아 0이어야 정상입니다.`);
})().catch(e => { console.error('실패:', e); process.exit(1); });
