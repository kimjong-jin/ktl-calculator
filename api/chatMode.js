/**
 * /api/chatMode — AI 법령 챗 표시 모드(서버 단일 출처).
 *   GET  → { mode }  (공개 — 모든 사용자가 FAB 표시 결정에 사용)
 *   POST { mode } → 저장  (관리자 토큰 필수)
 * mode: 'active'(전원 표시) | 'maintenance'(관리자만) | 'inactive'(전원 숨김)
 * Mac Studio /api/calc-config (key=chat_mode) 로 프록시.
 */
import { verifyToken } from '../src/authService.js';

const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';
const KEY = process.env.MAC_ADMIN_KEY || '';
const VALID = ['active', 'maintenance', 'inactive'];

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
    req.on('data', c => { raw += c; if (raw.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const headers = { 'Content-Type': 'application/json', 'X-Calc-Key': KEY };
  const sig = AbortSignal.timeout(6000);

  try {
    if (req.method === 'GET') {
      // 공개: 키 미설정/서버 오류면 안전 기본값(maintenance=사용자 숨김)으로 폴백
      if (!KEY) return res.status(200).json({ mode: 'maintenance' });
      const r = await fetch(`${MAC}/api/calc-config?key=chat_mode`, { headers, signal: sig });
      const d = await r.json().catch(() => ({}));
      const mode = VALID.includes(d.value) ? d.value : 'maintenance';
      return res.status(200).json({ mode });
    }
    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(401).json({ error: '인증 필요' });
      if (!KEY) return res.status(500).json({ error: '서버 설정 오류' });
      const body = await readBody(req);
      const mode = VALID.includes(body && body.mode) ? body.mode : null;
      if (!mode) return res.status(400).json({ error: 'mode: active|maintenance|inactive' });
      const r = await fetch(`${MAC}/api/calc-config`, {
        method: 'POST', headers, body: JSON.stringify({ key: 'chat_mode', value: mode }), signal: sig,
      });
      const d = await r.json().catch(() => ({}));
      return res.status(r.status).json({ ok: !!d.ok, mode });
    }
    return res.status(405).json({ error: 'GET/POST만 허용' });
  } catch {
    // GET 실패는 안전 기본값, POST 실패는 503
    if (req.method === 'GET') return res.status(200).json({ mode: 'maintenance' });
    return res.status(503).json({ error: 'Mac Studio 연결 실패' });
  }
}
