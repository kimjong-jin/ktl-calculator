/**
 * KTL 정도검사 오차율 계산 엔진 (순수 함수).
 *
 * 오차율 = |측정값 - 표준값| / 표준값 × 100 (%)
 *
 * 합격 기준
 *  - TOC, TN, TP, SS, COD : 오차율 ±10% 이내
 *  - pH                    : 측정값-표준값 절대 편차 ±0.3 이내
 *  - DO                    : 측정값-표준값 절대 편차 ±0.5 이내
 */

/** 파라미터별 합격 기준 정의. */
const CRITERIA = {
  TOC: { type: 'rate', limit: 10, label: '±10%' },
  TN: { type: 'rate', limit: 10, label: '±10%' },
  TP: { type: 'rate', limit: 10, label: '±10%' },
  SS: { type: 'rate', limit: 10, label: '±10%' },
  COD: { type: 'rate', limit: 10, label: '±10%' },
  PH: { type: 'absolute', limit: 0.3, label: '±0.3' },
  DO: { type: 'absolute', limit: 0.5, label: '±0.5' },
};

/** 사용자가 입력한 파라미터 이름을 정규화한다 (대소문자/공백 무시). */
export function normalizeParameter(parameter) {
  if (typeof parameter !== 'string') return '';
  return parameter.trim().toUpperCase();
}

/** 지원하는 파라미터 목록을 반환한다. */
export function supportedParameters() {
  return Object.keys(CRITERIA);
}

/**
 * 오차율을 계산하고 합격 여부를 판정한다.
 *
 * @param {{ parameter: string, measured: number, standard: number }} input
 * @returns {{
 *   parameter: string,
 *   measured: number,
 *   standard: number,
 *   errorRate: string,
 *   deviation: string,
 *   criterion: string,
 *   judgment: '적합' | '부적합' | '-'
 * }}
 */
export function calculateAccuracy({ parameter, measured, standard }) {
  const key = normalizeParameter(parameter);

  if (typeof measured !== 'number' || Number.isNaN(measured)) {
    throw new Error('measured(측정값)는 숫자여야 합니다.');
  }
  if (typeof standard !== 'number' || Number.isNaN(standard)) {
    throw new Error('standard(표준값)는 숫자여야 합니다.');
  }
  if (standard === 0) {
    throw new Error('standard(표준값)는 0이 될 수 없습니다 (오차율 분모).');
  }

  const deviation = Math.abs(measured - standard);
  const errorRate = (deviation / Math.abs(standard)) * 100;

  const criteria = CRITERIA[key];

  // 기준이 정의되지 않은 파라미터: 수치는 계산하되 판정은 '-'.
  if (!criteria) {
    return {
      parameter: key,
      measured,
      standard,
      errorRate: errorRate.toFixed(2),
      deviation: deviation.toFixed(2),
      criterion: '기준 미정의',
      judgment: '-',
    };
  }

  const pass =
    criteria.type === 'rate'
      ? errorRate <= criteria.limit
      : deviation <= criteria.limit;

  return {
    parameter: key,
    measured,
    standard,
    errorRate: errorRate.toFixed(2),
    deviation: deviation.toFixed(2),
    criterion: criteria.label,
    judgment: pass ? '적합' : '부적합',
  };
}
