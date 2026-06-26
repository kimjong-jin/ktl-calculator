/**
 * /api/calcPrimary — 주사용자 단일 락 프록시 (claim/heartbeat/release)
 * POST { action: 'claim'|'heartbeat'|'release', receiptNo, sessionId, force? }
 * Mac Studio(:3333) /api/calc/primary/* 로 x-studio-secret 붙여 전달.
 */
const BASE          = (process.env.MAC_STUDIO_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
const STUDIO_SECRET = process.env.STUDIO_SECRET || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (!BASE) return res.status(503).json({ error: 'MAC_STUDIO_URL 환경변수 미설정' });

  const { action, receiptNo, sessionId, force } = req.body || {};
  const path = ({ claim: 'claim', heartbeat: 'heartbeat', release: 'release' })[action];
  if (!path) return res.status(400).json({ error: "action 필수 (claim/heartbeat/release)" });

  try {
    const upstream = await fetch(`${BASE}/api/calc/primary/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': STUDIO_SECRET },
      body: JSON.stringify({ receiptNo, sessionId, force: !!force }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
