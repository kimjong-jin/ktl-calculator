/**
 * Vercel 서버리스 인증 엔드포인트.
 *   POST /api/auth  { password }  → { token, exp } | { error }
 *   GET  /api/auth?token=...      → { valid, exp }  (토큰 유효성 확인)
 *
 * 비밀(ACCESS_PASSWORD/AUTH_SECRET 등)은 Vercel 환경변수로만 주입한다.
 * 로직은 src/authService.js(순수·테스트 완료)를 공유한다. (dev는 vite 미들웨어에서 동일 호출)
 */
import { verifyAccess, verifyToken } from '../src/authService.js';

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
  const result = verifyAccess(String(body.password ?? ''), Date.now(), String(body.id ?? ''));
  if (!result.ok) return res.status(result.code || 401).json({ error: result.error });
  return res.status(200).json({ token: result.token, exp: result.exp, role: result.role });
}
