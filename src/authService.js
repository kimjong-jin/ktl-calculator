/**
 * 접속 인증 + 고객별 초대 링크 시스템 (서버사이드 전용).
 *
 * 환경변수:
 *   ADMIN_PASSWORD  : 관리자 비밀번호
 *   AUTH_SECRET     : 토큰 서명용 HMAC 키 (필수, 길게)
 *   ACCESS_DAYS     : 초대 토큰 기본 유효일수 (기본 10)
 *   ACCESS_PASSWORD : (레거시) 공용 비번 — 신규 설치는 사용 안 함
 *
 * 고객 접속 흐름:
 *   1. 관리자 → POST /api/admin/token → { inviteToken, exp }
 *   2. 링크: https://app/?t=<inviteToken> 고객에게 전달
 *   3. 고객이 링크 클릭 → 서버에서 HMAC 검증 → 세션 토큰 발급
 *
 * 초대 토큰 payload: { id: hex16, exp: epoch초, role: 'user' }
 * 세션 토큰 payload: { exp: epoch초, role: 'user'|'admin' }
 * 형식: base64url(JSON).base64url(HMAC-SHA256)
 */
import crypto from 'node:crypto';

const DAY_MS = 86_400_000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function accessDays() {
  const d = parseInt(process.env.ACCESS_DAYS || '10', 10);
  return Number.isFinite(d) && d > 0 ? d : 10;
}

export function sign(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const mac = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${mac}`;
}

/** 토큰/초대코드 검증 → { valid, exp, role, id? } */
export function verifyToken(token, now = Date.now()) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof token !== 'string' || !token.includes('.')) return { valid: false };
  const [payload, mac] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  if (!safeEqual(mac, expected)) return { valid: false };
  let obj;
  try { obj = JSON.parse(fromB64url(payload).toString('utf8')); } catch { return { valid: false }; }
  if (!obj || typeof obj.exp !== 'number') return { valid: false };
  if (now >= obj.exp * 1000) return { valid: false, exp: obj.exp, expired: true };
  return { valid: true, exp: obj.exp, role: obj.role || 'user', id: obj.id };
}

/**
 * 관리자가 고객 1명용 초대 토큰 생성.
 * 반환: { inviteToken, exp, expiresAt(ISO) }
 */
export function generateInviteToken(days, now = Date.now()) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET 미설정');
  const d = (Number.isFinite(Number(days)) && Number(days) > 0) ? Number(days) : accessDays();
  const id = crypto.randomBytes(16).toString('hex'); // 고객별 고유 식별자
  const exp = Math.floor((now + d * DAY_MS) / 1000);
  const inviteToken = sign({ id, exp, role: 'user' }, secret);
  return { inviteToken, exp, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * 비밀번호/초대코드 검증 → 세션 토큰 발급.
 * 입력:
 *   - ADMIN_PASSWORD  → role: 'admin'
 *   - 초대 토큰       → role: 'user' (HMAC 검증)
 *   - ACCESS_PASSWORD → role: 'user' (레거시)
 */
export function verifyAccess(password, now = Date.now(), id = '') {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { ok: false, code: 500, error: '서버 인증이 설정되지 않았습니다.' };

  // 1. 관리자 ID+PW (ADMIN_ID 설정된 경우 id 필수 일치)
  const adminPw = process.env.ADMIN_PASSWORD;
  const adminId = process.env.ADMIN_ID || '';
  const idMatch = adminId ? safeEqual(id, adminId) : true;
  if (adminPw && safeEqual(password, adminPw) && idMatch) {
    const exp = Math.floor((now + 30 * DAY_MS) / 1000);
    return { ok: true, token: sign({ exp, role: 'admin' }, secret), exp, role: 'admin' };
  }

  // 2. 고객 초대 토큰 (HMAC 서명 포함, '.' 구분자)
  if (typeof password === 'string' && password.includes('.')) {
    const v = verifyToken(password, now);
    if (v.valid && v.role === 'user') {
      // 초대 토큰 → 동일 만료의 세션 토큰 재발급 (id 포함 → rate limit 식별용)
      return { ok: true, token: sign({ id: v.id, exp: v.exp, role: 'user' }, secret), exp: v.exp, role: 'user' };
    }
    if (v.expired) return { ok: false, code: 403, error: '접속 코드가 만료되었습니다.' };
    // HMAC 실패 → 아래 레거시로 넘어가지 않고 바로 401
    return { ok: false, code: 401, error: '접속 코드가 올바르지 않습니다.' };
  }

  // 3. 레거시 공용 비번 (기존 고객 호환)
  const userPw = process.env.ACCESS_PASSWORD;
  if (userPw && safeEqual(password, userPw)) {
    const exp = Math.floor((now + accessDays() * DAY_MS) / 1000);
    return { ok: true, token: sign({ exp, role: 'user' }, secret), exp, role: 'user' };
  }

  return { ok: false, code: 401, error: '비밀번호 또는 접속 코드가 올바르지 않습니다.' };
}
