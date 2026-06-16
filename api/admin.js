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
import { registerToken, revokeToken, listTokens, clearAllTokens, clearTokensByIssuer, clearExpiredTokens } from '../src/tokenStore.js';
import { listTestItems, getSheetNames, getDataFileName } from '../src/excelClient.js';
import { getLimits, setLimit, getUsage, resetUsage } from '../src/chatRateLimit.js';
const _dbOk = existsSync(join(process.cwd(), 'Version11_(2026).xlsx'))
  || existsSync(join(process.cwd(), 'data.xlsx'));

/** 인증 토큰 검증 → { id } (id = 관리자 본인 이름, userAuth 로그인 시 존재) | null */
function adminIdentity(req) {
  const auth = (req.headers && req.headers['authorization']) || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const result = verifyToken(token);
  if (!result.valid || result.role !== 'admin') return null;
  return { id: result.id || '' };
}

function requireAdmin(req) {
  return !!adminIdentity(req);
}

// 전체 토큰을 조회할 수 있는 슈퍼관리자(소유자). 환경변수로 추가 가능.
const SUPER_ADMINS = (process.env.SUPER_ADMIN_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
// id가 명시적으로 존재하고 SUPER_ADMINS 배열에 포함된 경우에만 슈퍼관리자로 인정합니다.
const isSuperAdmin = (id) => {
  if (!id) return false;
  return SUPER_ADMINS.includes(id);
};

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
        // 발급자 = 인증된 본인 이름(우선). 레거시 공용 로그인은 클라이언트 힌트 사용.
        const issuer = adminIdentity(req)?.id || String(body?.issuer || '').trim();
        // Blob에 등록 — 단순 비밀번호 생성 후 반환
        const { pw } = await registerToken(result.inviteToken.split('.')[0], {
          exp: result.exp,
          label: body?.label || '',
          issuer,
        });
        return res.status(200).json({ ...result, pw, issuer });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '토큰 생성 실패' });
      }
    }

    // 토큰 즉시 무효화 (비-슈퍼관리자는 본인 발급분만 삭제 가능)
    if (body?.action === 'revoke_token') {
      const { tokenId } = body;
      if (!tokenId) return res.status(400).json({ error: 'tokenId 필수' });
      try {
        const id = adminIdentity(req)?.id || '';
        if (!isSuperAdmin(id)) {
          const all = await listTokens();
          const entry = all[tokenId];
          if (entry && (entry.issuer || '') !== id) {
            return res.status(403).json({ error: '본인이 발급한 코드만 삭제할 수 있습니다.' });
          }
        }
        const ok = await revokeToken(tokenId);
        return res.status(200).json({ ok, tokenId });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '실패' });
      }
    }

    // 전체 토큰 삭제 (비-슈퍼관리자는 본인 발급분만)
    if (body?.action === 'revoke_all') {
      try {
        const id = adminIdentity(req)?.id || '';
        if (isSuperAdmin(id)) await clearAllTokens();
        else await clearTokensByIssuer(id);
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '실패' });
      }
    }

    // 만료된 토큰 일괄 제거 (비-슈퍼관리자는 본인 발급분만)
    if (body?.action === 'clear_expired') {
      try {
        const id = adminIdentity(req)?.id || '';
        const issuer = isSuperAdmin(id) ? null : id;
        const count = await clearExpiredTokens(issuer);
        return res.status(200).json({ ok: true, count });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '실패' });
      }
    }

    // 챗봇 한도 설정
    if (body?.action === 'set_chat_limit') {
      const { userId, limit } = body;
      if (!userId) return res.status(400).json({ error: 'userId 필수' });
      if (limit !== null && (typeof limit !== 'number' || limit < 0))
        return res.status(400).json({ error: 'limit은 0 이상 숫자 또는 null' });
      try {
        const cfg = await setLimit(userId, limit);
        return res.status(200).json({ ok: true, cfg });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '실패' });
      }
    }

    // 챗봇 사용량 초기화
    if (body?.action === 'reset_chat_usage') {
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: 'userId 필수' });
      try {
        await resetUsage(userId);
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: e instanceof Error ? e.message : '실패' });
      }
    }

    return res.status(400).json({ error: '알 수 없는 action' });
  }

  // ── 토큰 목록 조회 (발급자별 격리) ────────────────────────
  // 슈퍼관리자(김종진/레거시)는 전체, 그 외 관리자는 본인 발급분만.
  if (req.method === 'GET' && req.query?.action === 'list_tokens') {
    const id = adminIdentity(req)?.id || '';
    const tokens = isSuperAdmin(id) ? await listTokens() : await listTokens(id);
    return res.status(200).json({ tokens, issuer: id, isSuper: isSuperAdmin(id) });
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

  const [chatLimits, chatUsage] = await Promise.all([getLimits(), getUsage()]);

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
    chatLimits,
    chatUsage,
    server: { node: process.version, env: process.env.NODE_ENV || 'production' },
    ts: new Date().toISOString(),
  });
}
