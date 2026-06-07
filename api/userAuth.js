/**
 * POST /api/userAuth — Mac Studio 사용자 인증 프록시
 * { name, password } → { token, role, mustChange } | { error }
 *
 * Mac Studio(3333) app_users 테이블 인증 후 Vercel HMAC 토큰 발급.
 * mustChange=true 이면 프론트에서 비밀번호 변경 모달 표시.
 */
import { sign } from '../src/authService.js';

const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';
const DAY_MS = 86_400_000;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const body = await readBody(req);
  const name = String(body.name || '').trim();
  const password = String(body.password || '').trim();
  if (!name || !password) return res.status(400).json({ error: 'name, password 필수' });

  try {
    const r = await fetch(`${MAC}/api/users/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    if (!r.ok) return res.status(401).json({ error: data.error || '인증 실패' });

    // Mac Studio 인증 성공 → Vercel HMAC 토큰 발급 (role=admin 부여)
    const exp = Math.floor((Date.now() + 30 * DAY_MS) / 1000);
    const token = sign({ exp, role: 'admin', id: name }, process.env.AUTH_SECRET);
    return res.status(200).json({
      token,
      exp,
      role: 'admin',
      name: data.name,
      mustChange: !!data.mustChange,
    });
  } catch (e) {
    return res.status(503).json({ error: 'Mac Studio 연결 실패: ' + e.message });
  }
}
