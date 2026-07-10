// 소셜 로그인 고아 계정 정리 (v0.7.45)
// 케이스: 기존 이메일 유저가 다른 이메일의 카카오/구글로 로그인 → 빈 새 계정(고아) 자동 생성.
// linkIdentity로 소셜 identity를 기존 계정에 연결하려면 고아 계정이 identity를 점유 중이면 안 되므로
// 고아 계정을 삭제해 점유를 해제한다.
//
// 안전장치 (전부 통과해야 삭제):
//  1. 요청 토큰의 주인만 삭제 가능 (= 자기 자신만 삭제)
//  2. 이메일 가입 계정 삭제 금지 (소셜 provider만)
//  3. 생성 24시간 이내 계정만 (고아 계정은 방금 생성됨)
//  4. cats·user_settings에 데이터가 하나라도 있으면 거부 (빈 계정만)
//
// 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Vercel에 추가 필요)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: 'server_not_configured' });

  const token = req.body && req.body.token;
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'missing_token' });

  try {
    // 1. 토큰 검증 — 삭제 대상은 토큰 주인 본인뿐
    const uRes = await fetch(url + '/auth/v1/user', {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + token }
    });
    if (!uRes.ok) {
      const body = await uRes.text().catch(() => '');
      console.error('cleanup-orphan: 토큰 검증 실패', uRes.status, body.slice(0, 200));
      // GoTrue가 apikey 자체를 거부 → 토큰이 아니라 SUPABASE_SERVICE_ROLE_KEY 값 문제
      if (/invalid api key/i.test(body)) return res.status(500).json({ error: 'server_not_configured' });
      return res.status(401).json({ error: 'invalid_token' });
    }
    const user = await uRes.json();
    if (!user || !user.id) {
      console.error('cleanup-orphan: 사용자 응답에 id 없음');
      return res.status(401).json({ error: 'invalid_token' });
    }

    // 2. 소셜 provider 계정만 (이메일 계정 삭제 금지)
    const provider = (user.app_metadata && user.app_metadata.provider) || '';
    if (!provider || provider === 'email') {
      console.warn('cleanup-orphan: 거부 — 소셜 계정 아님', provider);
      return res.status(403).json({ error: 'not_social_account' });
    }
    const identities = user.identities || [];
    if (identities.some(i => i.provider === 'email')) {
      console.warn('cleanup-orphan: 거부 — 이메일 identity 보유');
      return res.status(403).json({ error: 'has_email_identity' });
    }

    // 3. 생성 24시간 이내
    const created = Date.parse(user.created_at || '') || 0;
    if (!created || Date.now() - created > 24 * 60 * 60 * 1000) {
      console.warn('cleanup-orphan: 거부 — 생성 24시간 초과', user.created_at);
      return res.status(403).json({ error: 'account_too_old' });
    }

    // 4. 빈 계정 확인 — 데이터가 있으면 절대 삭제 안 함
    for (const table of ['cats', 'user_settings']) {
      const q = await fetch(url + '/rest/v1/' + table + '?user_id=eq.' + encodeURIComponent(user.id) + '&select=user_id&limit=1', {
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
      });
      if (!q.ok) {
        console.error('cleanup-orphan: 데이터 확인 실패', table, q.status);
        return res.status(500).json({ error: 'data_check_failed' });
      }
      const rows = await q.json();
      if (Array.isArray(rows) && rows.length > 0) {
        console.warn('cleanup-orphan: 거부 — 계정에 데이터 있음', table);
        return res.status(403).json({ error: 'account_not_empty' });
      }
    }

    // 5. 삭제 (GoTrue Admin API)
    // profiles_id_fkey가 CASCADE가 아니어서 자동 생성된 profiles 행이 유저 삭제를 막음 → 먼저 제거
    const pRes = await fetch(url + '/rest/v1/profiles?id=eq.' + encodeURIComponent(user.id), {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
    });
    if (!pRes.ok) console.warn('cleanup-orphan: profiles 행 삭제 실패', pRes.status);
    const dRes = await fetch(url + '/auth/v1/admin/users/' + user.id, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
    });
    if (!dRes.ok) {
      const dBody = await dRes.text().catch(() => '');
      console.error('cleanup-orphan: 삭제 실패', dRes.status, dBody.slice(0, 200));
      return res.status(500).json({ error: 'delete_failed' });
    }

    console.log('cleanup-orphan: 고아 계정 삭제 완료', user.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('cleanup-orphan: 내부 오류', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
