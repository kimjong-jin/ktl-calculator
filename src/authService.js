/**
 * 접속 인증 + 10일 만료 (서버사이드 전용, 순수 로직).
 *
 * 비밀은 환경변수로만 주입한다 (코드/깃에 절대 포함 금지):
 *   ACCESS_PASSWORD : 고객 접속 비밀번호 (필수)
 *   AUTH_SECRET     : 토큰 서명용 HMAC 키 (필수, 길게)
 *   ACCESS_START    : 사용 시작일 ISO (선택). 설정 시 전역 만료 = START + DAYS
 *   ACCESS_DAYS     : 유효일수 (선택, 기본 10)
 *
 * 토큰 형식: base64url(payloadJSON).base64url(HMAC-SHA256)
 *   payload = { exp: <만료 epoch초> }
 *
 * 주의: 계산은 클라이언트에서 수행되므로 이 게이트는 "억제 수준"이다.
 *       강한 강제(자산 자체 차단)는 Cloudflare Access 등 서버 게이팅이 필요.
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

/** 유효일수(기본 10). */
export function accessDays() {
  const d = parseInt(process.env.ACCESS_DAYS || '10', 10);
  return Number.isFinite(d) && d > 0 ? d : 10;
}

/** 전역 만료 시각(ms). ACCESS_START 미설정 시 null(=발급 시점 기준 만료). */
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

/** 토큰 검증 → { valid, exp } (만료/위조면 valid:false). */
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
  return { valid: true, exp: obj.exp };
}

/**
 * 비밀번호 검증 + 만료 판정 → 토큰 발급.
 * 반환: { ok, token?, exp?, error?, code? }
 */
export function verifyAccess(password, now = Date.now()) {
  const expected = process.env.ACCESS_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret) return { ok: false, code: 500, error: '서버 인증이 설정되지 않았습니다.' };
  if (!safeEqual(password, expected)) return { ok: false, code: 401, error: '비밀번호가 올바르지 않습니다.' };

  const gExp = globalExpiry();
  const expiryMs = gExp != null ? gExp : now + accessDays() * DAY_MS;
  if (now >= expiryMs) return { ok: false, code: 403, error: `사용 기간이 만료되었습니다 (${accessDays()}일).` };

  const exp = Math.floor(expiryMs / 1000);
  return { ok: true, token: sign({ exp }, secret), exp };
}
