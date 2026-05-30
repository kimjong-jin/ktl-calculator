/**
 * /api/admin — 관리자 전용 서비스 상태 API.
 * GET /api/admin  Authorization: Bearer <admin-token>
 * → { db, gemini, access, server, ts }
 */
import { verifyToken } from '../src/authService.js';
import {
  listTestItems,
  getSheetNames,
  getDataFileName,
} from '../src/excelClient.js';

function requireAdmin(req) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const result = verifyToken(token);
  return result.valid && result.role === 'admin';
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 허용됩니다.' });

  if (!requireAdmin(req)) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }

  // DB 상태
  let db = { connected: false };
  try {
    const items = listTestItems().filter(i => /[A-Za-z]/.test(i.item));
    db = {
      connected: true,
      fileName: getDataFileName(),
      sheetCount: getSheetNames().length,
      itemCount: items.length,
    };
  } catch (e) {
    db = { connected: false, error: e instanceof Error ? e.message.slice(0, 80) : '오류' };
  }

  // Gemini 상태 (키 존재 여부만, 실제 호출 안 함)
  const geminiKey = process.env.GEMINI_API_KEY;
  const gemini = {
    configured: !!geminiKey,
    status: geminiKey ? 'ok' : 'unconfigured',
  };

  // 접속 정책
  const days = (() => { const d = parseInt(process.env.ACCESS_DAYS || '10', 10); return Number.isFinite(d) && d > 0 ? d : 10; })();
  const startRaw = process.env.ACCESS_START || null;
  let globalExpiry = null;
  if (startRaw) {
    const t = Date.parse(startRaw);
    if (!Number.isNaN(t)) globalExpiry = new Date(t + days * 86_400_000).toISOString().slice(0, 10);
  }

  return res.status(200).json({
    db,
    gemini,
    access: {
      days,
      globalExpiry,
      userPwSet: !!process.env.ACCESS_PASSWORD,
      adminPwSet: !!process.env.ADMIN_PASSWORD,
    },
    server: {
      node: process.version,
      env: process.env.NODE_ENV || 'production',
    },
    ts: new Date().toISOString(),
  });
}
