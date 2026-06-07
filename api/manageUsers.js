/**
 * /api/manageUsers — Mac Studio 사용자 관리 프록시
 * GET    → 사용자 목록
 * POST   { action:'reset', name } → 비밀번호 초기화
 * POST   { action:'add', name, contact? } → 사용자 추가
 * DELETE ?name=... → 사용자 삭제
 */
const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';
const KEY = process.env.MAC_ADMIN_KEY || 'ktladmin2024';

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
  const headers = { 'Content-Type': 'application/json', 'X-Calc-Key': KEY };
  const sig = AbortSignal.timeout(8000);

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${MAC}/api/calc-users`, { headers, signal: sig });
      const d = await r.json();
      return res.status(r.status).json(d);
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const { action, name, contact = '' } = body;
      if (!name) return res.status(400).json({ error: 'name 필수' });

      if (action === 'reset') {
        const r = await fetch(`${MAC}/api/calc-users/reset`, {
          method: 'POST', headers, body: JSON.stringify({ name }), signal: sig,
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }
      if (action === 'add') {
        const r = await fetch(`${MAC}/api/calc-users/add`, {
          method: 'POST', headers, body: JSON.stringify({ name, contact, role: 'admin' }), signal: sig,
        });
        const d = await r.json();
        return res.status(r.status).json(d);
      }
      return res.status(400).json({ error: 'action: reset | add' });
    }

    if (req.method === 'DELETE') {
      const name = req.query?.name || new URL(req.url, 'http://x').searchParams.get('name');
      if (!name) return res.status(400).json({ error: 'name 필수' });
      const r = await fetch(`${MAC}/api/calc-users/${encodeURIComponent(name)}`, {
        method: 'DELETE', headers, signal: sig,
      });
      const d = await r.json();
      return res.status(r.status).json(d);
    }

    return res.status(405).json({ error: 'GET/POST/DELETE만 허용' });
  } catch (e) {
    return res.status(503).json({ error: 'Mac Studio 연결 실패: ' + e.message });
  }
}
