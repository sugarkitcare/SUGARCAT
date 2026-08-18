export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
    // 네이티브 구글 로그인용 웹 클라이언트 ID (v0.8.3) — 공개값(비밀 아님), 미설정 시 빈 문자열
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID || '',
  });
}
