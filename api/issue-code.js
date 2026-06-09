/**
 * POST /api/issue-code — 고객 계산기 접속 코드 자동 발급
 * Auth: x-api-key 헤더 또는 ?key= 쿼리 (MCP_KEY)
 * Body: { label?: string, days?: number }
 * Response: { pw, exp, expiresAt }
 */
import { generateInviteToken } from '../src/authService.js';
import { registerToken } from '../src/tokenStore.js';

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
    const label = typeof body.label === 'string' ? body.label.slice(0, 40) : '';
    const applicantName = typeof body.applicantName === 'string' ? body.applicantName.slice(0, 40) : '';
    const receiptNo = typeof body.receiptNo === 'string' ? body.receiptNo.slice(0, 30) : '';
    const days = Number.isFinite(Number(body.days)) && Number(body.days) > 0 ? Number(body.days) : 30;

    const result = generateInviteToken(days);
    const tokenId = result.inviteToken.split('.')[0];
    const { pw } = await registerToken(tokenId, { exp: result.exp, label, applicantName, receiptNo });

    return res.status(200).json({ pw, exp: result.exp, expiresAt: result.expiresAt });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : '코드 발급 실패' });
  }
}
