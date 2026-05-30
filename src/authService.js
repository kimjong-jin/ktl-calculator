/**
 * 접속 인증 + 역할 기반 접근 제어 (서버사이드 전용, 순수 로직).
 *
 * 환경변수:
 *   ACCESS_PASSWORD : 고객 접속 비밀번호
 *   ADMIN_PASSWORD  : 관리자 비밀번호 (설정 시 관리자 탭 활성화)
 *   AUTH_SECRET     : 토큰 서명용 HMAC 키 (필수, 길게)
 *   ACCESS_START    : 사용 시작일 ISO (선택). 설정 시 전역 만료 = START + DAYS
 *   ACCESS_DAYS     : 유효일수 (선택, 기본 10)
 *
 * 토큰 payload: { exp: <만료 epoch초>, role: 'user'|'admin' }
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

export function globalExpiry() {
  const start = process.env.ACCESS_START;
  if (!start) return null;
  const t = Date.parse(start);
  return Number.isNaN(t) ? null : t + accessDays() * DAY_MS;
}

function sign(payloadObj, secret) {
  const payload = b64url(JSON.stringify(payloadObj));
  const mac = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${mac}`;
}

/** 토큰 검증 → { valid, exp, role } */
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
  return { valid: true, exp: obj.exp, role: obj.role || 'user' };
}

/**
 * 비밀번호 검증 + 역할 판정 → 토큰 발급.
 * 반환: { ok, token?, exp?, role?, error?, code? }
 * - ADMIN_PASSWORD 일치 → role: 'admin', 30일 만료
 * - ACCESS_PASSWORD 일치 → role: 'user', ACCESS_DAYS 만료
 */
export function verifyAccess(password, now = Date.now()) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { ok: false, code: 500, error: '서버 인증이 설정되지 않았습니다.' };

  const adminPw = process.env.ADMIN_PASSWORD;
  const userPw = process.env.ACCESS_PASSWORD;

  if (!adminPw && !userPw) return { ok: false, code: 500, error: '서버 인증이 설정되지 않았습니다.' };

  // 관리자 비번 확인 (먼저)
  if (adminPw && safeEqual(password, adminPw)) {
    const exp = Math.floor((now + 30 * DAY_MS) / 1000);
    return { ok: true, token: sign({ exp, role: 'admin' }, secret), exp, role: 'admin' };
  }

  // 일반 사용자 비번 확인
  if (!userPw || !safeEqual(password, userPw)) {
    return { ok: false, code: 401, error: '비밀번호가 올바르지 않습니다.' };
  }

  const gExp = globalExpiry();
  const expiryMs = gExp != null ? gExp : now + accessDays() * DAY_MS;
  if (now >= expiryMs) return { ok: false, code: 403, error: `사용 기간이 만료되었습니다 (${accessDays()}일).` };

  const exp = Math.floor(expiryMs / 1000);
  return { ok: true, token: sign({ exp, role: 'user' }, secret), exp, role: 'user' };
}
