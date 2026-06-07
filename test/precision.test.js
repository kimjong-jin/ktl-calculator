/**
 * 정도검사 상세 계산 엔진 단위 테스트.
 * 실행: node test/precision.test.js  (또는 npm test 에 포함)
 */
import assert from 'node:assert/strict';
import {
  mean, sampleStd, repeatability, drift, linearity, fieldApplication, total,
} from '../src/precision.js';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('통계 헬퍼');
check('mean', () => assert.ok(near(mean([10, 20, 30]), 20)));
check('sampleStd ddof=1 ([100,102,98] → 2)', () => assert.ok(near(sampleStd([100, 102, 98]), 2)));
check('sampleStd 1개 → 0', () => assert.equal(sampleStd([5]), 0));

console.log('① 반복성 (RSD ≤ 3%)');
check('저농도 std0 → RSD 0 적합', () => {
  const r = repeatability([10, 10, 10], [100, 102, 98]);
  assert.ok(near(r.zero.rsd, 0)); assert.equal(r.zero.pass, true);
});
check('고농도 [100,102,98] → RSD 2% 적합', () => {
  const r = repeatability([10, 10, 10], [100, 102, 98]);
  assert.ok(near(r.span.rsd, 2)); assert.equal(r.span.pass, true);
});
check('[10,11,9] → RSD 10% 부적합', () => {
  const r = repeatability([10, 11, 9], [10, 11, 9]);
  assert.ok(near(r.zero.rsd, 10)); assert.equal(r.zero.pass, false);
});

console.log('② 드리프트 (≤ 5%)');
check('제로 1% 적합 / 스팬 10% 부적합', () => {
  const d = drift(100, [1, 1], [2, 2], [50, 50], [60, 60]);
  assert.ok(near(d.zeroDrift, 1)); assert.equal(d.zeroPass, true);
  assert.ok(near(d.spanDrift, 10)); assert.equal(d.spanPass, false);
});

console.log('③ 직선성 (≤ 5%)');
check('range100 → ref45, 평균45 오차0 적합', () => {
  const l = linearity(100, [45, 45, 45]);
  assert.ok(near(l.ref, 45)); assert.ok(near(l.error, 0)); assert.equal(l.pass, true);
});
check('평균50 → 오차 11.11% 부적합', () => {
  const l = linearity(100, [50, 50, 50]);
  assert.ok(near(l.error, (5 / 45) * 100)); assert.equal(l.pass, false);
});

console.log('④ 현장적용계수');
check('TOC 수분석2 → 허용 0.45, 동일값 적합', () => {
  const f = fieldApplication('TOC', [2, 2], [2, 2]);
  assert.ok(near(f.limit, 0.45)); assert.equal(f.pass, true);
});
check('TN 수분석≥10 → 상대오차 15% 기준 (오차0 → 적합)', () => {
  const f = fieldApplication('TN', [12, 12, 12, 12], [12, 12]);
  assert.equal(f.useRate, true); assert.equal(f.pass, true);
});
check('TP 수분석0.2 site0.5 → 0.3>0.06 부적합', () => {
  const f = fieldApplication('TP', [0.2, 0.2], [0.5, 0.5]);
  assert.ok(near(f.limit, 0.06)); assert.equal(f.pass, false);
});
check('미정의 파라미터 → pass null', () => {
  const f = fieldApplication('XYZ', [1], [1]);
  assert.equal(f.pass, null);
});

console.log('⑤ 통합');
check('통합: 드리프트/최종반복성/직선성 구조 반환', () => {
  const t = total({ range: 100, z1: 10, s1: 100,
    zSeq: [10, 10, 11, 11], sSeq: [100, 100, 101, 101], mVals: [45, 45, 45] });
  assert.ok(near(t.drift.zeroDrift, 1));      // |10.5-10|/100*100
  assert.ok(near(t.linearity.error, 0));
  assert.equal(typeof t.finalRepeatability.zero.pass, 'boolean');
});

console.log('⑥ 먹는물 TU/CL 전용');

// ── 반복성: 공식은 TMS와 동일 (RSD ≤ 3%, range 기준) ────────
check('TU 반복성 — Z [5.0,5.1,4.9] RSD 1% 적합', () => {
  // std=0.1, range=10 → rsd=1%
  const r = repeatability([5.0, 5.1, 4.9], [8.0, 8.1, 7.9], 10);
  assert.ok(near(r.zero.rsd, 1));
  assert.equal(r.zero.pass, true);
});
check('TU 반복성 — Z RSD 3.5% 부적합', () => {
  // std=0.35, range=10 → rsd=3.5% > 3%
  const r = repeatability([5.0, 5.35, 4.65], [10, 10, 10], 10);
  assert.ok(near(r.zero.rsd, 3.5));
  assert.equal(r.zero.pass, false);
});

// ── 드리프트: TU/CL 기준 ≤ 3% (TMS 5%와 구분) ──────────────
check('TU 드리프트 — 제로 2% 적합 (3% 기준)', () => {
  // |mean([3,3]) - mean([1,1])| / 100 * 100 = 2%
  const d = drift(100, [1, 1], [3, 3], [50, 50], [50, 50], { zero: 3, span: 3 });
  assert.ok(near(d.zeroDrift, 2));
  assert.equal(d.zeroPass, true);
});
check('TU 드리프트 — 경계값 3.0% 적합 (ROUND 3.0 ≤ 3)', () => {
  const d = drift(100, [1, 1], [4, 4], [50, 50], [50, 50], { zero: 3, span: 3 });
  assert.ok(near(d.zeroDrift, 3));
  assert.equal(d.zeroPass, true);
});
check('TU 드리프트 — 3.1% 부적합', () => {
  const d = drift(100, [1, 1], [4.1, 4.1], [50, 50], [50, 50], { zero: 3, span: 3 });
  assert.ok(near(d.zeroDrift, 3.1));
  assert.equal(d.zeroPass, false);
});
check('TU 드리프트 — 4% TMS기준(5%)이면 적합이나 먹는물(3%) 부적합', () => {
  const d = drift(100, [1, 1], [5, 5], [50, 50], [50, 50], { zero: 3, span: 3 });
  assert.ok(near(d.zeroDrift, 4));
  assert.equal(d.zeroPass, false);
  // 비교: TMS 5% 기준이면 통과했을 케이스임을 확인
  const dTms = drift(100, [1, 1], [5, 5], [50, 50], [50, 50]);
  assert.equal(dTms.zeroPass, true);
});

// ── 직선성: 기준값 = S1 ÷ 2 (TMS range×0.45와 구분) ─────────
check('TU 직선성 — S1=100, M=50 → 오차 0% 적합', () => {
  // ref = S1/2 = 50, error = |50-50|/50*100 = 0%
  const l = linearity(10, [50], 50);
  assert.ok(near(l.ref, 50));
  assert.ok(near(l.error, 0));
  assert.equal(l.pass, true);
});
check('TU 직선성 — 경계값 오차 5% 적합', () => {
  // M=52.5 → error = |52.5-50|/50*100 = 5.0% ≤ 5 → 적합
  const l = linearity(10, [52.5], 50);
  assert.ok(near(l.error, 5));
  assert.equal(l.pass, true);
});
check('TU 직선성 — 오차 5.1% 부적합', () => {
  const l = linearity(10, [52.55], 50);
  assert.ok(l.error > 5);
  assert.equal(l.pass, false);
});
check('TU 직선성 — S1=100, M=55 → 오차 10% 부적합', () => {
  const l = linearity(10, [55], 50);
  assert.ok(near(l.error, 10));
  assert.equal(l.pass, false);
});
check('TU 직선성 — ref 미지정 시 TMS 대체공식(range×0.45) 적용', () => {
  // linRef=undefined → reference = 0.9*10/2 = 4.5
  const l = linearity(10, [4.5]);
  assert.ok(near(l.ref, 4.5));
  assert.ok(near(l.error, 0));
  assert.equal(l.pass, true);
});

console.log(`\n✅ precision.test.js — ${passed}개 통과`);
