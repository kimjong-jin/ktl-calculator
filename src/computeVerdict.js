// src/computeVerdict.js
// 서버용 순수 판정 계산. web/precision-ui.js 의 buildCertResultRows(3872-3955) + updateFinal(1196-1223)
// + 항목별 requiredPasses(calcBasic/calcPH/calcDO/calcWater) 를 1:1 미러한 것.
// precision.js(고시 기준값 단일출처: precision-criteria.json)를 그대로 재사용. DOM 의존 0.
// → 계산기 UI·parser·인증서가 모두 이 한 벌을 쓴다. 고시 개정 시 precision-criteria.json 만 갱신.
import {
  repeatability, drift, linearity, fieldApplication, codGlucoseVariability, waterResponse,
  phRepeatability, phDrift, phLinearity, phTemperatureComp,
  doRepeatability, doDrift, doTemperatureComp,
  PRECISION_CRITERIA,
} from './precision.js';
// rule_id 부착용(계산–규범 추적성). 조회 전용 — 계산·판정에 관여하지 않음.
import { findRule } from './ruleRegistry.js';

const IS_PH    = c => c === 'PH';
const IS_DO    = c => c === 'DO';
const IS_COD   = c => c === 'COD';
const IS_WATER = c => ['TU', 'CL'].includes(c); // 먹는물

// precision-ui.js pickRepVals(785-801) 복제
// ⚠️ gd()는 빈값을 null 로 반환 → isNaN(null)===false 라 빈 z6/z7을 '값 있음'으로 오판하던 버그.
//    Number.isFinite 로 판정해야 null/NaN 둘 다 빈값으로 처리됨(반복성 RSD가 0으로 나오던 원인).
function pickRepVals(z5, z6, z7, initVals, finVals) {
  if (!Number.isFinite(z5)) return [];
  const z6ok = Number.isFinite(z6), z7ok = Number.isFinite(z7);
  if (z6ok && z7ok) return [z5, z6, z7];
  const iv = initVals.filter(v => Number.isFinite(v)), fv = finVals.filter(v => Number.isFinite(v));
  if (!iv.length || !fv.length) return [z5];
  let best = { s: -1, a: null, b: null };
  for (const a of iv) for (const b of fv) {
    const m = (z5 + a + b) / 3, s = Math.sqrt(((z5 - m) ** 2 + (a - m) ** 2 + (b - m) ** 2) / 2);
    if (s > best.s) best = { s, a, b };
  }
  return [z5, best.a, best.b];
}

// 종합 pass (updateFinal): false→'bad', 미입력(null)→''(미완성), 전부통과→'ok'
function finalPass(passes) {
  if (passes.some(p => p === false)) return 'bad';
  if (passes.some(p => p === null || p === undefined)) return '';
  return passes.length > 0 ? 'ok' : '';
}

/**
 * 한 항목(tab)의 정도검사 판정.
 * @param {string} code  TOC/TN/TP/SS/PH/DO/COD/TU/CL
 * @param {object} d     입력 dataObject(문자열/불린 값 맵) = calc_data.data.fields[tabId]
 * @returns {{code, checks:[{label,value,pass}], pass:'ok'|'bad'|'', field:object|null}}
 *   pass  = 정도검사 종합(계산하기용). field = 현장적용계수 결과(현장계수 수분석용, 종합엔 미포함).
 */
export function computeVerdict(code, d = {}) {
  d = d || {};
  const gd = f => { const v = parseFloat(d[f]); return Number.isFinite(v) ? v : null; };
  const gb = f => d[f] === true || d[f] === 'true'; // 체크박스
  const checks = [];
  // testCode(REP/ZDR/SDR/LIN/RESP/TEMP/GLU/FIELD)가 있으면 rule_id 부착. 계산값/pass는 불변.
  const add = (label, value, pass, testCode) => {
    const rule = testCode ? findRule(code, testCode) : null;
    checks.push({ label, value, pass, rule_id: rule ? rule.rule_id : null });
  };
  let requiredPasses = [];
  let field = null;

  if (IS_PH(code)) {
    const rep = phRepeatability([gd('ph7a'), gd('ph7b'), gd('ph7c')], [gd('ph4a'), gd('ph4b'), gd('ph4c')]);
    const dr = phDrift(
      [gd('phzi1'), gd('phzi2'), gd('phzi3')], [gd('phzf1'), gd('phzf2'), gd('phzf3')],
      [gd('phsi1'), gd('phsi2'), gd('phsi3')], [gd('phsf1'), gd('phsf2'), gd('phsf3')]);
    const lin = phLinearity(
      [gd('phm4a'), gd('phm4b'), gd('phm4c')], [gd('phm7a'), gd('phm7b'), gd('phm7c')], [gd('phm10a'), gd('phm10b'), gd('phm10c')]);
    const tc = phTemperatureComp({ t10: gd('pht10'), t15: gd('pht15'), t20: gd('pht20'), t25: gd('pht25'), t30: gd('pht30') });
    const phResp = gd('resp');
    const respPass = phResp != null ? (phResp >= 0 && phResp <= 30) : null;
    add(`반복성 표준편차 ≤ ${rep.limit}`, rep.std, rep.pass, 'REP');
    add(`제로드리프트 |차| ≤ ${dr.limit}`, dr.zero.val, dr.zero.pass, 'ZDR');
    add(`스팬드리프트 |차| ≤ ${dr.limit}`, dr.span.val, dr.span.pass, 'SDR');
    add(`직선성 |편차| ≤ ${lin.limit}`, lin.dev, lin.pass, 'LIN');
    if (tc.pass !== null) add(`온도보상 |편차| ≤ ${tc.limit}`, tc.dev, tc.pass, 'TEMP');
    if (phResp != null) add('응답시간 ≤ 30초', phResp, respPass, 'RESP');
    requiredPasses = [rep.pass, dr.zero.pass, dr.span.pass, lin.pass, tc.pass, respPass];
    const fci1 = gd('phci1'), fci2 = gd('phci2'), fai1 = gd('phai1'), fai2 = gd('phai2'), fai3 = gd('phai3'), fai4 = gd('phai4');
    // 현장적용계수는 수분석값(Ai)+현장값(Ci) 둘 다 있어야 계산 (ci만 있으면 엉터리 → 안 함)
    const _phHasAi = fai1 != null || fai2 != null || fai3 != null || fai4 != null;
    const _phHasCi = fci1 != null || fci2 != null;
    if (_phHasAi && _phHasCi) {
      field = fieldApplication('PH', [fai1, fai2, fai3, fai4], [fci1, fci2]);
      add('pH 현장적용계수 |Ai-Ci| ≤ 0.20', field.fi, field.pass, 'FIELD');
    }
  } else if (IS_DO(code)) {
    const rep = doRepeatability([gd('dos1'), gd('dos2'), gd('dos3')]);
    const dr = doDrift(
      [gd('dozi1'), gd('dozi2'), gd('dozi3')], [gd('dozf1'), gd('dozf2'), gd('dozf3')],
      [gd('dosi1'), gd('dosi2'), gd('dosi3')], [gd('dosf1'), gd('dosf2'), gd('dosf3')]);
    const t20 = [gd('dot20a'), gd('dot20b'), gd('dot20c')], t30 = [gd('dot30a'), gd('dot30b'), gd('dot30c')];
    const tc = (t20.some(v => v != null) || t30.some(v => v != null)) ? doTemperatureComp(t20, t30) : { pass: null };
    const dResp = gd('resp');
    const respPass = dResp != null ? (dResp <= 120) : null;
    add(`DO 반복성 표준편차 ≤ ${rep.limit}`, rep.std, rep.pass, 'REP');
    add(`제로드리프트 |차| ≤ ${dr.zeroLimit}`, dr.zero.val, dr.zero.pass, 'ZDR');
    add(`스팬드리프트 |차| ≤ ${dr.spanLimit}`, dr.span.val, dr.span.pass, 'SDR');
    if (tc.pass !== null) add(`DO 온도보상 |편차| ≤ ${tc.limit} mg/L`, tc.maxDev, tc.pass, 'TEMP');
    if (dResp != null) add('응답시간 ≤ 120초', dResp, respPass, 'RESP');
    requiredPasses = [rep.pass, dr.zero.pass, dr.span.pass, tc.pass, respPass];
  } else {
    // 기본형(TOC/TN/TP/SS/COD) + 먹는물(TU/CL)
    const range = gd('range'), isWater = IS_WATER(code);
    const zRepVals = pickRepVals(gd('z5'), gd('z6'), gd('z7'), [gd('z1'), gd('z2')], [gd('z3'), gd('z4')]);
    const sRepVals = pickRepVals(gd('s5'), gd('s6'), gd('s7'), [gd('s1'), gd('s2')], [gd('s3'), gd('s4')]);
    const rep = repeatability(zRepVals, sRepVals, range, isWater ? 2.0 : undefined);
    const dr = drift(range, [gd('z1'), gd('z2')], [gd('z3'), gd('z4')], [gd('s1'), gd('s2')], [gd('s3'), gd('s4')], isWater ? { zero: 3, span: 3 } : undefined);
    const linRef = isWater && gd('s1') > 0 ? gd('s1') / 2 : undefined;
    const lin = linearity(range, isWater ? [gd('m1')] : [gd('m1'), gd('m2'), gd('m3')], linRef);
    const driftLim = isWater ? 3 : PRECISION_CRITERIA.zeroDrift;
    add(`저농도 반복성 RSD ≤ ${rep.limit}%`, rep.zero.rsd, rep.zero.pass, 'REP');
    add(`고농도 반복성 RSD ≤ ${rep.limit}%`, rep.span.rsd, rep.span.pass, 'REP');
    add(`제로드리프트 ≤ ${driftLim}%`, dr.zeroDrift, dr.zeroPass, 'ZDR');
    add(`스팬드리프트 ≤ ${driftLim}%`, dr.spanDrift, dr.spanPass, 'SDR');
    add(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.error, lin.pass, 'LIN');
    requiredPasses = [rep.zero.pass, rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass];

    // 현장적용계수 (종합 pass엔 미포함 — optionalPasses)
    const ci1 = gd('ci1'), ci2 = gd('ci2'), ai1 = gd('ai1'), ai2 = gd('ai2'), ai3 = gd('ai3'), ai4 = gd('ai4');
    // 현장적용계수 = |수분석값(Ai) − 현장값(Ci)| → 둘 다 있어야 의미. ai 없이 ci만 있으면 계산 안 함
    // (P2/P5 계산하기는 수분석 lab 전이라 ci만 있음 → 엉터리 fi 방지. 현장계수 수분석은 카톡 후 ai 채워져 정상 계산)
    const _hasAi = ai1 != null || ai2 != null || ai3 != null || ai4 != null;
    const _hasCi = ci1 != null || ci2 != null;
    if (_hasAi && _hasCi) {
      field = fieldApplication(code, [ai1, ai2, ai3, ai4], [ci1, ci2], { discharge: gd('fdis'), highVariability: gb('highvar') });
      add(`${code} 현장적용계수`, field.fi, field.pass, 'FIELD');
    }

    if (IS_COD(code)) {
      const codmax = gd('codmax'), codmin = gd('codmin');
      let glucPass = null;
      if (codmax != null || codmin != null) {
        const gRes = codGlucoseVariability(codmax, codmin, range);
        glucPass = gRes.pass;
        add(`포도당변동성 ≤ ${PRECISION_CRITERIA.codGlucose}%`, gRes.error, gRes.pass, 'GLU');
      }
      requiredPasses.push(glucPass);
    }

    if (code === 'TOC') {
      const resp = gd('resp');
      const respPass = resp != null ? (resp <= 15) : null;
      if (resp != null) add('응답시간 ≤ 15분', resp, respPass, 'RESP');
      requiredPasses.push(respPass);
    } else if (isWater) {
      const respSkip = gb('resp_skip');
      const rs = waterResponse(gd('resp'), gd('resp_sec'), code === 'TU', respSkip);
      if (!rs.skipped && rs.pass !== null) add(`응답시간 ≤ ${rs.limit}초`, rs.sec, rs.pass, 'RESP');
      const allMeasured = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'm1'].map(gd).filter(v => v != null);
      const rangeExceeded = range != null && allMeasured.some(v => v > range);
      if (range != null) {
        const maxMeasured = allMeasured.length > 0 ? Math.max(...allMeasured) : null;
        add(`측정범위(${range}) 초과 없음`, maxMeasured, rangeExceeded ? false : true);
      }
      requiredPasses.push(rangeExceeded ? false : true);
      if (!respSkip) requiredPasses.push(rs.pass);
    }
  }

  return { code, checks, pass: finalPass(requiredPasses), field };
}
