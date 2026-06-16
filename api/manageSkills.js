/**
 * /api/manageSkills — Mac Studio 스킬(관리자 전문지식) 저장소 프록시
 *   GET  → 스킬 목록
 *   POST { skills:[...] } → 전체 저장(replace-all)
 * 관리자 토큰(Authorization: Bearer) 필수. Mac Studio /api/calc-skills 로 프록시.
 */
import { verifyToken } from '../src/authService.js';

const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';
const KEY = process.env.MAC_ADMIN_KEY || '';   // env 필수 (하드코딩 폴백 없음)

function isAdmin(req) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const r = verifyToken(token);
  return r.valid && r.role === 'admin';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 5e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!isAdmin(req)) return res.status(401).json({ error: '인증 필요' });
  if (!KEY) return res.status(500).json({ error: '서버 설정 오류' });
  const headers = { 'Content-Type': 'application/json', 'X-Calc-Key': KEY };
  const sig = AbortSignal.timeout(8000);

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${MAC}/api/calc-skills`, { headers, signal: sig });
      const d = await r.json();
      return res.status(r.status).json(d);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const skills = Array.isArray(body && body.skills) ? body.skills : null;
      if (!skills) return res.status(400).json({ error: 'skills 배열 필수' });
      const r = await fetch(`${MAC}/api/calc-skills`, {
        method: 'POST', headers, body: JSON.stringify({ skills }), signal: sig,
      });
      const d = await r.json();
      return res.status(r.status).json(d);
    }
    return res.status(405).json({ error: 'GET/POST만 허용' });
  } catch {
    return res.status(503).json({ error: 'Mac Studio 연결 실패' });
  }
}
