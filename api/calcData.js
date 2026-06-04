/**
 * /api/calcData — 정도검사 계산 데이터 저장/불러오기 프록시
 * Mac Studio SQLite ↔ 계산기 클라이언트
 *
 * GET  /api/calcData?receiptNo=xxx&userName=yyy         → 불러오기
 * GET  /api/calcData?action=list&token=adminToken       → 목록 (관리자)
 * POST /api/calcData                                    → 저장
 * DELETE /api/calcData?receiptNo=xxx&userName=yyy&token → 삭제 (관리자)
 */

const BASE         = (process.env.MAC_STUDIO_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
const STUDIO_SECRET = process.env.STUDIO_SECRET || '';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN    || '';

function requireAdmin(req, res) {
  const token = req.query.token || req.headers['x-admin-token'] || '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: '관리자 인증 필요' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!BASE) return res.status(503).json({ error: 'MAC_STUDIO_URL 환경변수가 설정되지 않았습니다.' });

  try {
    let url;
    const options = {
      method: req.method === 'DELETE' ? 'DELETE' : req.method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (req.method === 'GET') {
      const { action, receiptNo, userName } = req.query;

      if (action === 'list') {
        if (!requireAdmin(req, res)) return;
        url = `${BASE}/api/calc/list`;
        options.headers['x-studio-secret'] = STUDIO_SECRET;
      } else {
        if (!receiptNo || !userName)
          return res.status(400).json({ error: 'receiptNo, userName 필수' });
        url = `${BASE}/api/calc?receiptNo=${encodeURIComponent(receiptNo)}&userName=${encodeURIComponent(userName)}`;
      }

    } else if (req.method === 'POST') {
      const { receiptNo, userName } = req.body || {};
      if (!receiptNo || !userName)
        return res.status(400).json({ error: 'receiptNo, userName 필수' });
      url = `${BASE}/api/calc`;
      options.body = JSON.stringify(req.body);

    } else if (req.method === 'DELETE') {
      if (!requireAdmin(req, res)) return;
      const { receiptNo, userName } = req.query;
      if (!receiptNo) return res.status(400).json({ error: 'receiptNo 필수' });
      const qs = userName ? `?userName=${encodeURIComponent(userName)}` : '';
      url = `${BASE}/api/calc/${encodeURIComponent(receiptNo)}${qs}`;
      options.headers['x-studio-secret'] = STUDIO_SECRET;

    } else {
      return res.status(405).end();
    }

    const upstream = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (e) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
