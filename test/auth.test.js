/**
 * 접속 인증 + 10일 만료 단위 테스트.
 * 실행: node test/auth.test.js
 */
import assert from 'node:assert/strict';

// 테스트용 환경변수 (실제 비밀 아님)
process.env.ACCESS_PASSWORD = 'test-pass';
process.env.AUTH_SECRET = 'unit-test-secret-key-0123456789';
process.env.ACCESS_DAYS = '10';
delete process.env.ACCESS_START;

const { verifyAccess, verifyToken, accessDays } = await import('../src/authService.js');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

const NOW = Date.parse('2026-05-30T00:00:00Z');

console.log('인증');
check('기본 유효일수 10', () => assert.equal(accessDays(), 10));
check('틀린 비밀번호 → 401', () => {
  const r = verifyAccess('wrong', NOW);
  assert.equal(r.ok, false); assert.equal(r.code, 401);
});
check('맞는 비밀번호 → 토큰 발급 + exp 미래', () => {
  const r = verifyAccess('test-pass', NOW);
  assert.equal(r.ok, true); assert.ok(r.token.includes('.'));
  assert.ok(r.exp * 1000 > NOW);
});
check('발급 토큰은 검증 통과', () => {
  const r = verifyAccess('test-pass', NOW);
  const v = verifyToken(r.token, NOW);
  assert.equal(v.valid, true); assert.equal(v.exp, r.exp);
});
check('10일 뒤에는 토큰 만료', () => {
  const r = verifyAccess('test-pass', NOW);
  const later = NOW + 10 * 86400000 + 1000;
  const v = verifyToken(r.token, later);
  assert.equal(v.valid, false); assert.equal(v.expired, true);
});
check('위조 토큰 → 무효', () => {
  const r = verifyAccess('test-pass', NOW);
  const tampered = r.token.slice(0, -2) + 'xx';
  assert.equal(verifyToken(tampered, NOW).valid, false);
});

console.log('전역 만료(ACCESS_START)');
check('시작일+10일 경과 시 발급 거부 → 403', () => {
  process.env.ACCESS_START = '2026-05-01T00:00:00Z'; // +10일 = 5/11 만료
  const r = verifyAccess('test-pass', Date.parse('2026-05-30T00:00:00Z'));
  assert.equal(r.ok, false); assert.equal(r.code, 403);
  delete process.env.ACCESS_START;
});

console.log('서버 미설정');
check('비밀번호 env 없으면 → 500', () => {
  const saved = process.env.ACCESS_PASSWORD;
  delete process.env.ACCESS_PASSWORD;
  const r = verifyAccess('x', NOW);
  assert.equal(r.code, 500);
  process.env.ACCESS_PASSWORD = saved;
});

console.log(`\n✅ auth.test.js — ${passed}개 통과`);
