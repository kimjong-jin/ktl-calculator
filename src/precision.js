/**
 * KTL 정도검사 상세 계산 엔진 (순수 함수).
 *
 * my-calc-app(Streamlit→Vanilla JS)의 계산 로직을 1:1 이식하되,
 * UI(HTML)와 분리해 입력 → 구조화된 결과(숫자/판정)만 반환한다.
 * 표시 형식(소수 자릿수 등)은 호출하는 UI 쪽에서 처리한다.
 *
 * 판정 기준(상수로 분리 — 고시 개정 시 여기만 수정):
 *  - 반복성 RSD ≤ 3.0%
 *  - 제로/스팬 드리프트 ≤ 5.0%
 *  - 직선성 오차 ≤ 5.0%
 *  ※ 참고: ~/coding/CLAUDE.md 고시 별표3 값(직선성 ±2%, 드리프트 ±2/±5%, 반복성 ±2%)과
 *    다를 수 있음. 현재는 기존 앱(my-calc-app)의 실제 동작값을 따른다. 확정 필요 시 상수만 교체.
 */

export const PRECISION_CRITERIA = {
  repeatabilityRsd: 3.0, // %
  zeroDrift: 5.0,        // %
  spanDrift: 5.0,        // %
  linearity: 5.0,        // %
  finalRepZero: 3.0,     // % (통합계산기 최종 반복성 — 저농도)
  finalRepSpan: 5.0,     // % (통합계산기 최종 반복성 — 고농도)
};

/* ── 통계 헬퍼 ─────────────────────────────────────────────── */
export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 표본 표준편차 (numpy std ddof=1 동일). 값 2개 미만이면 0. */
export function sampleStd(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

const pct = (numer, denom) => (denom !== 0 ? (numer / denom) * 100 : 0);

/* ── ① 반복성 (Repeatability) ──────────────────────────────────
 * RSD = std(ddof=1)/mean*100, 적합 ≤ 3.0%. 저농도(Z)·고농도(S) 각 3회. */
export function repeatability(zVals, sVals) {
  const zMean = mean(zVals), zRsd = pct(sampleStd(zVals), zMean);
  const sMean = mean(sVals), sRsd = pct(sampleStd(sVals), sMean);
  const limit = PRECISION_CRITERIA.repeatabilityRsd;
  return {
    zero: { mean: zMean, rsd: zRsd, pass: zRsd <= limit },
    span: { mean: sMean, rsd: sRsd, pass: sRsd <= limit },
    limit,
  };
}

/* ── ② 제로/스팬 드리프트 ──────────────────────────────────────
 * drift = |후평균 - 전평균| / 측정범위 * 100, 적합 ≤ 5.0%. */
export function drift(range, zeroBefore, zeroAfter, spanBefore, spanAfter) {
  const zeroDrift = pct(Math.abs(mean(zeroAfter) - mean(zeroBefore)), range);
  const spanDrift = pct(Math.abs(mean(spanAfter) - mean(spanBefore)), range);
  return {
    zeroDrift, spanDrift,
    zeroPass: zeroDrift <= PRECISION_CRITERIA.zeroDrift,
    spanPass: spanDrift <= PRECISION_CRITERIA.spanDrift,
  };
}

/* ── ③ 직선성 ──────────────────────────────────────────────────
 * 기준값 = 0.9 × 측정범위 / 2, 오차 = |평균-기준|/기준*100, 적합 ≤ 5.0%. */
export function linearity(range, mVals) {
  const avg = mean(mVals);
  const ref = (0.9 * range) / 2;
  const error = pct(Math.abs(avg - ref), ref);
  return { avg, ref, error, pass: error <= PRECISION_CRITERIA.linearity };
}

/* ── ④ 현장적용계수시험 ────────────────────────────────────────
 * 파라미터별 규칙. 적합 = |수분석평균 - 현장측정평균| ≤ 허용오차.
 * 일부 파라미터는 수분석 평균이 기준 이상이면 자동 적합. */
const FIELD_RULES = {
  TN: { auto: 10, limit: 1.5 },
  TP: { auto: 0.4, limit: 0.06 },
  SS: { auto: 5, limit: 1.5 },
  COD: { auto: 20, limit: 3.0 },
};

export function fieldApplication(parameter, labVals, siteVals, opts = {}) {
  const param = String(parameter).toUpperCase();
  const labMean = mean(labVals);
  const siteMean = mean(siteVals);

  if (param === 'TOC') {
    const discharge = Number(opts.discharge) || 0;
    let limit;
    if (discharge > 0) limit = labMean < discharge * 0.5 ? discharge * 0.15 : labMean * 0.15;
    else limit = labMean <= 3 ? 0.45 : labMean * 0.15;
    return { parameter: param, labMean, siteMean, limit, auto: false,
      pass: Math.abs(labMean - siteMean) <= limit };
  }

  const rule = FIELD_RULES[param];
  if (!rule) return { parameter: param, labMean, siteMean, limit: null, auto: false, pass: null,
    note: '현장적용계수 기준 미정의 파라미터' };

  if (labMean >= rule.auto) {
    return { parameter: param, labMean, siteMean, limit: 0, auto: true, pass: true };
  }
  return { parameter: param, labMean, siteMean, limit: rule.limit, auto: false,
    pass: Math.abs(labMean - siteMean) <= rule.limit };
}

/* ── ⑤ 통합 계산기 ─────────────────────────────────────────────
 * 드리프트 + 최종 반복성(가장 먼 ZZ/SS vs Z1/S1) + 직선성. */
export function total({ range, z1, s1, zSeq, sSeq, mVals }) {
  // zSeq = [z2,z3,z4,z5], sSeq = [s2,s3,s4,s5]
  const zz1 = mean([zSeq[0], zSeq[1]]), zz2 = mean([zSeq[2], zSeq[3]]);
  const ss1 = mean([sSeq[0], sSeq[1]]), ss2 = mean([sSeq[2], sSeq[3]]);

  const zeroDrift = pct(Math.abs(zz2 - zz1), range);
  const spanDrift = pct(Math.abs(ss2 - ss1), range);

  const maxZz = Math.max(Math.abs(zz1 - z1), Math.abs(zz2 - z1));
  const maxSs = Math.max(Math.abs(ss1 - s1), Math.abs(ss2 - s1));
  const repZ = z1 !== 0 ? (maxZz / z1) * 100 : Infinity;
  const repS = s1 !== 0 ? (maxSs / s1) * 100 : Infinity;

  const linAvg = mean(mVals);
  const linRef = (0.9 * range) / 2;
  const linErr = pct(Math.abs(linAvg - linRef), linRef);

  return {
    drift: { zeroDrift, spanDrift },
    finalRepeatability: {
      zero: { deviation: maxZz, pct: repZ, pass: repZ <= PRECISION_CRITERIA.finalRepZero },
      span: { deviation: maxSs, pct: repS, pass: repS <= PRECISION_CRITERIA.finalRepSpan },
    },
    linearity: { ref: linRef, avg: linAvg, error: linErr,
      pass: linErr <= PRECISION_CRITERIA.linearity },
  };
}
