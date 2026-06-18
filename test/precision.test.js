/**
 * 정도검사 상세 계산 엔진 단위 테스트.
 * 실행: node test/precision.test.js  (또는 npm test 에 포함)
 */
import assert from 'node:assert/strict';
import {
  mean, sampleStd, repeatability, drift, linearity, fieldApplication, total,
  doTemperatureComp,
  phRepeatability, phDrift, phLinearity, phTemperatureComp,
  doRepeatability, doDrift,
  waterResponse,
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
check('TOC 수분석 0 및 NaN 처리 적합', () => {
  // 0 is valid. Empty fields are NaN.
  const f = fieldApplication('TOC', [0, 0, NaN, NaN], [0, NaN]);
  assert.equal(f.pass, true);
  assert.equal(f.labMean, 0);
  assert.equal(f.siteMean, 0);
});
check('TOC 배출기준10 labMean2 (< 5): Fi/배출기준 기준 적합', () => {
  // labMean=2 < discharge/2=5 → Case 2: dischargeRate=0.3/10*100=3% ≤ 15 → 적합
  const f = fieldApplication('TOC', [2,2,2,2], [2.3,2.3], {discharge:10});
  assert.equal(f.useDischarge, true);
  assert.ok(near(f.dischargeRate, 3.0));
  assert.equal(f.pass, true);
});
check('TOC 배출기준10 labMean2 Fi큰경우: Fi/배출기준 > 15% → 부적합', () => {
  // Fi=2.0, dischargeRate=2/10*100=20 > 15 → 부적합
  const f = fieldApplication('TOC', [2,2,2,2], [4,4], {discharge:10});
  assert.equal(f.useDischarge, true);
  assert.ok(near(f.dischargeRate, 20.0));
  assert.equal(f.pass, false);
});
check('TOC labMean = 3.0 -> 절대오차 0.45 적용 (fi=0.5 -> 부적합)', () => {
  const f = fieldApplication('TOC', [3.0, 3.0], [2.5, 2.5]);
  assert.equal(f.useDischarge, false);
  assert.equal(f.limit, 0.45);
  assert.equal(f.pass, false);
});
check('TOC labMean = 3.0 -> 절대오차 0.45 적용 (fi=0.45 -> 적합)', () => {
  const f = fieldApplication('TOC', [3.0, 3.0], [2.55, 2.55]);
  assert.equal(f.useDischarge, false);
  assert.equal(f.limit, 0.45);
  assert.equal(f.pass, true);
});
check('TOC 변동성 큰 시료 -> rate <= 15% AND fi <= 0.5 (오차율 10%, 절대오차 0.4 -> 적합)', () => {
  const f = fieldApplication('TOC', [4.0, 4.0], [3.6, 3.6], { highVariability: true });
  assert.equal(f.highVariability, true);
  assert.equal(f.pass, true);
});
check('TOC 변동성 큰 시료 -> rate <= 15% AND fi <= 0.5 (오차율 10%, 절대오차 0.6 -> 부적합)', () => {
  const f = fieldApplication('TOC', [6.0, 6.0], [5.4, 5.4], { highVariability: true });
  assert.equal(f.highVariability, true);
  assert.equal(f.pass, false);
});
check('TOC ⑤ 변동성 큰 시료 → 15% AND 0.5mg/L 둘 다 (rate3%·Fi0.3 → 적합)', () => {
  const f = fieldApplication('TOC', [10,10,10,10], [10.3,10.3], { highVariability: true });
  assert.equal(f.highVariability, true);
  assert.ok(near(f.fi, 0.3)); assert.ok(near(f.rate, 3));
  assert.equal(f.pass, true);   // 3%≤15 AND 0.3≤0.5
});
check('TOC ⑤ 변동성 — 절대오차 0.6>0.5 → 부적합 (비율은 통과해도)', () => {
  const f = fieldApplication('TOC', [10,10,10,10], [10.6,10.6], { highVariability: true });
  assert.ok(near(f.fi, 0.6)); assert.ok(f.rate <= 15);
  assert.equal(f.pass, false);  // 절대오차 초과 → 둘 다 만족 실패
});
check('TOC ⑤ 변동성 — 비율 20%>15 → 부적합 (절대오차는 통과해도)', () => {
  const f = fieldApplication('TOC', [2,2,2,2], [2.4,2.4], { highVariability: true });
  assert.ok(near(f.fi, 0.4)); assert.ok(near(f.rate, 20));
  assert.equal(f.pass, false);  // 비율 초과 → 둘 다 만족 실패
});
check('TN 수분석≥10 → 상대오차 15% 기준 (오차0 → 적합)', () => {
  const f = fieldApplication('TN', [12, 12, 12, 12], [12, 12]);
  assert.equal(f.useRate, true); assert.equal(f.pass, true);
});
check('TP 수분석0.2 site0.5 → 0.3>0.06 부적합', () => {
  const f = fieldApplication('TP', [0.2, 0.2], [0.5, 0.5]);
  assert.ok(near(f.limit, 0.06)); assert.equal(f.pass, false);
});
check('TN 오차율 15.04% → 반올림 15.0 ≤15 적합 (엑셀 F19=ROUND(,1))', () => {
  // meanFi=1.504, meanRate=15.04% → ROUND(,1)=15.0 ≤ 15 → 적합 (반올림 안 하면 부적합)
  const f = fieldApplication('TN', [10, 10, 10, 10], [8.496, 8.496]);
  assert.equal(f.useRate, true);
  assert.ok(near(f.rate, 15.0));
  assert.equal(f.pass, true);
});
check('pH 현장적용계수 0.204 → 반올림 0.20 ≤0.2 적합 (엑셀 V68=ROUND(T67,2))', () => {
  const f = fieldApplication('PH', [7, 7, 7, 7], [7.204, 7.204]);
  assert.ok(near(f.fi, 0.20));
  assert.equal(f.limit, 0.20);
  assert.equal(f.pass, true);
});
check('미정의 파라미터 → pass null', () => {
  const f = fieldApplication('XYZ', [1], [1]);
  assert.equal(f.pass, null);
});

console.log('pH 전용 — 엑셀 Version11 절대 pH 단위 기준 (정렬 검증)');
check('pH 반복성 V40: MAX(STDEV(pH7), STDEV(pH4)) ≤ 0.1', () => {
  // pH4 그룹 STDEV=0.1(경계) → 적합, pH7 STDEV 더 작음
  const r = phRepeatability([7.00, 7.00, 7.00], [4.0, 4.1, 3.9]);
  assert.ok(near(r.span.std, 0.1));
  assert.equal(r.std, 0.10);
  assert.equal(r.pass, true);
  // STDEV 0.11 → 부적합
  const r2 = phRepeatability([7.00, 7.00, 7.00], [4.00, 4.13, 3.87]);
  assert.equal(r2.pass, false);
});
check('pH 드리프트 V44/V48: |AVG(후3)-AVG(초3)| ≤ 0.1 절대 (정규화 아님)', () => {
  // 제로 평균차 |7.5-7.0|=0.5 → 엑셀 절대기준 0.5>0.1 부적합 (옛 /14×100=3.6%면 적합이던 것)
  const d = phDrift([7.0,7.0,7.0],[7.5,7.5,7.5],[4.0,4.0,4.0],[4.05,4.05,4.05]);
  assert.equal(d.zero.val, 0.5);
  assert.equal(d.zero.pass, false);
  assert.equal(d.span.val, 0.05);
  assert.equal(d.span.pass, true);
  // 제로 평균차 0.10 경계 → 적합 (3회 평균)
  const d2 = phDrift([7.00,7.00,7.00],[7.10,7.10,7.10],[4.00,4.00,4.00],[4.05,4.05,4.05]);
  assert.equal(d2.zero.pass, true);
});
check('pH 직선성 V53: 버퍼별 3회 평균 |평균-공칭| 최대 ≤ 0.1', () => {
  // pH10 평균 10.1 → 편차 +0.1 경계 적합
  const l = phLinearity([4.0,4.0,4.0],[7.0,7.0,7.0],[10.1,10.1,10.1]);
  assert.ok(near(l.dev, 0.1));
  assert.equal(l.pass, true);
  // pH4 평균 4.2 → 편차 0.2 부적합 (옛 (max-min)/14×100과 다름)
  const l2 = phLinearity([4.2,4.2,4.2],[7.0,7.0,7.0],[10.0,10.0,10.0]);
  assert.equal(l2.pass, false);
});
check('pH 온도보상 V61: |측정-기준(4.00/4.01)| 최대 ≤ 0.2', () => {
  // 전부 기준과 동일 → 편차 0 적합
  const t = phTemperatureComp({ t10: 4.00, t15: 4.00, t20: 4.00, t25: 4.01, t30: 4.01 });
  assert.ok(near(t.dev, 0));
  assert.equal(t.pass, true);
  // 25℃가 4.19 → 기준 4.01 대비 +0.18 (≤0.2) 적합
  const t2 = phTemperatureComp({ t10: 4.00, t15: 4.00, t20: 4.00, t25: 4.19, t30: 4.01 });
  assert.ok(near(t2.dev, 0.18));
  assert.equal(t2.pass, true);
  // 30℃가 4.30 → +0.29 부적합 (옛 max-min≤0.1 방식과 다름)
  const t3 = phTemperatureComp({ t10: 4.00, t15: 4.00, t20: 4.00, t25: 4.01, t30: 4.30 });
  assert.equal(t3.pass, false);
  // 미완(4개만) → pass null
  const t4 = phTemperatureComp({ t10: 4.00, t15: 4.00, t20: 4.00, t25: 4.01 });
  assert.equal(t4.pass, null);
});

console.log('DO 전용 — 엑셀 Version11 절대 mg/L 기준 (정렬 검증, 3회평균)');
check('DO 반복성 Z40: ROUND(STDEV(S 3회),2) ≤ 0.3 (RSD 아님)', () => {
  // STDEV([8.2,8.4,8.6])=0.2 → 적합
  const r = doRepeatability([8.2, 8.4, 8.6]);
  assert.ok(near(r.std, 0.2));
  assert.equal(r.limit, 0.3);
  assert.equal(r.pass, true);
  // STDEV 0.4 → 부적합 (옛 RSD 0.4/20×100=2%면 적합이던 것)
  const r2 = doRepeatability([8.0, 8.4, 8.8]);
  assert.ok(near(r2.std, 0.4));
  assert.equal(r2.pass, false);
});
check('DO 드리프트 Z44/Z48: 제로 ≤0.2 / 스팬 ≤0.3 (3회평균 절대)', () => {
  // 제로 평균차 0.25 → 부적합(>0.2), 스팬 평균차 0.25 → 적합(≤0.3)
  const d = doDrift([8,8,8],[8.25,8.25,8.25],[8,8,8],[8.25,8.25,8.25]);
  assert.equal(d.zero.val, 0.25);
  assert.equal(d.zero.pass, false);   // 제로 기준 0.2
  assert.equal(d.span.val, 0.25);
  assert.equal(d.span.pass, true);    // 스팬 기준 0.3
});
console.log('⑤-DO 온도보상 (엑셀 Z53: 20℃×3·30℃×3 평균 |편차| ≤ 0.3 mg/L)');
check('DO 온도보상 — 20℃평균 9.2 → 편차 0.108→0.11 적합', () => {
  const t = doTemperatureComp([9.2, 9.2, 9.2], [7.6, 7.6, 7.6]);
  assert.ok(near(t.maxDev, 0.11));
  assert.equal(t.limit, 0.3);
  assert.equal(t.pass, true);
});
check('DO 온도보상 — 20℃평균 9.5 → 편차 0.41 >0.3 부적합', () => {
  const t = doTemperatureComp([9.5, 9.5, 9.5], [7.559, 7.559, 7.559]);
  assert.ok(near(t.maxDev, 0.41));
  assert.equal(t.pass, false);
});
check('DO 온도보상 — 음수 편차 -0.292 → -0.29 적합', () => {
  const t = doTemperatureComp([8.8, 8.8, 8.8], [7.559, 7.559, 7.559]);
  assert.ok(near(t.maxDev, -0.29));
  assert.equal(t.pass, true);
});

console.log('⑤ 통합');
check('통합: 드리프트/최종반복성/직선성 구조 반환', () => {
  const t = total({ range: 100, z1: 10, s1: 100,
    zSeq: [10, 10, 11, 11], sSeq: [100, 100, 101, 101], mVals: [45, 45, 45] });
  assert.ok(near(t.drift.zeroDrift, 1));      // |10.5-10|/100*100
  assert.ok(near(t.linearity.error, 0));
  assert.equal(typeof t.finalRepeatability.zero.pass, 'boolean');
});

console.log('먹는물 응답시간 (data.xlsx Sheet4: mm×6=초, 탁도≤600 / 잔류염소≤120)');
check('탁도 mm=100 → 600초 경계 적합 / mm=101 → 606초 부적합', () => {
  const a = waterResponse(100, NaN, true);   // TU
  assert.equal(a.mmSec, 600); assert.equal(a.limit, 600); assert.equal(a.pass, true);
  const b = waterResponse(101, NaN, true);
  assert.equal(b.pass, false);
});
check('잔류염소 mm=20 → 120초 적합 / mm=21 → 126초 부적합', () => {
  const a = waterResponse(20, NaN, false);   // CL
  assert.equal(a.mmSec, 120); assert.equal(a.limit, 120); assert.equal(a.pass, true);
  const b = waterResponse(21, NaN, false);
  assert.equal(b.pass, false);
});
check('초 직접입력 — 탁도 500초 적합 / 700초 부적합', () => {
  assert.equal(waterResponse(NaN, 500, true).pass, true);
  assert.equal(waterResponse(NaN, 700, true).pass, false);
});
check('시약식 skip → 해당없음(pass null)', () => {
  const r = waterResponse(50, NaN, true, true);
  assert.equal(r.skipped, true); assert.equal(r.pass, null);
});

console.log('⑥ 먹는물 TU/CL 전용');

// ── 반복성: 공식은 TMS와 동일 (RSD ≤ 3%, range 기준) ────────
check('TU 반복성 — Z [5.0,5.1,4.9] RSD 1% 적합', () => {
  // std=0.1, range=10 → rsd=1%
  const r = repeatability([5.0, 5.1, 4.9], [8.0, 8.1, 7.9], 10, 2.0);
  assert.ok(near(r.zero.rsd, 1));
  assert.equal(r.zero.pass, true);
  assert.equal(r.limit, 2.0);
});
check('TU 반복성 — RSD 2.5% 는 2% 기준 부적합 (수질TMS 3%는 적합)', () => {
  // [49, 51.5, 46.5]: std=2.5, range=100 → rsd=2.5%
  const rTU  = repeatability([49, 51.5, 46.5], [89, 89, 89], 100, 2.0);
  const rTMS = repeatability([49, 51.5, 46.5], [89, 89, 89], 100, 3.0);
  assert.ok(near(rTU.zero.rsd, 2.5));
  assert.equal(rTU.zero.pass,  false); // TU/CL 2% 기준 → 부적합
  assert.equal(rTMS.zero.pass, true);  // 수질TMS 3% 기준 → 적합
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
check('TU 직선성 — 오차 5.04% → 반올림 5.0 ≤5 적합 (엑셀 ROUND(,1))', () => {
  // |52.52-50|/50*100 = 5.04% → ROUND(,1)=5.0 ≤ 5 → 적합 (반올림 안 하면 부적합)
  const l = linearity(10, [52.52], 50);
  assert.ok(l.error > 5);
  assert.equal(l.pass, true);
});
check('TU 직선성 — ref 미지정 시 TMS 대체공식(range×0.45) 적용', () => {
  // linRef=undefined → reference = 0.9*10/2 = 4.5
  const l = linearity(10, [4.5]);
  assert.ok(near(l.ref, 4.5));
  assert.ok(near(l.error, 0));
  assert.equal(l.pass, true);
});

console.log(`\n✅ precision.test.js — ${passed}개 통과`);
