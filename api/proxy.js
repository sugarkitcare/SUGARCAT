// Rate limiting 설정
const RATE_LIMIT = {
  windowMs: 60 * 60 * 1000, // 1시간
  maxRequests: 20,            // 시간당 최대 20회
  maxTokens: 100000,          // 시간당 최대 토큰 수
};

// 메모리 기반 rate limit 저장소
// (Vercel serverless는 인스턴스가 재시작되면 초기화됨 - 허용 범위)
const rateLimitStore = new Map();

function getRateLimitKey(req) {
  // IP 주소 추출 (Vercel 환경)
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown';
  return `rl_${ip}`;
}

function checkRateLimit(key) {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now - record.windowStart > RATE_LIMIT.windowMs) {
    // 새 윈도우 시작
    rateLimitStore.set(key, {
      windowStart: now,
      requests: 1,
      tokens: 0,
    });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
  }

  if (record.requests >= RATE_LIMIT.maxRequests) {
    const resetIn = Math.ceil((RATE_LIMIT.windowMs - (now - record.windowStart)) / 60000);
    return { allowed: false, remaining: 0, resetIn };
  }

  record.requests += 1;
  rateLimitStore.set(key, record);
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - record.requests };
}

// 오래된 항목 정리 (메모리 누수 방지)
function cleanupStore() {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT.windowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting 체크
  const rlKey = getRateLimitKey(req);
  const rlResult = checkRateLimit(rlKey);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.maxRequests);
  res.setHeader('X-RateLimit-Remaining', rlResult.remaining);

  if (!rlResult.allowed) {
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `요청이 너무 많아요. ${rlResult.resetIn}분 후에 다시 시도해주세요.`,
      resetIn: rlResult.resetIn,
    });
  }

  // 주기적 정리
  if (Math.random() < 0.1) cleanupStore();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({
      error: 'Proxy error',
      detail: err.message,
    });
  }
}
