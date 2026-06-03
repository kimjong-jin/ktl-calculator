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

export const PRECISION_CRITERIA = {
  repeatabilityRsd: 3.0,  // %
  zeroDrift:        5.0,  // %
  spanDrift:        5.0,  // %
  linearity:        5.0,  // %
  phTempComp:       0.1,  // pH 단위 (max - min)
  doTempComp:       5.0,  // % (측정범위 기준)
  codGlucose:       5.0,  // % (측정범위 기준, 미확인 시 사용)
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
export function repeatability(zVals, sVals, range) {
  const calc = (vals, r) => {
    if (!vals || vals.length < 2) return { mean: NaN, rsd: NaN, pass: null };
    const m = mean(vals), s = sampleStd(vals);
    const rsd = (r > 0) ? s / r * 100 : pct(s, m);
    return { mean: m, rsd, pass: rsd <= PRECISION_CRITERIA.repeatabilityRsd };
  };
  return { zero: calc(zVals, range), span: calc(sVals, range), limit: PRECISION_CRITERIA.repeatabilityRsd };
}

/* ── ② 드리프트 ────────────────────────────────────────────
 * TOC/TN/TP/SS/COD:
 *   zeroBefore=[Z2,Z3], zeroAfter=[Z4,Z5]
 *   spanBefore=[S2,S3], spanAfter=[S4,S5]
 *   drift = |평균After - 평균Before| / range * 100
 * pH/DO: 각 1개값 배열로 전달 */
export function drift(range, zeroBefore, zeroAfter, spanBefore, spanAfter, limits) {
  const zeroDrift = pct(mean(zeroAfter) - mean(zeroBefore), range);
  const spanDrift = pct(mean(spanAfter) - mean(spanBefore), range);
  const zeroLim = limits?.zero ?? PRECISION_CRITERIA.zeroDrift;
  const spanLim = limits?.span ?? PRECISION_CRITERIA.spanDrift;
  return {
    zeroDrift, spanDrift, zeroLim, spanLim,
    zeroPass: zeroDrift <= zeroLim,
    spanPass: spanDrift <= spanLim,
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
 * 허용 기준: TOC=배출기준or0.45, TN/TP/SS/COD=파라미터별 */
const FIELD_RULES = {
  TN:  { auto: 10,  limit: 1.5  },
  TP:  { auto: 0.4, limit: 0.06 },
  SS:  { auto: 5,   limit: 1.5  },
  COD: { auto: 20,  limit: 3.0  },
};

export function fieldApplication(parameter, labVals, siteVals, opts = {}) {
  const param = String(parameter).toUpperCase();
  const labMean  = mean(labVals.filter(v => v !== 0));
  const siteMean = mean(siteVals.filter(v => v !== 0));

  if (param === 'TOC') {
    const discharge = Number(opts.discharge) || 0;
    let limit;
    if (discharge > 0)
      limit = labMean < discharge * 0.5 ? discharge * 0.15 : labMean * 0.15;
    else
      limit = labMean <= 3 ? 0.45 : labMean * 0.15;
    return { parameter: param, labMean, siteMean, limit, auto: false,
      pass: Math.abs(labMean - siteMean) <= limit };
  }

  if (param === 'PH') {
    // pH 현장적용: |Ai평균 - Ci평균| ≤ 0.3 pH (엑셀 Fi 오차 기준)
    const limit = 0.3;
    return { parameter: param, labMean, siteMean, limit, auto: false,
      pass: Math.abs(labMean - siteMean) <= limit };
  }

  const rule = FIELD_RULES[param];
  if (!rule) return { parameter: param, labMean, siteMean, limit: null, auto: false, pass: null,
    note: '현장적용계수 기준 미정의' };

  if (labMean >= rule.auto)
    return { parameter: param, labMean, siteMean, limit: 0, auto: true, pass: true };
  return { parameter: param, labMean, siteMean, limit: rule.limit, auto: false,
    pass: Math.abs(labMean - siteMean) <= rule.limit };
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
