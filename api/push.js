/**
 * /api/push — 웹푸시 프록시 (계산기 → Mac Studio parser-server)
 * GET  ?action=vapid                 → 공개키
 * POST { action:'subscribe', subscription, userName }
 * POST { action:'schedule', id, endpoint, fireAt, title, body }
 * POST { action:'cancel', id }
 */
const BASE          = (process.env.MAC_STUDIO_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
const STUDIO_SECRET = process.env.STUDIO_SECRET || '';

const MAP = { vapid: 'vapid', subscribe: 'subscribe', schedule: 'schedule', cancel: 'cancel' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!BASE) return res.status(503).json({ error: 'MAC_STUDIO_URL 미설정' });

  try {
    if (req.method === 'GET' && (req.query.action || 'vapid') === 'vapid') {
      const up = await fetch(`${BASE}/api/push/vapid`, { headers: { 'x-studio-secret': STUDIO_SECRET }, signal: AbortSignal.timeout(8000) });
      return res.status(up.status).json(await up.json());
    }
    if (req.method !== 'POST') return res.status(405).end();
    const action = (req.body && req.body.action) || '';
    const path = MAP[action];
    if (!path || path === 'vapid') return res.status(400).json({ error: 'action 필요(subscribe/schedule/cancel)' });
    const up = await fetch(`${BASE}/api/push/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-studio-secret': STUDIO_SECRET },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(8000),
    });
    return res.status(up.status).json(await up.json());
  } catch (e) {
    return res.status(502).json({ error: `Mac Studio 연결 실패: ${e.message}` });
  }
}
