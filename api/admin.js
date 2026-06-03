/**
 * /api/admin — 관리자 전용 API.
 *
 *   GET  /api/admin          → 서비스 상태 조회
 *   POST /api/admin          { action:'generate_token', days? } → 고객 초대 토큰 생성
 *
 * Authorization: Bearer <admin-token> 필수.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { verifyToken, generateInviteToken } from '../src/authService.js';
import { registerToken, revokeToken } from '../src/tokenStore.js';
import { listTestItems, getSheetNames, getDataFileName } from '../src/excelClient.js';
const _dbOk = existsSync(join(process.cwd(), 'Version11_(2026).xlsx'))
  || existsSync(join(process.cwd(), 'data.xlsx'));

function requireAdmin(req) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const result = verifyToken(token);
  return result.valid && result.role === 'admin';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!requireAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  // ── 고객 초대 토큰 생성 ───────────────────────────────
  if (req.method === 'POST') {
    const body = await readBody(req);

    // 토큰 생성
    if (body?.action === 'generate_token') {
      try {
        const result = generateInviteToken(body?.days);
        // Blob에 등록
        await registerToken(result.inviteToken.split('.')[0], {
          exp: result.exp,
          label: body?.label || '',
        });
        return res.status(200).json(result);
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '토큰 생성 실패' });
      }
    }

    // 토큰 즉시 무효화
    if (body?.action === 'revoke_token') {
      const { tokenId } = body;
      if (!tokenId) return res.status(400).json({ error: 'tokenId 필수' });
      try {
        const ok = await revokeToken(tokenId);
        return res.status(200).json({ ok, tokenId });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '실패' });
      }
    }

    return res.status(400).json({ error: '알 수 없는 action' });
  }

  // ── 서비스 상태 조회 ─────────────────────────────────────────
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET/POST만 허용됩니다.' });

  let db = { connected: false };
  try {
    const items = listTestItems().filter(i => /[A-Za-z]/.test(i.item));
    db = { connected: true, fileName: getDataFileName(), sheetCount: getSheetNames().length, itemCount: items.length };
  } catch (e) {
    db = { connected: false, error: e instanceof Error ? e.message.slice(0, 80) : '오류' };
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const days = (() => { const d = parseInt(process.env.ACCESS_DAYS || '10', 10); return Number.isFinite(d) && d > 0 ? d : 10; })();
  const startRaw = process.env.ACCESS_START || null;
  let globalExpiry = null;
  if (startRaw) {
    const t = Date.parse(startRaw);
    if (!Number.isNaN(t)) globalExpiry = new Date(t + days * 86_400_000).toISOString().slice(0, 10);
  }

  const skillCtx = process.env.ADMIN_SKILL_CONTEXT || '';

  return res.status(200).json({
    db,
    gemini: { configured: !!geminiKey, status: geminiKey ? 'ok' : 'unconfigured' },
    skill: {
      envConfigured: !!skillCtx,
      charCount: skillCtx.length,
      preview: skillCtx.slice(0, 80) || null,
    },
    access: {
      days,
      globalExpiry,
      userPwSet: !!process.env.ACCESS_PASSWORD,
      adminPwSet: !!process.env.ADMIN_PASSWORD,
    },
    server: { node: process.version, env: process.env.NODE_ENV || 'production' },
    ts: new Date().toISOString(),
  });
}
