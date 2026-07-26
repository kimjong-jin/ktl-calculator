// ruleRegistry.js — 계산–규범 추적성(Computational-Normative Traceability)의 공통 키.
// 각 (측정항목 × 정도검사 검사항목)에 rule_id를 부여하고, 그 rule_id가
//   ① 계산(precision.js 계산식 + Version11 엑셀 판정식)  ← 계산 정합성
//   ② 규범(별표1의1 정도검사 세부기준 조문 + 시행버전)   ← 규범 정합성
// 을 동시에 가리킨다. 계산 결과 → rule_id → 조문 방향의 단방향 조회 전용(읽기전용).
// RAG/LLM은 이 레지스트리를 조회만 하고 계산·판정을 수정하지 않는다.
//
// ⚠️ 정도검사 전용. 형식승인(별표1 구조·성능)·성능시험(별표2)·간섭/전압/절연/등가입력 등은 제외.
// 기준값 출처: 환경측정기기 형식승인·정도검사 고시(국립환경과학원고시 제2025-51호, 2025.12.11 개정, 시행 2026.1.1)
//            별표 1의1(정도검사 세부기준) + 현장적용 기준(고시 표/엑셀 Version11 판정식) — 원문 대조 검증(2026-07-26).

export const LAW_META = {
  admrul: '2100000269484',
  name: '환경측정기기의 형식승인ㆍ정도검사 등에 관한 고시',
  no: '국립환경과학원고시 제2025-51호',
  amended: '2025-12-11',
  effective: '2026-01-01',
};

// 검사항목 코드 → 한글/영문 라벨
export const TEST = {
  REP:   { kr: '반복성',        en: 'repeatability' },
  ZDR:   { kr: '제로드리프트',  en: 'zero_drift' },
  SDR:   { kr: '스팬드리프트',  en: 'span_drift' },
  LIN:   { kr: '직선성',        en: 'linearity' },
  RESP:  { kr: '응답시간',      en: 'response_time' },
  TEMP:  { kr: '온도보상',      en: 'temperature_comp' },
  GLU:   { kr: '포도당변동성',  en: 'glucose_variability' },
  FIELD: { kr: '현장적용계수',  en: 'field_application' },
};

// 헬퍼: 규칙 1건 생성. 조문 = 별표1의1 「기기명」(항번) 형태.
const R = (id, code, test, formula, criterion, clause, calcRef, excelRef, extra = {}) => ({
  rule_id: id, code, test, test_kr: TEST[test].kr, test_en: TEST[test].en,
  formula, criterion,
  legal_reference: `별표 1의1 「${clause.dev}」 (${clause.n}) ${TEST[test].kr}`,
  regulation: LAW_META.no, regulation_version: LAW_META.effective,
  method_ref: '별표 2의1(정도검사 방법)', checklist_ref: clause.chk,
  calc_ref: calcRef,      // precision.js 함수
  excel_ref: excelRef,    // Version11 엑셀 판정 근거(계산 정합성)
  ...extra,
});

// 현장적용 기준(수분석값 임계 기반) — SS/TN/TP/COD. TOC는 배출허용기준 기반(별도).
// 출처: 고시 현장적용 표 + 엑셀 Version11 판정식(Sheet2!T20 등) 대조 검증.
const FIELD = (id, code, threshold, rateLimit, absLimit, clause, excelRef) =>
  R(id, code, 'FIELD', '|Ai−Ci| (수분석값 대비 상대/절대오차)',
    `수분석값 ≥ ${threshold} → 상대오차 ≤ ${rateLimit}% · < ${threshold} → 절대오차 ≤ ${absLimit}`,
    clause, 'fieldApplication', excelRef,
    { field_threshold: threshold, field_rate_limit: rateLimit, field_abs_limit: absLimit });

// 기본형(수질 TMS) 공통 정도검사 4종 기준: 반복성3%/제로5%/스팬5%/직선성±5% (측정범위·주입농도 기준)
const BASIC = (code, dev, chk) => [
  R(`WQ_${code}_REP_01`,  code, 'REP', 'SD / 측정범위 × 100', '측정범위의 3.0 % 이하',            {dev, n:2, chk}, 'repeatability', `Sheet1 ${code} 반복성`),
  R(`WQ_${code}_ZDR_01`,  code, 'ZDR', '|제로 평균 차| / 측정범위 × 100', '측정범위의 5.0 % 이하', {dev, n:3, chk}, 'drift.zero',    `Sheet1 ${code} 제로드리프트`),
  R(`WQ_${code}_SDR_01`,  code, 'SDR', '|스팬 평균 차| / 측정범위 × 100', '측정범위의 5.0 % 이하', {dev, n:4, chk}, 'drift.span',    `Sheet1 ${code} 스팬드리프트`),
  R(`WQ_${code}_LIN_01`,  code, 'LIN', '기준값(주입농도) 대비 최대 편차', '주입농도값의 ± 5.0 % 이내', {dev, n:5, chk}, 'linearity',  `Sheet1 ${code} 직선성`),
];

export const RULE_REGISTRY = {
  // ── 수질 TMS: 총유기탄소(TOC) — 현장적용은 배출허용기준 기반(별도) ──
  ...toMap([
    ...BASIC('TOC', '총유기탄소 연속자동측정기', '별표 3-3-1호'),
    R('WQ_TOC_RESP_01', 'TOC', 'RESP', 'ST→EN 응답 시간', '15 분(90 %) 이하', {dev:'총유기탄소 연속자동측정기', n:6, chk:'별표 3-3-1호'}, 'response', 'Sheet1 TOC 응답시간'),
    R('WQ_TOC_FIELD_01','TOC', 'FIELD', '|Ai−Ci| (배출허용기준 기반)',
      '배출기준 있고 수분석값<배출기준/2 → Fi/배출기준×100 ≤ 15 % · 수분석값 ≤ 3.0 → 절대 ≤ 0.45 · 그 외 → 상대 ≤ 15 %',
      {dev:'총유기탄소 연속자동측정기', n:12, chk:'별표 3-3-1호'}, 'fieldApplication', 'Sheet1 TOC 현장적용',
      { field_mode: 'discharge', field_rate_limit: 15, field_abs_limit: 0.45, field_abs_below: 3.0 }),
  ]),

  // ── 수질 TMS: 총질소(TN) ──
  ...toMap([
    ...BASIC('TN', '총질소 연속자동측정기', '별표 3-3-1호'),
    FIELD('WQ_TN_FIELD_01', 'TN', 10, 15, 1.5, {dev:'총질소 연속자동측정기', n:'현장적용', chk:'별표 3-3-1호'}, '고시 현장적용표(TN)'),
  ]),

  // ── 수질 TMS: 총인(TP) ──
  ...toMap([
    ...BASIC('TP', '총인 연속자동측정기', '별표 3-3-1호'),
    FIELD('WQ_TP_FIELD_01', 'TP', 0.4, 15, 0.06, {dev:'총인 연속자동측정기', n:9, chk:'별표 3-3-1호'}, '별표1의1 TP(9) + 고시 현장적용표'),
  ]),

  // ── 수질 TMS: 부유물질(SS) ──
  ...toMap([
    ...BASIC('SS', '부유물질 연속자동측정기', '별표 3-3-1호'),
    FIELD('WQ_SS_FIELD_01', 'SS', 5, 20, 1.0, {dev:'부유물질 연속자동측정기', n:'현장적용', chk:'별표 3-3-1호'}, '고시 현장적용표(SS)'),
  ]),

  // ── 수질 TMS: 화학적산소요구량(COD) ──
  ...toMap([
    ...BASIC('COD', '화학적산소요구량 연속자동측정기', '별표 3-3-1호'),
    R('WQ_COD_GLU_01', 'COD', 'GLU', '포도당 주입농도값 대비 편차', '주입농도값의 ± 5.0 % 이내', {dev:'화학적산소요구량 연속자동측정기', n:6, chk:'별표 3-3-1호'}, 'codGlucoseVariability', 'Sheet1 COD 포도당변동성'),
    FIELD('WQ_COD_FIELD_01', 'COD', 20, 15, 3.0, {dev:'화학적산소요구량 연속자동측정기', n:'현장적용', chk:'별표 3-3-1호'}, '엑셀 Version11 Sheet2!T20'),
  ]),

  // ── 수질 TMS: 수소이온농도(pH) — pH 단위 ──
  ...toMap([
    R('WQ_PH_REP_01',  'PH', 'REP',  'MAX(STDEV) (pH)', 'pH 0.10 이하',                {dev:'수소이온농도 연속자동측정기', n:2, chk:'별표 3-3-1호'}, 'phRepeatability', 'Sheet1 pH 반복성'),
    R('WQ_PH_ZDR_01',  'PH', 'ZDR',  '|제로(pH 6.88) 차|', 'pH 0.10 이하',             {dev:'수소이온농도 연속자동측정기', n:3, chk:'별표 3-3-1호'}, 'phDrift.zero',   'Sheet1 pH 제로드리프트'),
    R('WQ_PH_SDR_01',  'PH', 'SDR',  '|스팬(pH 4/10.07) 차|', 'pH 0.10 이하',          {dev:'수소이온농도 연속자동측정기', n:4, chk:'별표 3-3-1호'}, 'phDrift.span',   'Sheet1 pH 스팬드리프트'),
    R('WQ_PH_LIN_01',  'PH', 'LIN',  'pH 기준값 대비 편차', 'pH ± 0.10 이내',           {dev:'수소이온농도 연속자동측정기', n:5, chk:'별표 3-3-1호'}, 'phLinearity',    'Sheet1 pH 직선성'),
    R('WQ_PH_RESP_01', 'PH', 'RESP', 'ST→EN 응답 시간', '30 초 이하',                   {dev:'수소이온농도 연속자동측정기', n:6, chk:'별표 3-3-1호'}, 'response',       'Sheet1 pH 응답시간'),
    R('WQ_PH_TEMP_01', 'PH', 'TEMP', '온도별 편차', 'pH ± 0.10 이내',                    {dev:'수소이온농도 연속자동측정기', n:7, chk:'별표 3-3-1호'}, 'phTemperatureComp','Sheet1 pH 온도보상'),
  ]),

  // ── 수질 TMS: 용존산소(DO) — mg/L 절대, 직선성 없음 ──
  ...toMap([
    R('WQ_DO_REP_01',  'DO', 'REP',  'STDEV (mg/L)', '0.30 mg/L 이하',      {dev:'용존산소 연속자동측정기', n:2, chk:'별표 3-3-1호'}, 'doRepeatability', 'Sheet1 DO 반복성'),
    R('WQ_DO_ZDR_01',  'DO', 'ZDR',  '|제로 차|', '0.20 mg/L 이하',          {dev:'용존산소 연속자동측정기', n:3, chk:'별표 3-3-1호'}, 'doDrift.zero',   'Sheet1 DO 제로드리프트'),
    R('WQ_DO_SDR_01',  'DO', 'SDR',  '|스팬 차|', '0.30 mg/L 이하',          {dev:'용존산소 연속자동측정기', n:4, chk:'별표 3-3-1호'}, 'doDrift.span',   'Sheet1 DO 스팬드리프트'),
    R('WQ_DO_RESP_01', 'DO', 'RESP', 'ST→EN 응답 시간', '2 분 이하',          {dev:'용존산소 연속자동측정기', n:5, chk:'별표 3-3-1호'}, 'response',       'Sheet1 DO 응답시간'),
    R('WQ_DO_TEMP_01', 'DO', 'TEMP', '온도별 편차', '± 0.30 mg/L 이내',        {dev:'용존산소 연속자동측정기', n:7, chk:'별표 3-3-1호'}, 'doTemperatureComp','Sheet1 DO 온도보상'),
  ]),

  // ── 먹는물: 탁도(TU) — NTU ──
  ...toMap([
    R('DW_TU_REP_01',  'TU', 'REP',  'SD / 측정범위 × 100', '측정범위의 2.0 % 이하',       {dev:'탁도 연속자동측정기', n:3, chk:'별표 3-6-1호'}, 'repeatability', 'Sheet1 TU 반복성'),
    R('DW_TU_ZDR_01',  'TU', 'ZDR',  '|제로 차| / 측정범위 × 100', '측정범위의 3.0 % 이하', {dev:'탁도 연속자동측정기', n:4, chk:'별표 3-6-1호'}, 'drift.zero',    'Sheet1 TU 제로드리프트'),
    R('DW_TU_SDR_01',  'TU', 'SDR',  '|스팬 차| / 측정범위 × 100', '측정범위의 3.0 % 이하', {dev:'탁도 연속자동측정기', n:5, chk:'별표 3-6-1호'}, 'drift.span',    'Sheet1 TU 스팬드리프트'),
    R('DW_TU_LIN_01',  'TU', 'LIN',  '주입농도값 대비 편차', '주입농도값의 ± 5.0 % 이내',   {dev:'탁도 연속자동측정기', n:6, chk:'별표 3-6-1호'}, 'linearity',     'Sheet1 TU 직선성'),
    R('DW_TU_RESP_01', 'TU', 'RESP', 'ST→EN 응답 시간', '10 분(90 %) 이하',                {dev:'탁도 연속자동측정기', n:7, chk:'별표 3-6-1호'}, 'response',      'Sheet1 TU 응답시간'),
  ]),

  // ── 먹는물: 잔류염소(Cl) — NTU/mg/L. 스팬드리프트는 원문 재확인 필요(※) ──
  ...toMap([
    R('DW_CL_REP_01',  'CL', 'REP',  'SD / 측정범위 × 100', '측정범위의 2.0 % 이하',       {dev:'잔류염소 연속자동측정기', n:4, chk:'별표 3-6-1호'}, 'repeatability', 'Sheet1 Cl 반복성'),
    R('DW_CL_ZDR_01',  'CL', 'ZDR',  '|제로 차| / 측정범위 × 100', '측정범위의 3.0 % 이하', {dev:'잔류염소 연속자동측정기', n:5, chk:'별표 3-6-1호'}, 'drift.zero',    'Sheet1 Cl 제로드리프트'),
    R('DW_CL_LIN_01',  'CL', 'LIN',  '주입농도값 대비 편차', '주입농도값의 ± 5.0 % 이내',   {dev:'잔류염소 연속자동측정기', n:7, chk:'별표 3-6-1호'}, 'linearity',     'Sheet1 Cl 직선성'),
    R('DW_CL_RESP_01', 'CL', 'RESP', 'ST→EN 응답 시간', '2 분(90 %) 이하 (시약식 예외)',    {dev:'잔류염소 연속자동측정기', n:8, chk:'별표 3-6-1호'}, 'response',      'Sheet1 Cl 응답시간'),
  ]),
};

function toMap(arr) { const o = {}; for (const r of arr) o[r.rule_id] = r; return o; }

// 계산 결과(check label 등)로 rule_id 조회 — 판정레코드에 rule_id 부착용.
export function findRule(code, testCode) {
  const C = String(code || '').toUpperCase();
  for (const r of Object.values(RULE_REGISTRY)) if (r.code === C && r.test === testCode) return r;
  return null;
}
export function getRule(ruleId) { return RULE_REGISTRY[ruleId] || null; }

export default RULE_REGISTRY;
