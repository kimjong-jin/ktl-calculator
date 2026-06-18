/**
 * KTL 정도검사 상세 계산 엔진 (순수 함수).
 *
 * 엑셀 Version11_(2026).xlsx Sheet1 구조 기반으로 전면 재작성.
 *
 * 항목별 반복성 입력:
 *   TOC/TN/TP/SS/COD : Z1,Z3,Z5 / S1,S3,S5  (드리프트와 독립)
 *   pH               : 7,4,7 / 4,7,4          (6개 → 각 3개씩)
 *   DO               : S(25℃ 기준) 3회
 *
 * 드리프트 입력:
 *   TOC/TN/TP/SS/COD : 초기[Z2,Z3]/최종[Z4,Z5], 초기[S2,S3]/최종[S4,S5]
 *   pH               : 초기(드래프트초기Z), 2시간후(드리프트2hrZ) 각 1값
 *   DO               : 초기Z/2시간후Z, 초기S/2시간후S 각 1값
 *
 * 판정 기준 (고시 별표3):
 *   반복성 RSD ≤ 3.0%
 *   드리프트 ≤ 5.0%
 *   직선성 ≤ 5.0%
 *   pH 온도보상 max-min ≤ 0.1 pH
 *   DO 온도보상 ≤ 5.0% (측정범위 기준)
 */

import _criteria from './precision-criteria.json' with { type: 'json' };

// 엑셀 DB (Version11_(2026).xlsx) 에서 sync-excel.py 가 자동 추출한 기준값
// 변경 시: npm run sync-excel → git commit → Vercel 자동 배포
export const PRECISION_CRITERIA = {
  repeatabilityRsd: _criteria.repeatabilityRsd ?? 3.0,  // %
  zeroDrift:        _criteria.zeroDrift        ?? 5.0,  // %
  spanDrift:        _criteria.spanDrift        ?? 5.0,  // %
  linearity:        _criteria.linearity        ?? 5.0,  // %
  // ── pH 전용: 전부 절대 pH 단위 (엑셀 Version11 Sheet1 V40/V44/V48/V53/V61/V68) ──
  phRepeat:         0.1,   // pH 반복성 MAX(STDEV(pH7 3회), STDEV(pH4 3회)) ≤ 0.1 (V40)
  phDrift:          0.1,   // pH 드리프트 |평균(2h)-평균(초기)| ≤ 0.1 (제로 V44 / 스팬 V48)
  phLinearity:      0.1,   // pH 직선성 각 점(4·7·10) |측정-공칭| 최대 ≤ 0.1 (V53)
  phTempComp:       0.2,   // pH 온도보상 각 온도 |측정-기준(4.00/4.01)| 최대 ≤ 0.2 (V61)
  phField:          0.20,  // pH 현장적용 ROUND((Fi1+Fi2)/2,2) ≤ 0.2 (V68)
  // ── DO 전용: 전부 절대 mg/L (엑셀 Version11 Sheet1 Z40/Z44/Z48/Z53/Z54) ──
  doRepeat:         0.3,   // DO 반복성 ROUND(STDEV(S 3회),2) ≤ 0.3 (Z40)
  doZeroDrift:      0.2,   // DO 제로드리프트 |AVG(2h 3)-AVG(초기 3)| ≤ 0.2 (Z44)
  doSpanDrift:      0.3,   // DO 스팬드리프트 |AVG(2h 3)-AVG(초기 3)| ≤ 0.3 (Z48)
  doTempComp:       0.3,   // DO 온도보상 |편차| ≤ 0.3 mg/L 절대값 (엑셀 Z53/AB53)
  codGlucose:       5.0,
  // 반올림 자릿수 (엑셀 ROUND 수식에서 추출)
  repeatabilityRound: _criteria.repeatabilityRound ?? 1,
  driftRound:         _criteria.driftRound         ?? 1,
  linearityRound:     _criteria.linearityRound     ?? 1,
};

/* ── 통계 헬퍼 ─────────────────────────────────────────── */
export function mean(arr) {
  const a = arr.filter(v => Number.isFinite(v) && v !== 0 || v === 0);
  if (!a.length) return 0;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

export function sampleStd(arr) {
  // mean과 동일하게 non-finite(null/NaN/Infinity) 제외 — 안 거르면 null이 0으로 취급돼 표준편차 폭증
  const a = arr.filter(v => Number.isFinite(v));
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

const pct = (numer, denom) => (denom !== 0 ? Math.abs(numer / denom) * 100 : 0);
const roundTo = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

/* ── ① 반복성 ─────────────────────────────────────────────
 * TOC/TN/TP/SS/COD: [Z1,Z3,Z5] / [S1,S3,S5]
 * pH: zVals=[7측정값×3], sVals=[4측정값×3]
 * DO: zVals 무시, sVals=[S1,S3,S5] (Span 기준) */
// range 있으면 std/range×100 (수질TMS: 측정범위 기준), 없으면 std/mean×100 (pH 등)
export function repeatability(zVals, sVals, range, limit = PRECISION_CRITERIA.repeatabilityRsd) {
  const calc = (vals, r) => {
    if (!vals || vals.length < 2) return { mean: NaN, rsd: NaN, pass: null };
    const m = mean(vals), s = sampleStd(vals);
    const rsd = (r > 0) ? s / r * 100 : pct(s, m);
    const rsdRounded = Math.round(rsd * 10) / 10;
    return { mean: m, rsd, pass: rsdRounded <= limit };
  };
  return { zero: calc(zVals, range), span: calc(sVals, range), limit };
}

/* ── ② 드리프트 ────────────────────────────────────────────
 * TOC/TN/TP/SS/COD:
 *   zeroBefore=[Z2,Z3], zeroAfter=[Z4,Z5]
 *   spanBefore=[S2,S3], spanAfter=[S4,S5]
 *   drift = |평균After - 평균Before| / range * 100
 * pH/DO: 각 1개값 배열로 전달 */
export function drift(range, zeroBefore, zeroAfter, spanBefore, spanAfter, limits) {
  const cleanZB = (zeroBefore || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  const cleanZA = (zeroAfter || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  const cleanSB = (spanBefore || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  const cleanSA = (spanAfter || []).filter(v => v !== null && v !== undefined && !isNaN(v));

  const hasZero = cleanZB.length > 0 && cleanZA.length > 0;
  const hasSpan = cleanSB.length > 0 && cleanSA.length > 0;

  const zeroDrift = hasZero ? pct(mean(cleanZA) - mean(cleanZB), range) : NaN;
  const spanDrift  = hasSpan ? pct(mean(cleanSA) - mean(cleanSB), range) : NaN;
  const zeroLim = limits?.zero ?? PRECISION_CRITERIA.zeroDrift;
  const spanLim = limits?.span ?? PRECISION_CRITERIA.spanDrift;
  // 엑셀: ROUND(drift, 1) <= 5 기준
  const r1 = v => Math.round(v * 10) / 10;
  return {
    zeroDrift: hasZero ? zeroDrift : NaN,
    spanDrift: hasSpan ? spanDrift : NaN,
    zeroLim, spanLim,
    zeroPass: hasZero ? r1(zeroDrift) <= zeroLim : null,
    spanPass: hasSpan ? r1(spanDrift) <= spanLim : null,
  };
}

/* ── ③ 직선성 ──────────────────────────────────────────────
 * TOC/TN/TP/SS/COD: ref = 0.9×range/2, 오차 = |avg-ref|/ref*100
 * pH: mVals=[4,7,10] 고정 3점, ref=7 (중간값), 오차=|avg-ref|/range×100
 * DO: max-min 방식 */
export function linearity(range, mVals, ref) {
  const cleanM = (mVals || []).filter(v => v !== null && v !== undefined && !isNaN(v));
  const reference = ref !== undefined ? ref : (0.9 * range) / 2;
  if (cleanM.length === 0) {
    return { avg: NaN, ref: reference, error: NaN, pass: null };
  }
  const avg = mean(cleanM);
  const error = pct(avg - reference, reference);
  // 엑셀 직선성 값은 ROUND(오차,1) 후 판정 (D50/B33 등) — 경계 일치
  const errR = roundTo(error, PRECISION_CRITERIA.linearityRound);
  return { avg, ref: reference, error, pass: errR <= PRECISION_CRITERIA.linearity };
}

/* ── ①-pH 반복성 ───────────────────────────────────────────
 * 엑셀 Version11 V40: T40 = ROUND(MAX(STDEV(pH7 3회), STDEV(pH4 3회)), 2) ≤ 0.1
 * (RSD%가 아니라 절대 표준편차) */
export function phRepeatability(ph7Vals, ph4Vals, limit = PRECISION_CRITERIA.phRepeat) {
  const grp = (vals) => {
    const a = (vals || []).filter(v => Number.isFinite(v));
    return { mean: a.length ? mean(a) : NaN, std: a.length >= 2 ? sampleStd(a) : NaN, n: a.length };
  };
  const zero = grp(ph7Vals), span = grp(ph4Vals);
  const haveBoth = Number.isFinite(zero.std) && Number.isFinite(span.std);
  const maxStd = haveBoth ? Math.max(zero.std, span.std) : NaN;
  const stdR = Number.isFinite(maxStd) ? roundTo(maxStd, 2) : NaN;       // 엑셀 ROUND(,2)
  return { zero, span, maxStd, std: stdR, limit, pass: haveBoth ? stdR <= limit : null };
}

/* ── ②-pH 드리프트 ─────────────────────────────────────────
 * 엑셀 V44(제로 pH7)/V48(스팬 pH4): ROUND(|AVG(2시간후 3회)-AVG(초기 3회)|, 2) ≤ 0.1
 * (range로 나누지 않는 절대 pH 단위). 각 인자는 측정 배열. */
export function phDrift(zeroInit, zeroFinal, spanInit, spanFinal, limit = PRECISION_CRITERIA.phDrift) {
  const one = (init, fin) => {
    const ci = (init || []).filter(Number.isFinite);
    const cf = (fin || []).filter(Number.isFinite);
    if (!ci.length || !cf.length) return { val: NaN, pass: null, init: NaN, final: NaN };
    const mi = mean(ci), mf = mean(cf);
    const val = roundTo(Math.abs(mf - mi), 2);                           // 엑셀 ROUND(,2)
    return { val, pass: val <= limit, init: mi, final: mf };
  };
  return { zero: one(zeroInit, zeroFinal), span: one(spanInit, spanFinal), limit };
}

/* ── ③-pH 직선성 (4·7·10, 버퍼별 3회 평균) ────────────────
 * 엑셀 V53: 각 버퍼 (AVG측정-공칭) 편차의 max/min 중 절대값 큰 쪽(부호유지) → -0.1 ≤ x ≤ 0.1
 * 각 인자는 해당 버퍼 측정 배열 */
export function phLinearity(ph4Vals, ph7Vals, ph10Vals, limit = PRECISION_CRITERIA.phLinearity) {
  const nominal = [4, 7, 10];
  const avg = (a) => { const c = (a || []).filter(Number.isFinite); return c.length ? mean(c) : NaN; };
  const means = [avg(ph4Vals), avg(ph7Vals), avg(ph10Vals)];
  if (!means.every(Number.isFinite)) return { devs: [], means, dev: NaN, error: NaN, pass: null, limit };
  const devs = means.map((m, i) => m - nominal[i]);
  const maxDev = Math.max(...devs), minDev = Math.min(...devs);
  const dev = Math.abs(minDev) > Math.abs(maxDev) ? minDev : maxDev;     // 부호 유지
  return { devs, means, dev, error: dev, pass: dev >= -limit && dev <= limit, limit };
}

/* ── ③-DO 직선성 ────────────────────────────────────────────
 * max-min / range * 100 ≤ 5% */
export function doLinearity(maxVal, minVal, range) {
  if (maxVal === null || maxVal === undefined || isNaN(maxVal) ||
      minVal === null || minVal === undefined || isNaN(minVal)) {
    return { max: NaN, min: NaN, error: NaN, pass: null };
  }
  const error = pct(maxVal - minVal, range);
  const errR = roundTo(error, PRECISION_CRITERIA.linearityRound);
  return { max: maxVal, min: minVal, error, pass: errR <= PRECISION_CRITERIA.linearity };
}

/* ── ④ pH 온도보상시험 ─────────────────────────────────────
 * 엑셀 V61: 각 온도 측정값 − 기준완충액(10·15·20℃=4.00, 25·30℃=4.01) 편차의
 *           max/min 중 절대값 큰 쪽(부호유지) → -0.2 ≤ x ≤ 0.2
 * temps: { t10, t15, t20, t25, t30 } */
const PH_TEMP_REF = { t10: 4.00, t15: 4.00, t20: 4.00, t25: 4.01, t30: 4.01 };
export function phTemperatureComp(temps, limit = PRECISION_CRITERIA.phTempComp) {
  const keys = ['t10', 't15', 't20', 't25', 't30'];
  const present = keys.filter(k => Number.isFinite(temps[k]) && temps[k] !== 0);
  if (!present.length) return { devs: [], dev: null, max: null, min: null, pass: null, limit };
  const devs = present.map(k => temps[k] - PH_TEMP_REF[k]);
  const maxDev = Math.max(...devs), minDev = Math.min(...devs);
  const dev = Math.abs(minDev) > Math.abs(maxDev) ? minDev : maxDev;     // 부호 유지
  // 엑셀은 5개 온도 전부 입력돼야 판정(COUNTBLANK) — 미완 시 pass=null
  const complete = present.length === keys.length;
  return { devs, dev, max: maxDev, min: minDev, pass: complete ? (dev >= -limit && dev <= limit) : null, limit };
}

/* ── ⑤ DO 온도보상시험 ─────────────────────────────────────
 * 엑셀 Sheet1 Z52/Z53/AB53:
 *   편차20 = 20℃측정 − 9.092, 편차30 = 30℃측정 − 7.559
 *   Z53 = ROUND(|편차| 큰 쪽(부호 유지), 2)
 *   판정: -0.3 ≤ Z53 ≤ 0.3  (절대값 0.3 mg/L 기준, % 아님) */
export const DO_SPAN_TABLE = {
  25: 8.263, 20: 9.092, 30: 7.559,
};

// DO 반복성: 엑셀 Z40 = ROUND(STDEV(S 3회), 2) ≤ 0.3 (절대 mg/L, RSD 아님)
export function doRepeatability(sVals, limit = PRECISION_CRITERIA.doRepeat) {
  const a = (sVals || []).filter(Number.isFinite);
  if (a.length < 2) return { mean: NaN, std: NaN, limit, pass: null };
  const std = roundTo(sampleStd(a), 2);                                  // 엑셀 ROUND(,2)
  return { mean: mean(a), std, limit, pass: std <= limit };
}

// DO 드리프트: 엑셀 Z44(제로 ≤0.2)/Z48(스팬 ≤0.3) = ROUND(|AVG(2h 3)-AVG(초기 3)|, 2)
export function doDrift(zeroInit, zeroFinal, spanInit, spanFinal,
                        zeroLimit = PRECISION_CRITERIA.doZeroDrift, spanLimit = PRECISION_CRITERIA.doSpanDrift) {
  const one = (init, fin, lim) => {
    const ci = (init || []).filter(Number.isFinite), cf = (fin || []).filter(Number.isFinite);
    if (!ci.length || !cf.length) return { val: NaN, pass: null, init: NaN, final: NaN, limit: lim };
    const mi = mean(ci), mf = mean(cf);
    const val = roundTo(Math.abs(mf - mi), 2);                           // 엑셀 ROUND(,2)
    return { val, pass: val <= lim, init: mi, final: mf, limit: lim };
  };
  return { zero: one(zeroInit, zeroFinal, zeroLimit), span: one(spanInit, spanFinal, spanLimit), zeroLimit, spanLimit };
}

// DO 온도보상: 엑셀 Z53 = max((AVG(20℃ 3)-9.092),(AVG(30℃ 3)-7.559)) 중 절대값 큰 쪽 ROUND(,2), -0.3≤x≤0.3
export function doTemperatureComp(t20Vals, t30Vals, limit = PRECISION_CRITERIA.doTempComp) {
  const avg = (a) => { const c = (a || []).filter(Number.isFinite); return c.length ? mean(c) : NaN; };
  const m20 = avg(t20Vals), m30 = avg(t30Vals);
  const ref20 = DO_SPAN_TABLE[20], ref30 = DO_SPAN_TABLE[30];           // 9.092 / 7.559
  if (!Number.isFinite(m20) || !Number.isFinite(m30)) {
    return { t20: { measured: m20, ref: ref20, dev: NaN }, t30: { measured: m30, ref: ref30, dev: NaN }, maxDev: NaN, limit, pass: null };
  }
  const dev20 = m20 - ref20, dev30 = m30 - ref30;                       // 편차(mg/L, 부호)
  const hi = Math.max(dev20, dev30), lo = Math.min(dev20, dev30);
  const maxDev = roundTo(Math.abs(hi) >= Math.abs(lo) ? hi : lo, 2);
  return {
    t20: { measured: m20, ref: ref20, dev: dev20 },
    t30: { measured: m30, ref: ref30, dev: dev30 },
    maxDev, limit, pass: maxDev >= -limit && maxDev <= limit,
  };
}

/* ── ⑥ COD 포도당변동성시험 ────────────────────────────────
 * max-min / range * 100 ≤ 기준 (보통 5%)
 * range는 COD 측정범위 */
export function codGlucoseVariability(maxVal, minVal, range) {
  if (maxVal === null || maxVal === undefined || isNaN(maxVal) ||
      minVal === null || minVal === undefined || isNaN(minVal)) {
    return { max: NaN, min: NaN, error: NaN, pass: null };
  }
  const error = pct(maxVal - minVal, range);
  return {
    max: maxVal, min: minVal, error,
    pass: error <= PRECISION_CRITERIA.codGlucose,
  };
}

/* ── ⑦ 현장적용계수 ─────────────────────────────────────────
 * labVals=[Ai1,Ai2,Ai3,Ai4], siteVals=[Ci1,Ci2]
 * 엑셀 Sheet2 행20 수식 기준:
 *   labMean < threshold → 절대오차(mg/L) ≤ absLimit
 *   labMean ≥ threshold → 상대오차(%)   ≤ rateLimit
 * 오차는 회차별(round) 계산: round1=mean(Ai1,Ai2) vs Ci1, round2=mean(Ai3,Ai4) vs Ci2 */
const FIELD_RULES = {
  TN:  { threshold: 10,  absLimit: 1.5,  rateLimit: 15 },
  TP:  { threshold: 0.4, absLimit: 0.06, rateLimit: 15 },
  SS:  { threshold: 5,   absLimit: 1.0,  rateLimit: 20 },
  COD: { threshold: 20,  absLimit: 3.0,  rateLimit: 15 },
};

export function fieldApplication(parameter, labVals, siteVals, opts = {}) {
  const param = String(parameter).toUpperCase();

  // Filter out NaN / null / undefined / empty values, keeping 0
  const cleanLabVals = labVals.filter(v => v !== null && v !== undefined && !isNaN(v) && v !== '');
  const cleanSiteVals = siteVals.filter(v => v !== null && v !== undefined && !isNaN(v) && v !== '');

  const labMean  = mean(cleanLabVals);
  const siteMean = mean(cleanSiteVals);

  // 회차별 Ai 평균 및 오차 계산
  const r1Vals = [labVals[0], labVals[1]].filter(v => v !== null && v !== undefined && !isNaN(v) && v !== '');
  const r2Vals = [labVals[2], labVals[3]].filter(v => v !== null && v !== undefined && !isNaN(v) && v !== '');

  const hasTwoRounds = r2Vals.length > 0;
  const r1Ai = mean(r1Vals);
  const r2Ai = hasTwoRounds ? mean(r2Vals) : r1Ai;

  const ci1  = cleanSiteVals[0] !== undefined ? cleanSiteVals[0] : 0;
  const ci2  = hasTwoRounds ? (cleanSiteVals[1] !== undefined ? cleanSiteVals[1] : ci1) : ci1;

  const fi1  = Math.abs(r1Ai - ci1);
  const fi2  = Math.abs(r2Ai - ci2);
  const meanFi   = hasTwoRounds ? (fi1 + fi2) / 2 : fi1;

  const rate1    = r1Ai > 0 ? fi1 / r1Ai * 100 : (r1Ai === 0 && fi1 === 0 ? 0 : Infinity);
  const rate2    = r2Ai > 0 ? fi2 / r2Ai * 100 : (r2Ai === 0 && fi2 === 0 ? 0 : Infinity);
  const meanRate = hasTwoRounds ? (rate1 + rate2) / 2 : rate1;

  if (param === 'TOC') {
    // 엑셀 Sheet2 D20 판정 수식 (각 단계 ROUND 동일 적용)
    //   B16 = ROUND(meanFi, 2)             — 절대오차(mg/L)
    //   B18 = ROUND(meanRate, 1)           — 상대오차(%)
    //   B19 = ROUND(B16/배출기준*100, 1)    — 배출기준 대비(%)
    const discharge = Number(opts.discharge) || 0;
    const highVar = !!opts.highVariability;
    const r2 = v => Math.round(v * 100) / 100;
    const r1 = v => Math.round(v * 10) / 10;
    const fi  = r2(meanFi);          // B16
    const rate = r1(meanRate);       // B18

    // Case 5: 변동성이 큰 시료인 경우 → 15.0% 이하와 절대값 0.5 mg/L 이하를 모두 만족해야 함
    if (highVar) {
      const pass = rate <= 15.0 && fi <= 0.5;
      return { parameter: param, labMean, siteMean, limit: 15, useRate: true,
               meanFi, meanRate, fi, rate, discharge, useDischarge: false,
               highVariability: true, auto: false, pass };
    }

    // Case 1 (엑셀 1순위): 배출기준 있고 labMean < 배출기준/2 → Fi/배출기준×100 ≤ 15%
    if (discharge > 0 && labMean < discharge / 2) {
      const dischargeRate = r1(fi / discharge * 100);   // B19
      return { parameter: param, labMean, siteMean, limit: 15, useRate: false,
               meanFi, meanRate, fi, rate, dischargeRate, discharge, useDischarge: true,
               highVariability: false, auto: false, pass: dischargeRate <= 15 };
    }
    // Case 2: labMean <= 3.0 → 절대오차 ≤ 0.45 mg/L (주의: 고시 기준은 "3.0 mg/L 이하")
    // Case 3: else        → 상대오차 ≤ 15%
    let limit, useRate, pass;
    if (labMean <= 3.0) {
      limit = 0.45; useRate = false; pass = fi <= 0.45;
    } else {
      limit = 15; useRate = true;  pass = rate <= 15;
    }
    return { parameter: param, labMean, siteMean, limit, useRate, meanFi, meanRate, fi, rate,
             useDischarge: false, highVariability: false, auto: false, pass };
  }

  if (param === 'PH') {
    const limit = 0.20;
    // 엑셀 Version11 Sheet1 V68 = ROUND((Fi1+Fi2)/2,2)=T68 후 ≤0.2 판정 (엑셀 SSOT 일치)
    const fi = Math.round(meanFi * 100) / 100;
    return { parameter: param, labMean, siteMean, limit, useRate: false, meanFi, meanRate, fi, auto: false,
      pass: fi <= limit };
  }

  const rule = FIELD_RULES[param];
  if (!rule) return { parameter: param, labMean, siteMean, limit: null, useRate: false, meanFi, meanRate,
    auto: false, pass: null, note: '현장적용계수 기준 미정의' };

  // 엑셀과 동일: 절대오차 ROUND(,2)=F17, 오차율 ROUND(,1)=F19 로 반올림 후 비교
  const fi   = Math.round(meanFi * 100) / 100;
  const rate = Math.round(meanRate * 10) / 10;
  const useRate = labMean >= rule.threshold;
  const limit   = useRate ? rule.rateLimit : rule.absLimit;
  const pass    = useRate ? rate <= rule.rateLimit : fi <= rule.absLimit;
  return { parameter: param, labMean, siteMean, limit, useRate, meanFi, meanRate, fi, rate, auto: false, pass };
}

/* ── ⑧ 통합 계산기 (기존 호환) ──────────────────────────── */
export function total({ range, z1, s1, zSeq, sSeq, mVals }) {
  const zz1 = mean([zSeq[0], zSeq[1]]), zz2 = mean([zSeq[2], zSeq[3]]);
  const ss1 = mean([sSeq[0], sSeq[1]]), ss2 = mean([sSeq[2], sSeq[3]]);
  const zeroDrift = pct(zz2 - zz1, range);
  const spanDrift = pct(ss2 - ss1, range);
  const maxZz = Math.max(Math.abs(zz1 - z1), Math.abs(zz2 - z1));
  const maxSs = Math.max(Math.abs(ss1 - s1), Math.abs(ss2 - s1));
  const repZ = z1 !== 0 ? (maxZz / z1) * 100 : Infinity;
  const repS = s1 !== 0 ? (maxSs / s1) * 100 : Infinity;
  const linAvg = mean(mVals);
  const linRef = (0.9 * range) / 2;
  const linErr = pct(linAvg - linRef, linRef);
  return {
    drift: { zeroDrift, spanDrift },
    finalRepeatability: {
      zero: { deviation: maxZz, pct: repZ, pass: repZ <= 3.0 },
      span: { deviation: maxSs, pct: repS, pass: repS <= 5.0 },
    },
    linearity: { ref: linRef, avg: linAvg, error: linErr, pass: linErr <= 5.0 },
  };
}
