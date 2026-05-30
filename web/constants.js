/**
 * 프런트 공유 상수 — 항목 메타·기준 안내·파라미터 색상.
 *
 * 색상은 harness/rules/02_ktl_domain.md 파라미터 색상표를 그대로 따른다.
 * 계산/판정 로직은 서버 calculator.js 가 단일 출처이며 여기서는 표시용 메타만 둔다.
 */

/** 화면 표시용 검사 항목 9종. code 는 서버 파라미터 키와 일치. */
export const ITEMS = [
  { code: 'TOC', label: 'TOC (총유기탄소)', unit: 'mg/L' },
  { code: 'TN', label: 'TN (총질소)', unit: 'mg/L' },
  { code: 'TP', label: 'TP (총인)', unit: 'mg/L' },
  { code: 'SS', label: 'SS (부유물질)', unit: 'mg/L' },
  { code: 'PH', label: 'pH (수소이온농도)', unit: '' },
  { code: 'DO', label: 'DO (용존산소)', unit: 'mg/L' },
  { code: 'COD', label: 'COD (화학적산소요구량)', unit: 'mg/L' },
  { code: 'TU', label: '탁도 (Turbidity)', unit: 'NTU' },
  { code: 'CL', label: '잔류염소 (Residual Cl)', unit: 'mg/L' },
];

/** 합격 기준 안내 문구 (서버 calculator.js 의 CRITERIA 와 일치). */
export const CRITERIA_HINT = {
  TOC: '오차율 ±10% 이내 → 적합',
  TN: '오차율 ±10% 이내 → 적합',
  TP: '오차율 ±10% 이내 → 적합',
  SS: '오차율 ±10% 이내 → 적합',
  COD: '오차율 ±10% 이내 → 적합',
  PH: '절대 편차 ±0.3 이내 → 적합',
  DO: '절대 편차 ±0.5 이내 → 적합',
  TU: '판정 기준 미정의 · 수치만 계산',
  CL: '판정 기준 미정의 · 수치만 계산',
};

/** 파라미터별 액센트 색 (02_ktl_domain.md). data-param/--accent 에 사용. */
export const PARAM_COLOR = {
  TOC: '#6366f1',
  TN: '#3b82f6',
  TP: '#10b981',
  SS: '#f59e0b',
  PH: '#22c55e',
  DO: '#0ea5e9',
  COD: '#f97316',
  TU: '#ef4444',
  CL: '#14b8a6',
};

/** 판정 기준이 정의되지 않은(판정 비대상) 항목. */
export const UNJUDGED = new Set(['TU', 'CL']);

/** code 로 항목 메타를 찾는다 (없으면 첫 항목). */
export function itemByCode(code) {
  return ITEMS.find((i) => i.code === code) ?? ITEMS[0];
}
