/**
 * POST /api/changePassword — Mac Studio 비밀번호 변경 프록시
 * { name, currentPassword, newPassword } → { ok } | { error }
 */
const MAC = process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || 'http://59.20.58.2:3333';

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
  const { name, currentPassword, newPassword } = body;
  if (!name || !currentPassword || !newPassword)
    return res.status(400).json({ error: 'name, currentPassword, newPassword 필수' });
  if (newPassword.length < 4)
    return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다' });

  try {
    const r = await fetch(`${MAC}/api/users/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, currentPassword, newPassword }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(503).json({ error: 'Mac Studio 연결 실패: ' + e.message });
  }
}
