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
  phTempComp:       0.1,   // pH — 엑셀 별도 기준, 고정
  doTempComp:       5.0,   // DO — 엑셀 별도 기준, 고정
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
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

const pct = (numer, denom) => (denom !== 0 ? Math.abs(numer / denom) * 100 : 0);

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
  const zeroDrift = pct(mean(zeroAfter) - mean(zeroBefore), range);
  const spanDrift  = pct(mean(spanAfter)  - mean(spanBefore),  range);
  const zeroLim = limits?.zero ?? PRECISION_CRITERIA.zeroDrift;
  const spanLim = limits?.span ?? PRECISION_CRITERIA.spanDrift;
  // 엑셀: ROUND(drift, 1) <= 5 기준
  const r1 = v => Math.round(v * 10) / 10;
  return {
    zeroDrift, spanDrift, zeroLim, spanLim,
    zeroPass: r1(zeroDrift) <= zeroLim,
    spanPass: r1(spanDrift) <= spanLim,
  };
}

/* ── ③ 직선성 ──────────────────────────────────────────────
 * TOC/TN/TP/SS/COD: ref = 0.9×range/2, 오차 = |avg-ref|/ref*100
 * pH: mVals=[4,7,10] 고정 3점, ref=7 (중간값), 오차=|avg-ref|/range×100
 * DO: max-min 방식 */
export function linearity(range, mVals, ref) {
  const avg = mean(mVals);
  const reference = ref !== undefined ? ref : (0.9 * range) / 2;
  const error = pct(avg - reference, reference);
  return { avg, ref: reference, error, pass: error <= PRECISION_CRITERIA.linearity };
}

/* ── ③-pH 직선성 (4·7·10 고정 3점) ────────────────────────
 * 엑셀: max=10, min=4 → 오차 = (max-min)/range×100 ≤ 5% */
export function phLinearity(vals) {
  // vals = [pH4측정, pH7측정, pH10측정]
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const range = 14; // pH 고정 측정범위
  const error = pct(maxV - minV, range);
  return { max: maxV, min: minV, error, pass: error <= PRECISION_CRITERIA.linearity };
}

/* ── ③-DO 직선성 ────────────────────────────────────────────
 * max-min / range * 100 ≤ 5% */
export function doLinearity(maxVal, minVal, range) {
  const error = pct(maxVal - minVal, range);
  return { max: maxVal, min: minVal, error, pass: error <= PRECISION_CRITERIA.linearity };
}

/* ── ④ pH 온도보상시험 ─────────────────────────────────────
 * 기준: pH 4.00 완충액, 각 온도별 측정값의 max-min ≤ 0.1
 * temps: { t10, t15, t20, t25, t30 } */
export function phTemperatureComp(temps) {
  const vals = Object.values(temps).filter(v => v !== 0 && Number.isFinite(v));
  if (!vals.length) return { max: null, min: null, range: null, pass: null };
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const range = maxV - minV;
  return {
    max: maxV, min: minV, range,
    pass: range <= PRECISION_CRITERIA.phTempComp,
  };
}

/* ── ⑤ DO 온도보상시험 ─────────────────────────────────────
 * 기준: 20℃=9.092, 30℃=7.559 vs 측정값, |오차|/span×100 ≤ 5%
 * opts: { m20, m30 } 실측값 */
export const DO_SPAN_TABLE = {
  25: 8.263, 20: 9.092, 30: 7.559,
};

export function doTemperatureComp(m20, m30, span = DO_SPAN_TABLE[25]) {
  const ref20 = DO_SPAN_TABLE[20];
  const ref30 = DO_SPAN_TABLE[30];
  const err20 = pct(m20 - ref20, span);
  const err30 = pct(m30 - ref30, span);
  return {
    t20: { measured: m20, ref: ref20, error: err20, pass: err20 <= PRECISION_CRITERIA.doTempComp },
    t30: { measured: m30, ref: ref30, error: err30, pass: err30 <= PRECISION_CRITERIA.doTempComp },
    pass: err20 <= PRECISION_CRITERIA.doTempComp && err30 <= PRECISION_CRITERIA.doTempComp,
  };
}

/* ── ⑥ COD 포도당변동성시험 ────────────────────────────────
 * max-min / range * 100 ≤ 기준 (보통 5%)
 * range는 COD 측정범위 */
export function codGlucoseVariability(maxVal, minVal, range) {
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
    const r2 = v => Math.round(v * 100) / 100;
    const r1 = v => Math.round(v * 10) / 10;
    const fi  = r2(meanFi);          // B16
    const rate = r1(meanRate);       // B18
    // Case 1 (엑셀 1순위): 배출기준 있고 labMean < 배출기준/2 → Fi/배출기준×100 ≤ 15%
    if (discharge > 0 && labMean < discharge / 2) {
      const dischargeRate = r1(fi / discharge * 100);   // B19
      return { parameter: param, labMean, siteMean, limit: 15, useRate: false,
               meanFi, meanRate, fi, rate, dischargeRate, discharge, useDischarge: true,
               auto: false, pass: dischargeRate <= 15 };
    }
    // Case 2: labMean < 3 → 절대오차 ≤ 0.45 mg/L
    // Case 3: else        → 상대오차 ≤ 15%
    let limit, useRate, pass;
    if (labMean < 3) {
      limit = 0.45; useRate = false; pass = fi <= 0.45;
    } else {
      limit = 15; useRate = true;  pass = rate <= 15;
    }
    return { parameter: param, labMean, siteMean, limit, useRate, meanFi, meanRate, fi, rate,
             useDischarge: false, auto: false, pass };
  }

  if (param === 'PH') {
    const limit = 0.20;
    return { parameter: param, labMean, siteMean, limit, useRate: false, meanFi, meanRate, auto: false,
      pass: meanFi <= limit };
  }

  const rule = FIELD_RULES[param];
  if (!rule) return { parameter: param, labMean, siteMean, limit: null, useRate: false, meanFi, meanRate,
    auto: false, pass: null, note: '현장적용계수 기준 미정의' };

  const useRate = labMean >= rule.threshold;
  const limit   = useRate ? rule.rateLimit : rule.absLimit;
  const pass    = useRate ? meanRate <= rule.rateLimit : meanFi <= rule.absLimit;
  return { parameter: param, labMean, siteMean, limit, useRate, meanFi, meanRate, auto: false, pass };
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
