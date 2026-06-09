/**
 * Vercel 서버리스 인증 엔드포인트.
 *   POST /api/auth  { password }  → { token, exp } | { error }
 *   GET  /api/auth?token=...      → { valid, exp }  (토큰 유효성 확인)
 */
import { verifyAccess, verifyToken, issueUserSession } from '../src/authService.js';
import { isTokenValid, findTokenByPw } from '../src/tokenStore.js';

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const token = (req.query && req.query.token) || '';
    return res.status(200).json(verifyToken(String(token)));
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'POST 또는 GET 만 허용됩니다.' });
  }
  const body = await readJson(req);
  const password = String(body.password ?? '');

  // 초대 토큰(고객 접속 코드)인 경우 Blob에서 유효성 확인
  // → 관리자가 삭제한 토큰은 Blob에 없으므로 즉시 차단
  if (password.includes('.')) {
    const tokenKey = password.split('.')[0];
    const blobValid = await isTokenValid(tokenKey);
    if (!blobValid) {
      return res.status(403).json({ error: '접속 코드가 삭제되었거나 만료되었습니다.' });
    }
  }

  // 단순 고객 비밀번호 (6자 대문자+숫자, '.' 없음) → Blob에서 매핑 조회
  if (!password.includes('.') && /^[A-Z0-9]{4,10}$/.test(password)) {
    const entry = await findTokenByPw(password);
    if (entry) {
      const result = issueUserSession(entry.tokenId, entry.exp);
      if (result.ok) return res.status(200).json({ token: result.token, exp: result.exp, role: result.role });
    }
  }

  const result = verifyAccess(password, Date.now(), String(body.id ?? ''));
  if (!result.ok) return res.status(result.code || 401).json({ error: result.error });
  return res.status(200).json({ token: result.token, exp: result.exp, role: result.role });
}
