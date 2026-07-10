// 일회성 디버그 계정 삭제 (2026-07-10 cleanup-orphan 조사에서 생성된 테스트 계정 제거용)
// 사용 후 이 파일은 삭제할 것. 하드코딩된 이메일 본인 토큰으로만 동작.
const DEBUG_EMAIL = 'cm-debug-20260710@example.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return res.status(500).json({ error: 'server_not_configured' });

  const token = req.body && req.body.token;
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'missing_token' });

  try {
    const uRes = await fetch(url + '/auth/v1/user', {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + token }
    });
    if (!uRes.ok) return res.status(401).json({ error: 'invalid_token' });
    const user = await uRes.json();
    if (!user || !user.id || user.email !== DEBUG_EMAIL) return res.status(403).json({ error: 'not_debug_account' });

    const dRes = await fetch(url + '/auth/v1/admin/users/' + user.id, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
    });
    if (!dRes.ok) {
      const dBody = await dRes.text().catch(() => '');
      console.error('delete-debug-account: 삭제 실패', dRes.status, dBody.slice(0, 300));
      return res.status(500).json({ error: 'delete_failed' });
    }
    console.log('delete-debug-account: 삭제 완료', user.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('delete-debug-account: 내부 오류', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
