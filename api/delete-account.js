// 회원 탈퇴 (v0.7.82, P0) — 개인정보 보호법 제21·36·37조 및 방침 제3·4조 이행 경로.
// 삭제 대상은 오직 세션 토큰의 주인 본인 — 요청 본문의 다른 식별자는 신뢰하지 않는다.
// 전 테이블 FK가 ON DELETE CASCADE라 auth 사용자 1건 삭제로 전 데이터가 연쇄 삭제된다.
// (profiles → cats → blood_tests·care_events·cgm_daily·daily_records, user_settings, feedback, food_analyses)
// 로그에 개인 식별 정보(이메일·user id)를 남기지 않는다 — cleanup-orphan과 다른 원칙.
// 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
    // 1. 토큰 검증 — 본인 확인 (토큰이 유효한 사용자의 것일 때만 진행)
    const uRes = await fetch(url + '/auth/v1/user', {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + token }
    });
    if (!uRes.ok) {
      console.error('delete-account: 토큰 검증 실패', uRes.status);
      return res.status(401).json({ error: 'invalid_token' });
    }
    const user = await uRes.json();
    if (!user || !user.id) {
      console.error('delete-account: 사용자 응답에 id 없음');
      return res.status(401).json({ error: 'invalid_token' });
    }

    // 2. 삭제 (GoTrue Admin API) — 대상은 토큰에서 얻은 본인 id뿐
    const dRes = await fetch(url + '/auth/v1/admin/users/' + user.id, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
    });
    if (!dRes.ok) {
      console.error('delete-account: 삭제 실패', dRes.status);
      return res.status(500).json({ error: 'delete_failed' });
    }

    console.log('delete-account: 처리 완료'); // 식별 정보 미기록
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('delete-account: 내부 오류', e && e.message ? e.message : String(e));
    return res.status(500).json({ error: 'internal_error' });
  }
}
