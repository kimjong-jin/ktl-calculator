/**
 * POST /api/revoke-code — 접수번호로 계산기 접속 코드 즉시 무효화
 * Auth: x-api-key 헤더 (MCP_KEY)
 * Body: { receiptNo: string }
 * Response: { ok, revoked }
 */
import { revokeTokenByReceiptNo } from '../src/tokenStore.js';

function requireMcpKey(req) {
  const key = process.env.MCP_KEY;
  if (!key) return false;
  const provided = (req.headers && req.headers['x-api-key'])
    || (req.query && req.query.key)
    || '';
  return provided === key;
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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });
  if (!requireMcpKey(req)) return res.status(401).json({ error: '인증 실패' });

  try {
    const body = await readBody(req);
    const receiptNo = typeof body.receiptNo === 'string' ? body.receiptNo.trim() : '';
    if (!receiptNo) return res.status(400).json({ error: 'receiptNo 필수' });

    const revoked = await revokeTokenByReceiptNo(receiptNo);
    return res.status(200).json({ ok: true, revoked, receiptNo });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : '무효화 실패' });
  }
}
