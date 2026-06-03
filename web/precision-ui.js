/**
 * 수질TMS 정도검사 UI — 엑셀 Version11_(2026).xlsx 전면 반영
 *
 * 항목별 폼 분기:
 *   TOC/TN/TP/SS : 기본형 (반복성 Z1/Z3/Z5, 드리프트 Z2~Z5, 직선성 M1~M3, 현장적용, 응답시간)
 *   COD          : 기본형 + 포도당변동성시험
 *   pH           : pH 전용 (반복성6회, 드리프트2개값, 직선성3점, 온도보상5온도, 현장적용)
 *   DO           : DO 전용 (반복성S, 드리프트4개값, 직선성max/min, 온도보상20/30℃, 응답시간)
 *   TU/CL        : 먹는물 (Z1~Z5, S1~S5, M, 응답시간) — 단순형
 */
import {
  PRECISION_CRITERIA,
  DO_SPAN_TABLE,
  repeatability, drift, linearity,
  phLinearity, doLinearity,
  phTemperatureComp, doTemperatureComp,
  codGlucoseVariability,
  fieldApplication,
} from '../src/precision.js';

const fmt = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : '–');

const ITEMS = [
  { code: 'TOC', label: 'TOC — 총유기탄소' },
  { code: 'TN',  label: 'TN — 총질소' },
  { code: 'TP',  label: 'TP — 총인' },
  { code: 'SS',  label: 'SS — 부유물질' },
  { code: 'PH',  label: 'pH — 수소이온농도' },
  { code: 'DO',  label: 'DO — 용존산소' },
  { code: 'COD', label: 'COD — 화학적산소요구량' },
  { code: 'TU',  label: 'TU — 탁도' },
  { code: 'CL',  label: 'CL — 잔류염소' },
];

// 항목 그룹
const IS_BASIC = c => ['TOC','TN','TP','SS'].includes(c);
const IS_PH    = c => c === 'PH';
const IS_DO    = c => c === 'DO';
const IS_COD   = c => c === 'COD';
const IS_WATER = c => ['TU','CL'].includes(c); // 먹는물

// 항목별 저장 필드 목록
function getFields(code) {
  if (IS_PH(code)) return [
    'ph7a','ph4a','ph7b','ph4b','ph7c','ph4c',      // 반복성 (7,4,7,4,7,4)
    'phdi','phdf',                                    // 드리프트 초기/최종
    'phm4','phm7','phm10',                            // 직선성 (4,7,10)
    'pht10','pht15','pht20','pht25','pht30',          // 온도보상
    'phci1','phai1','phai2','phci2','phai3','phai4',  // 현장적용
    'resp','resp_limit',
  ];
  if (IS_DO(code)) return [
    'dos1','dos2','dos3',                             // 반복성 S×3 (25℃ 기준)
    'dozi','dozf','dosi','dosf',                      // 드리프트 Z초기/최종, S초기/최종
    'domax','domin',                                  // 직선성 max/min
    'dot20','dot30',                                  // 온도보상
    'resp','resp_limit',
  ];
  if (IS_WATER(code)) return [
    'range',
    'z1','z2','z3','z4','z5','z6','z7',
    's1','s2','s3','s4','s5','s6','s7',
    'm1','resp','resp_limit',
  ];
  // TOC/TN/TP/SS/COD (기본형)
  const base = [
    'range',
    'z1','z2','z3','z4',       // 드리프트
    's1','s2','s3','s4',       // 드리프트
    'z5','z6','z7',            // 반복성 별도 (z5 필수, z6/z7 선택)
    's5','s6','s7',            // 반복성 별도 (s5 필수, s6/s7 선택)
    'm1','m2','m3',            // 직선성
    'ci1','ai1','ai2','ci2','ai3','ai4','fdis', // 현장적용
  ];
  if (code === 'TOC') base.push('resp'); // TOC만 응답시간
  if (IS_COD(code)) base.push('codmax','codmin'); // COD 포도당변동성
  return base;
}

// ── 탭 상태 ─────────────────────────────────────────────
let tabs = [];
let activeId = null;
let calcTimer = null;
let stored = {}; // switchTab에서 loadData(id)로 갱신 — ni(), zsCell()에서 사용

function saveMeta() {
  try { localStorage.setItem('ktl-tabs', JSON.stringify(tabs.map(({id,code,label,pass})=>({id,code,label,pass})))); } catch {}
  try { localStorage.setItem('ktl-tab-active', activeId||''); } catch {}
}
function loadMeta() {
  try { const r = localStorage.getItem('ktl-tabs'); if (r) tabs = JSON.parse(r); } catch {}
  try { activeId = localStorage.getItem('ktl-tab-active') || null; } catch {}
}
function saveData(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  const fields = getFields(tab.code);
  const s = {};
  fields.forEach(f => { const el = document.getElementById(`pv_${f}`); if (el) s[f] = el.value; });
  try { localStorage.setItem(`ktl-pv-${id}`, JSON.stringify(s)); } catch {}
}
function loadData(id) {
  try { const r = localStorage.getItem(`ktl-pv-${id}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}

function makeLabel(code) {
  const n = tabs.filter(t => t.code === code).length;
  return n === 0 ? code : `${code}-${n+1}`;
}
function addTab(code) {
  const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
  tabs.push({ id, code, label: makeLabel(code), pass: null });
  saveMeta();
  renderTabs();
  switchTab(id);
}
function removeTab(id) {
  if (tabs.length === 1) { tabs = []; activeId = null; saveMeta(); renderTabs(); renderEmpty(); return; }
  try { localStorage.removeItem(`ktl-pv-${id}`); } catch {}
  const idx = tabs.findIndex(t => t.id === id);
  tabs.splice(idx, 1);
  if (activeId === id) activeId = tabs[Math.max(0, idx-1)].id;
  saveMeta();
  renderTabs();
  switchTab(activeId);
}

// ── 계산 ─────────────────────────────────────────────────
function g(id) { return parseFloat(document.getElementById(`pv_${id}`)?.value) || 0; }
function gv(id) { return parseFloat(document.getElementById(`pv_${id}`)?.value); } // NaN 허용

function badge(label, pass) {
  if (pass === null || pass === undefined) return `<div class="pv-badge pv-badge--na">— ${label}</div>`;
  return pass
    ? `<div class="pv-badge pv-badge--ok">✅ ${label} 적합</div>`
    : `<div class="pv-badge pv-badge--bad">❌ ${label} 부적합</div>`;
}
function row(k, v) { return `<div class="pv-line"><span>${k}</span><b>${v}</b></div>`; }

// 심플 1줄 게이지
function gauge(val, limit, label, lowerIsBetter = true) {
  if (!val && val !== 0) return '';
  // 엑셀: ROUND(val, 1) <= limit 기준
  const r1val = Math.round(val * 10) / 10;
  const pass = lowerIsBetter ? r1val <= limit : r1val >= limit;
  const cls = pass ? 'ok' : 'bad';
  const pct = Math.min((r1val / (limit * 2)) * 100, 100);
  return `<div class="pv-sg">
    <span class="pv-sg__label">${label}</span>
    <span class="pv-sg__val pv-sg__val--${cls}">${r1val.toFixed(1)}%</span>
    <div class="pv-sg__bar"><div class="pv-sg__fill pv-sg__fill--${cls}" style="width:${pct}%"></div></div>
    <span class="pv-sg__limit">기준 ${limit}%</span>
    <span class="pv-sg__icon">${pass ? '✅' : '❌'}</span>
  </div>`;
}

// 반복성 Z/S 카드 2열
function repCards(rep, zVals, sVals) {
  function card(label, cls, data, vals) {
    const p = data.pass;
    const pc = p === null || p === undefined ? 'na' : p ? 'ok' : 'bad';
    const icon = p === null || p === undefined ? '' : p ? '✅' : '❌';
    const verdict = p === null || p === undefined ? '—' : p ? '적합' : '부적합';
    const valsHtml = vals && vals.length
      ? `<div class="pv-rep-card__vals">${vals.map(v=>fmt(v,3)).join(', ')}</div>`
      : '';
    return `<div class="pv-rep-card pv-rep-card--${cls}">
      <div class="pv-rep-card__label">${label}</div>
      ${valsHtml}
      <div class="pv-rep-card__mean">평균 <b>${isNaN(data.mean) ? '—' : fmt(data.mean, 3)}</b></div>
      <div class="pv-rep-card__rsd pv-rep-card__rsd--${pc}">${isNaN(data.rsd) ? '측정값 부족' : (Math.round(data.rsd*10)/10).toFixed(1)+'%'}</div>
      <div class="pv-rep-card__limit">기준 RSD ≤ ${rep.limit}%</div>
      <div class="pv-rep-card__verdict pv-rep-card__verdict--${pc}">${icon} ${verdict}</div>
    </div>`;
  }
  // zVals===null 이면 Z카드 숨김 (DO 등 Span 전용 항목)
  const zCard = zVals !== null ? card('Z 제로', 'z', rep.zero, zVals) : '';
  const sCard = card('S 스팬', 's', rep.span, sVals);
  const single = !zCard;
  return `<div class="pv-rep-cards${single?' pv-rep-cards--single':''}">${zCard}${sCard}</div>`;
}

// 결과 테이블 단일열 행 (직선성 등 소형 테이블용)
function rt2(label, zVal, sVal, zPass, sPass, unit='') {
  if (zPass !== undefined && sPass !== undefined && zPass !== null && sPass !== null) {
    return `<tr class="verdict"><td>${label}</td>
      <td><span class="val--${zPass?'ok':'bad'}">${zPass?'적합':'부적합'}</span></td>
      <td><span class="val--${sPass?'ok':'bad'}">${sPass?'적합':'부적합'}</span></td></tr>`;
  }
  const zStr = (zVal===null||isNaN(zVal)) ? '—' : fmt(zVal,3)+unit;
  const sStr = (sVal===null||isNaN(sVal)) ? '—' : fmt(sVal,3)+unit;
  return `<tr><td>${label}</td><td>${zStr}</td><td>${sStr}</td></tr>`;
}

// 결과 테이블 단일열 행
function rt1(label, val, pass, unit='') {
  const valStr = (val===null||isNaN(val)) ? '—' : fmt(val,3)+unit;
  if (pass !== undefined && pass !== null) {
    return `<tr><td>${label}</td><td colspan="2"><span class="val--${pass?'ok':'bad'}">${pass?'적합':'부적합'}</span></td></tr>`;
  }
  return `<tr><td>${label}</td><td colspan="2">${valStr}</td></tr>`;
}

// ── 계산: 기본형 (TOC/TN/TP/SS/COD) ─────────────────────
// 엑셀 로직: 4콤보(초기×최종) 중 STDEV 최대 조합 자동선택 (Z6/Z7 수동 입력 시 우선)
function pickRepVals(z5, z6, z7, initVals, finVals) {
  if (isNaN(z5) || z5 <= 0) return [];
  const z6ok = !isNaN(z6) && z6 > 0, z7ok = !isNaN(z7) && z7 > 0;
  if (z6ok && z7ok) return [z5, z6, z7];
  if (z6ok) return [z5, z6];
  const iv = initVals.filter(v=>v>0), fv = finVals.filter(v=>v>0);
  if (!iv.length || !fv.length) return [z5];
  let best = {s:-1, a:null, b:null};
  for (const a of iv) for (const b of fv) {
    const m=(z5+a+b)/3, s=Math.sqrt(((z5-m)**2+(a-m)**2+(b-m)**2)/2);
    if (s > best.s) best = {s, a, b};
  }
  return [z5, best.a, best.b];
}

function calcBasic(tab) {
  const range = g('range');
  if (!range) return;

  const zRepVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[g('z1'),g('z2')],[g('z3'),g('z4')]);
  const sRepVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[g('s1'),g('s2')],[g('s3'),g('s4')]);
  const rep = repeatability(zRepVals, sRepVals, range);
  document.getElementById('pv-res-rep').innerHTML = repCards(rep, zRepVals, sRepVals);

  // 드리프트: 초기[Z1,Z2] → 최종[Z3,Z4] / 초기[S1,S2] → 최종[S3,S4]
  const dr = drift(range, [g('z1'),g('z2')], [g('z3'),g('z4')], [g('s1'),g('s2')], [g('s3'),g('s4')]);
  document.getElementById('pv-res-drift').innerHTML =
    gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '제로드리프트') +
    gauge(dr.spanDrift, PRECISION_CRITERIA.spanDrift, '스팬드리프트');

  // 직선성: M1,M2,M3
  const lin = linearity(range, [g('m1'),g('m2'),g('m3')]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값', fmt(lin.ref,3))}
      ${row('평균', fmt(lin.avg,3))}
      ${row('오차', `${fmt(lin.error,2)}%`)}
    </div>` +
    gauge(lin.error, PRECISION_CRITERIA.linearity, '직선성');

  // 측정범위 검사: 초과 체크 + 표준용액 0값 체크 (0은 측정 불가 → 부적합)
  const stdFields = ['z1','z2','z3','z4','s1','s2','s3','s4','z5','z6','z7','s5','s6','s7','m1','m2','m3'];
  const zeroEntered = stdFields.filter(id => { const v=gv(id); return !isNaN(v) && v===0; });
  const allMeasured = [g('s1'),g('s2'),g('s3'),g('s4'),g('s5'),g('m1'),g('m2'),g('m3')].filter(v=>v>0);
  const rangeExceeded = allMeasured.some(v => v > range);
  const rangeBlock = document.getElementById('pv-res-range-block');
  const rangeEl = document.getElementById('pv-res-range');
  if (rangeEl && rangeBlock) {
    let html = '';
    if (zeroEntered.length > 0) {
      html += `<div class="pv-lines">${row('0값 입력', zeroEntered.map(id=>id.toUpperCase()).join(', '))}</div>
        <div class="pv-badges">${badge('표준용액 0값 — 측정 오류 확인 필요', false)}</div>`;
    }
    if (rangeExceeded) {
      const exceeded = allMeasured.filter(v => v > range);
      html += `<div class="pv-lines">${row('측정범위', fmt(range,3))} ${row('초과 값', exceeded.map(v=>fmt(v,3)).join(', '))}</div>
        <div class="pv-badges">${badge(`측정값이 측정범위(${range})를 초과함`, false)}</div>`;
    }
    if (!html) {
      html = `<div class="pv-badges">${badge(`모든 측정값 ≤ 측정범위(${range})`, true)}</div>`;
    }
    rangeEl.innerHTML = html;
    rangeBlock.hidden = false;
  }
  const rangePass = !rangeExceeded && zeroEntered.length === 0;
  const passes = [rep.zero.pass, rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass, rangePass ? null : false].filter(v => v !== null);


  // 현장적용계수
  const ci1=g('ci1'),ci2=g('ci2'),ai1=g('ai1'),ai2=g('ai2'),ai3=g('ai3'),ai4=g('ai4');
  let fieldPass = null;
  const fieldBlock = document.getElementById('pv-res-field-block');
  if (ci1||ci2||ai1||ai2||ai3||ai4) {
    const fRes = fieldApplication(tab.code, [ai1,ai2,ai3,ai4], [ci1,ci2], {discharge:g('fdis')});
    document.getElementById('pv-res-field').innerHTML =
      `<div class="pv-lines">
        ${row('수분석 평균 (Ai)', fmt(fRes.labMean,3))}
        ${row('현장측정 평균 (Ci)', fmt(fRes.siteMean,3))}
        ${fRes.limit!=null ? row('허용오차', `±${fmt(fRes.limit,3)}`) : ''}
        ${fRes.auto ? row('자동 적합', '수분석 평균 ≥ 기준') : ''}
      </div><div class="pv-badges">${badge(`${tab.code} 현장적용계수`, fRes.pass)}</div>`;
    fieldPass = fRes.pass;
    if (fieldBlock) fieldBlock.hidden = false;
  } else {
    if (fieldBlock) fieldBlock.hidden = true;
  }
  if (fieldPass !== null) passes.push(fieldPass);

  // 응답시간 (TOC 전용) - 기준 ≤ 15분
  if (tab.code === 'TOC') {
    const resp = g('resp');
    const respLimit = 15; // 분(min) 단위
    let respPass = null;
    const respBlock = document.getElementById('pv-res-resp-block');
    if (resp) {
      respPass = resp <= respLimit;
      document.getElementById('pv-res-resp').innerHTML =
        `<div class="pv-lines">
          ${row('측정값 (T90)', `${fmt(resp,1)}분`)}
          ${row('기준', '≤ 15분')}
        </div><div class="pv-badges">${badge(`응답시간 ≤ 15분`, respPass)}</div>`;
      if (respBlock) respBlock.hidden = false;
    } else {
      if (respBlock) respBlock.hidden = true;
    }
    if (respPass !== null) passes.push(respPass);
  }

  // COD 포도당변동성
  if (IS_COD(tab.code)) {
    const codmax=g('codmax'), codmin=g('codmin');
    let glucPass = null;
    const glucBlock = document.getElementById('pv-res-gluc-block');
    if (codmax || codmin) {
      const gRes = codGlucoseVariability(codmax, codmin, g('range'));
      document.getElementById('pv-res-gluc').innerHTML =
        `<div class="pv-lines">
          ${row('최댓값', fmt(codmax,3))} ${row('최솟값', fmt(codmin,3))}
          ${row('변동범위', `${fmt(codmax-codmin,3)}`)} ${row('오차', `${fmt(gRes.error)}%`)}
        </div><div class="pv-badges">
          ${badge(`포도당변동성 ≤ ${PRECISION_CRITERIA.codGlucose}%`, gRes.pass)}
        </div>`;
      glucPass = gRes.pass;
      if (glucBlock) glucBlock.hidden = false;
    } else {
      if (glucBlock) glucBlock.hidden = true;
    }
    if (glucPass !== null) passes.push(glucPass);
  }

  updateFinal(tab, passes);
}

// ── 계산: pH ─────────────────────────────────────────────
function calcPH(tab) {
  const z7 = [g('ph7a'),g('ph7b'),g('ph7c')];
  const z4 = [g('ph4a'),g('ph4b'),g('ph4c')];
  const rep = repeatability(z7, z4);
  document.getElementById('pv-res-rep').innerHTML = repCards({
    zero: { mean: rep.zero.mean, rsd: rep.zero.rsd, pass: rep.zero.pass },
    span: { mean: rep.span.mean, rsd: rep.span.rsd, pass: rep.span.pass },
    limit: rep.limit,
  });

  const dr = drift(14, [g('phdi')], [g('phdf')], [g('phdi')], [g('phdf')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('초기', fmt(g('phdi'),3))}
      ${row('2시간후', fmt(g('phdf'),3))}
    </div>` +
    gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '드리프트');

  const lin = phLinearity([g('phm4'),g('phm7'),g('phm10')]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('pH4 측정', fmt(g('phm4'),2))}
      ${row('pH7 측정', fmt(g('phm7'),2))}
      ${row('pH10 측정', fmt(g('phm10'),2))}
      ${row('max-min', fmt(lin.max-lin.min,3))} ${row('오차/범위', `${fmt(lin.error)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  const temps = {t10:g('pht10'),t15:g('pht15'),t20:g('pht20'),t25:g('pht25'),t30:g('pht30')};
  const tc = phTemperatureComp(temps);
  const tcBlock = document.getElementById('pv-res-tc-block');
  let tcPass = null;
  if (Object.values(temps).some(v=>v)) {
    document.getElementById('pv-res-tc').innerHTML =
      `<div class="pv-lines">
        ${row('10℃', fmt(temps.t10,2))} ${row('15℃', fmt(temps.t15,2))} ${row('20℃', fmt(temps.t20,2))}
        ${row('25℃', fmt(temps.t25,2))} ${row('30℃', fmt(temps.t30,2))}
        ${row('max', fmt(tc.max,2))} ${row('min', fmt(tc.min,2))} ${row('max-min', fmt(tc.range,3))}
      </div><div class="pv-badges">
        ${badge(`온도보상 max-min ≤ ${PRECISION_CRITERIA.phTempComp}`, tc.pass)}
      </div>`;
    tcPass = tc.pass;
    if (tcBlock) tcBlock.hidden = false;
  } else {
    if (tcBlock) tcBlock.hidden = true;
  }

  const ci1=g('phci1'),ci2=g('phci2'),ai1=g('phai1'),ai2=g('phai2'),ai3=g('phai3'),ai4=g('phai4');
  let fieldPass = null;
  const fieldBlock = document.getElementById('pv-res-field-block');
  if (ci1||ci2||ai1||ai2||ai3||ai4) {
    const fRes = fieldApplication('PH', [ai1,ai2,ai3,ai4], [ci1,ci2]);
    document.getElementById('pv-res-field').innerHTML =
      `<div class="pv-lines">
        ${row('수분석 평균 (Ai)', fmt(fRes.labMean,2))}
        ${row('현장측정 평균 (Ci)', fmt(fRes.siteMean,2))}
        ${row('허용오차', `±${fmt(fRes.limit,2)}`)}
      </div><div class="pv-badges">${badge('pH 현장적용계수', fRes.pass)}</div>`;
    fieldPass = fRes.pass;
    if (fieldBlock) fieldBlock.hidden = false;
  } else {
    if (fieldBlock) fieldBlock.hidden = true;
  }

  const passes = [rep.zero.pass, rep.span.pass, dr.zeroPass, lin.pass];
  if (tcPass !== null) passes.push(tcPass);
  if (fieldPass !== null) passes.push(fieldPass);
  updateFinal(tab, passes);
}

// ── 계산: DO ─────────────────────────────────────────────
function calcDO(tab) {
  const range = 20; 
  const span = DO_SPAN_TABLE[25]; 

  const sRepVals = [g('dos1'),g('dos2'),g('dos3')].filter(v=>v>0);
  const rep = repeatability([], sRepVals, range);
  document.getElementById('pv-res-rep').innerHTML = repCards(
    { zero: rep.zero, span: rep.span, limit: rep.limit },
    null,                       // Z카드 숨김 — DO는 Span(S) 기준
    sRepVals
  );

  const dr = drift(range, [g('dozi')], [g('dozf')], [g('dosi')], [g('dosf')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('Z초기', fmt(g('dozi'),3))} ${row('Z2시간', fmt(g('dozf'),3))}
      ${row('S초기', fmt(g('dosi'),3))} ${row('S2시간', fmt(g('dosf'),3))}
    </div>` +
    gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '제로드리프트') +
    gauge(dr.spanDrift, PRECISION_CRITERIA.spanDrift, '스팬드리프트');

  const lin = doLinearity(g('domax'), g('domin'), range);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('최댓값', fmt(g('domax'),3))} ${row('최솟값', fmt(g('domin'),3))}
      ${row('max-min/범위', `${fmt(lin.error)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  const m20=g('dot20'), m30=g('dot30');
  let tcPass = null;
  const tcBlock = document.getElementById('pv-res-tc-block');
  if (m20 || m30) {
    const tc = doTemperatureComp(m20, m30, span);
    document.getElementById('pv-res-tc').innerHTML =
      `<div class="pv-lines">
        ${row('20℃ 측정', fmt(m20,3))} ${row('기준 (9.092)', fmt(DO_SPAN_TABLE[20],3))} ${row('오차', `${fmt(tc.t20.error)}%`)}
        ${row('30℃ 측정', fmt(m30,3))} ${row('기준 (7.559)', fmt(DO_SPAN_TABLE[30],3))} ${row('오차', `${fmt(tc.t30.error)}%`)}
      </div><div class="pv-badges">
        ${badge(`20℃ 온도보상 ≤ ${PRECISION_CRITERIA.doTempComp}%`, tc.t20.pass)}
        ${badge(`30℃ 온도보상 ≤ ${PRECISION_CRITERIA.doTempComp}%`, tc.t30.pass)}
      </div>`;
    tcPass = tc.pass;
    if (tcBlock) tcBlock.hidden = false;
  } else {
    if (tcBlock) tcBlock.hidden = true;
  }

  const resp = g('resp');
  const respLimit = 120;
  let respPass = null;
  const respBlock = document.getElementById('pv-res-resp-block');
  if (resp) {
    respPass = resp <= respLimit;
    document.getElementById('pv-res-resp').innerHTML =
      `<div class="pv-lines">
        ${row('측정값 (T90)', `${fmt(resp,0)}초`)} ${row('기준', '≤ 120초')}
        </div><div class="pv-badges">${badge('응답시간 ≤ 120초', respPass)}</div>`;
    if (respBlock) respBlock.hidden = false;
  } else {
    if (respBlock) respBlock.hidden = true;
  }

  const passes = [rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass];
  if (tcPass !== null) passes.push(tcPass);
  if (respPass !== null) passes.push(respPass);
  updateFinal(tab, passes);
}

// ── 계산: 먹는물 (TU/CL) ────────────────────────────────
function calcWater(tab) {
  const range = g('range');
  if (!range) return;

  // 반복성: 4콤보 pickRepVals (TMS와 동일 엑셀 로직)
  const zRepVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[g('z1'),g('z2')],[g('z3'),g('z4')]);
  const sRepVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[g('s1'),g('s2')],[g('s3'),g('s4')]);
  const rep = repeatability(zRepVals, sRepVals, range);
  document.getElementById('pv-res-rep').innerHTML = repCards(rep, zRepVals, sRepVals);

  // 드리프트: TU/CL 기준 ≤ 3% (TMS는 5%)
  const WATER_DRIFT_LIMIT = 3;
  const dr = drift(range, [g('z1'),g('z2')], [g('z3'),g('z4')], [g('s1'),g('s2')], [g('s3'),g('s4')], { zero: WATER_DRIFT_LIMIT, span: WATER_DRIFT_LIMIT });
  document.getElementById('pv-res-drift').innerHTML =
    gauge(dr.zeroDrift, WATER_DRIFT_LIMIT, '제로드리프트') +
    gauge(dr.spanDrift, WATER_DRIFT_LIMIT, '스팬드리프트');

  // 직선성: 기준값 = S1/2 (TMS는 range×0.45)
  const linRef = g('s1') > 0 ? g('s1') / 2 : undefined;
  const lin = linearity(range, [g('m1')], linRef);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값 (S1÷2)', fmt(lin.ref,3))} ${row('주입농도 M', fmt(g('m1'),3))} ${row('오차', `${fmt(lin.error)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;
  
  const respSkip = document.getElementById('pv_resp_skip')?.checked;
  const resp = g('resp');
  const s1val = g('s1');
  const respLimit = s1val ? s1val * 0.5 : null;
  const respBlock = document.getElementById('pv-res-resp-block');
  let respPass = null;
  if (respSkip) {
    if (respBlock) respBlock.hidden = true;
  } else if (resp && respLimit !== null) {
    respPass = resp >= respLimit;
    document.getElementById('pv-res-resp').innerHTML =
      `<div class="pv-lines">${row('측정값', `${fmt(resp,2)}`)}
        ${row('기준 (S1×0.5)', `≥ ${fmt(respLimit,2)}`)}</div>
       <div class="pv-badges">${badge(`응답값 ≥ S1×0.5`, respPass)}</div>`;
    if (respBlock) respBlock.hidden = false;
  } else {
    if (respBlock) respBlock.hidden = true;
  }
  // 측정범위 초과 체크: S값, M값이 range를 초과하면 부적합
  const allMeasured = [g('s1'),g('s2'),g('s3'),g('s4'),g('s5'),g('m1'),g('m2'),g('m3')].filter(v=>v>0);
  const rangeExceeded = allMeasured.some(v => v > range);
  if (rangeExceeded) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = '⚠️ 측정범위(' + range + ')를 초과한 값이 있습니다. 측정범위를 확인하세요.';
    document.getElementById('pv-res-rep')?.before(note);
  }
  const passes = [rep.zero.pass, rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass, rangeExceeded ? false : null].filter(v => v !== null);
  if (respPass !== null) passes.push(respPass);
  updateFinal(tab, passes);
}

function updateFinal(tab, passes) {
  const allPass = passes.every(p => p === true);
  document.getElementById('pv-final').innerHTML =
    `<div class="pv-final-banner pv-final-banner--${allPass?'ok':'bad'}">
      ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
    </div>`;
  document.getElementById('pv-results').hidden = false;
  tab.pass = allPass ? 'ok' : 'bad';
  saveMeta();
  const btn = document.querySelector(`.pv-item-tab[data-id="${tab.id}"]`);
  if (btn) btn.dataset.pass = tab.pass;
  loadLegalBasis(tab.code);
}

// 법령근거 API 호출 — 1일 캐시(서버), 클라이언트도 탭당 1회 fetch
const _legalCache = new Map();
async function loadLegalBasis(code) {
  const el = document.getElementById('pv-legal-content');
  if (!el) return;

  if (_legalCache.has(code)) {
    renderLegal(el, _legalCache.get(code));
    return;
  }

  el.innerHTML = '<div class="pv-legal-loading">법령 조회 중…</div>';
  try {
    const res = await fetch(`/api/legalBasis?item=${code}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    _legalCache.set(code, d);
    renderLegal(el, d);
  } catch {
    el.innerHTML = '<div class="pv-legal-err">법령 조회 실패 — 네트워크를 확인하세요</div>';
  }
}

function renderLegal(el, d) {
  const criteriaHtml = d.정도검사기준
    ? Object.entries(d.정도검사기준)
        .map(([k, v]) => `<div class="pv-legal-criterion"><span class="pv-legal-key">${k}</span><b class="pv-legal-val">${v}</b></div>`)
        .join('')
    : '<span class="pv-legal-na">기준값 정보 없음</span>';

  const refsHtml = d.법령근거
    .map(l => `<a class="pv-legal-ref" href="${l.링크}" target="_blank" rel="noopener noreferrer">${l.법령명}<span class="pv-legal-ref__org"> · ${l.소관기관}</span></a>`)
    .join('');

  el.innerHTML = `
    <div class="pv-legal-meta">
      <span>분야 <b>${d.분야}</b></span>
      <span>기기명 <b>${d.기기명}</b></span>
      <span>정도검사주기 <b>${d.정도검사주기}</b></span>
    </div>
    <div class="pv-legal-criteria">${criteriaHtml}</div>
    <div class="pv-legal-refs">${refsHtml}</div>
    <div class="pv-legal-source">출처: ${d.출처} · ${d.조회일시} 기준</div>`;
}

// ── Z5/S5 힌트: 4콤보 STDEV최대 조합 + std/range ≤ 3% 통과 범위 수치계산 ──
function computeRepZ5Range(initVals, finVals, range) {
  const iv = initVals.filter(v => !isNaN(v) && v > 0);
  const fv = finVals.filter(v => !isNaN(v) && v > 0);
  if (!iv.length || !fv.length || !(range > 0)) return { lo: NaN, hi: NaN, passable: false };

  function worstStdAt(z5) {
    let maxS = -1;
    for (const a of iv) for (const b of fv) {
      const m = (z5+a+b)/3;
      const s = Math.sqrt(((z5-m)**2+(a-m)**2+(b-m)**2)/2);
      if (s > maxS) maxS = s;
    }
    return maxS / range * 100;
  }

  // 엑셀 ROUND(x,1) 기준 통과 여부
  const passes = x => Math.round(worstStdAt(x) * 10) / 10 <= 3;

  const all = [...iv, ...fv];
  const dMin = Math.min(...all), dMax = Math.max(...all);
  const span = Math.max(dMax - dMin, dMin * 0.1);
  const scanLo = Math.max(0, dMin - span), scanHi = dMax + span;

  // 1단계: 선형 스캔으로 통과 구간 대략 파악 (200단계)
  const STEPS = 200;
  const step = (scanHi - scanLo) / STEPS;
  let coarseLo = NaN, coarseHi = NaN;
  for (let i = 0; i <= STEPS; i++) {
    const x = scanLo + i * step;
    if (passes(x)) {
      if (isNaN(coarseLo)) coarseLo = x;
      coarseHi = x;
    }
  }

  if (isNaN(coarseLo)) {
    const dm = all.reduce((a,b)=>a+b,0)/all.length;
    return { lo: dm, hi: dm, passable: false };
  }

  // 2단계: 이진 탐색으로 하한·상한 정밀 계산 (오차 ~0.000001)
  const ITER = 50;
  // 하한 이진탐색: coarseLo-step ~ coarseLo 구간
  let bLo = Math.max(0, coarseLo - step), bHi = coarseLo;
  for (let i = 0; i < ITER; i++) {
    const mid = (bLo + bHi) / 2;
    if (passes(mid)) bHi = mid; else bLo = mid;
  }
  const lo = bHi;

  // 상한 이진탐색: coarseHi ~ coarseHi+step 구간
  bLo = coarseHi; bHi = Math.min(range, coarseHi + step);
  for (let i = 0; i < ITER; i++) {
    const mid = (bLo + bHi) / 2;
    if (passes(mid)) bLo = mid; else bHi = mid;
  }
  const hi = bLo;

  return { lo, hi, passable: true };
}

// ── 인라인 힌트 바 ───────────────────────────────────────────
function setHint(id, lo, hi, cur) {
  const el = document.getElementById(`pv_hint_${id}`);
  if (!el) return;
  if (isNaN(lo) || isNaN(hi)) { el.className = 'pv-zs-range-hint'; el.textContent = ''; return; }
  // 보수적 표시: 하한 올림(ceil), 상한 내림(floor) — 경계값 부동소수점 오차 방지
  const loDisp = Math.ceil(lo * 1000) / 1000;
  const hiDisp = Math.floor(hi * 1000) / 1000;
  const f = v => Number(v).toFixed(3).replace(/\.?0+$/, '');
  const inRange = !isNaN(cur) && cur >= loDisp && cur <= hiDisp;
  const outRange = !isNaN(cur) && (cur < loDisp || cur > hiDisp);
  el.className = 'pv-zs-range-hint' +
    (inRange ? ' pv-zs-range-hint--ok' : outRange ? ' pv-zs-range-hint--ng' : '');
  el.textContent = `${f(loDisp)} ~ ${f(hiDisp)}`;
}

// 통과 불가 참고점 — 어떤 값을 넣어도 부적합
function setHintRef(id, ref, cur) {
  const el = document.getElementById(`pv_hint_${id}`);
  if (!el) return;
  // 음수 입력 = 명백히 잘못된 값 → 빨간 오류 표시
  if (!isNaN(cur) && cur < 0) {
    el.className = 'pv-zs-range-hint pv-zs-range-hint--ng';
    el.textContent = '⚠ 음수 불가';
    return;
  }
  if (isNaN(ref)) { el.className = 'pv-zs-range-hint'; el.textContent = ''; return; }
  el.className = 'pv-zs-range-hint pv-zs-range-hint--ref';
  el.textContent = '어떤값도 부적합';
}

// 직선성 M 힌트 (기준값 ref ± 5%)
function setLinHint(id, ref, cur) {
  const el = document.getElementById(`pv_hint_${id}`);
  if (!el) return;
  if (isNaN(ref)) { el.className = 'pv-lin-hint'; el.textContent = ''; return; }
  const f = v => Number(v).toFixed(2).replace(/\.?0+$/, '');
  const lo = ref * 0.95, hi = ref * 1.05;
  const inRange = !isNaN(cur) && cur >= lo && cur <= hi;
  const outRange = !isNaN(cur) && (cur < lo || cur > hi);
  el.className = 'pv-lin-hint' +
    (inRange ? ' pv-lin-hint--ok' : outRange ? ' pv-lin-hint--ng' : '');
  el.textContent = `목표 ${f(lo)} ~ ${f(hi)}`;
}

function updateInlineHints(code) {
  const range = g('range');

  // ── 기본형: TOC/TN/TP/SS/COD ──────────────────────────────
  if (IS_BASIC(code) || IS_COD(code)) {
    const clear = ids => ids.forEach(id => setHint(id, NaN, NaN, NaN));
    if (!range) { clear(['z2','z3','z4','z5','z6','z7','s2','s3','s4','s5','s6','s7']); return; }

    // ── 드리프트: |mean(Z3,Z4) - mean(Z1,Z2)| / range ≤ 5% ──
    const driftTol = range * 0.05;          // ±range×5% = 드리프트 허용 편차

    const z1=gv('z1'), z2=gv('z2'), z3=gv('z3'), z4=gv('z4');
    const s1=gv('s1'), s2=gv('s2'), s3=gv('s3'), s4=gv('s4');
    const z5=gv('z5'), s5=gv('s5');

    const ziMean = !isNaN(z1) && !isNaN(z2) ? (z1+z2)/2 : z1;  // 초기구간 평균
    const siMean = !isNaN(s1) && !isNaN(s2) ? (s1+s2)/2 : s1;

    // 힌트 범위를 [0, range]로 클램프 — 음수·범위초과 표시 방지
    const clamp = (v, r) => isNaN(v) ? NaN : Math.max(0, Math.min(r, v));
    const sh = (id, lo, hi, cur) => setHint(id, clamp(lo, range), clamp(hi, range), cur);

    // Z3/Z4: 엑셀 기준 ROUND(drift,1) <= 5 통과 범위
    // drift 경계: |mean(Z3,Z4)-ziMean|/range*100 < 5.05 (ROUND 1자리)
    // Z3 입력 시 Z4 고정값 기반 정확한 경계: Z3 = 2*(ziMean±driftMax) - Z4
    const driftMax = range * 0.050499; // ROUND(5.0499,1)=5.0 → 패스 경계 (5.05 미만)
    const z3Lo = !isNaN(ziMean) ? (!isNaN(z4) ? 2*(ziMean-driftMax)-z4 : ziMean-driftMax) : NaN;
    const z3Hi = !isNaN(ziMean) ? (!isNaN(z4) ? 2*(ziMean+driftMax)-z4 : ziMean+driftMax) : NaN;
    const z4Lo = !isNaN(ziMean) ? (!isNaN(z3) ? 2*(ziMean-driftMax)-z3 : ziMean-driftMax) : NaN;
    const z4Hi = !isNaN(ziMean) ? (!isNaN(z3) ? 2*(ziMean+driftMax)-z3 : ziMean+driftMax) : NaN;
    sh('z3', z3Lo, z3Hi, z3);
    sh('z4', z4Lo, z4Hi, z4);

    const s3Lo = !isNaN(siMean) ? (!isNaN(s4) ? 2*(siMean-driftMax)-s4 : siMean-driftMax) : NaN;
    const s3Hi = !isNaN(siMean) ? (!isNaN(s4) ? 2*(siMean+driftMax)-s4 : siMean+driftMax) : NaN;
    const s4Lo = !isNaN(siMean) ? (!isNaN(s3) ? 2*(siMean-driftMax)-s3 : siMean-driftMax) : NaN;
    const s4Hi = !isNaN(siMean) ? (!isNaN(s3) ? 2*(siMean+driftMax)-s3 : siMean+driftMax) : NaN;
    sh('s3', s3Lo, s3Hi, s3);
    sh('s4', s4Lo, s4Hi, s4);

    // Z5/S5: 4콤보 std/range ≤ 3% 실제 통과 범위
    const z5r = computeRepZ5Range([z1,z2],[z3,z4], range);
    const s5r = computeRepZ5Range([s1,s2],[s3,s4], range);
    if (z5r.passable) setHint('z5', z5r.lo, z5r.hi, z5);
    else setHintRef('z5', z5r.lo, z5);
    if (s5r.passable) setHint('s5', s5r.lo, s5r.hi, s5);
    else setHintRef('s5', s5r.lo, s5);

    // Z6/Z7: Z5 기준값 ± range×3%×√3
    // std([Z5,Z6,Z6]) = |Z6-Z5|/√3 ≤ 3 → |Z6-Z5| ≤ 3√3 ≈ 5.196
    // Z5 미입력 시 힌트 없음
    const repAbs = range * 0.03 * Math.sqrt(3);
    if (!isNaN(z5) && z5 > 0) {
      setHint('z6', clamp(z5-repAbs, range), clamp(z5+repAbs, range), gv('z6'));
      setHint('z7', clamp(z5-repAbs, range), clamp(z5+repAbs, range), gv('z7'));
    }
    if (!isNaN(s5) && s5 > 0) {
      setHint('s6', clamp(s5-repAbs, range), clamp(s5+repAbs, range), gv('s6'));
      setHint('s7', clamp(s5-repAbs, range), clamp(s5+repAbs, range), gv('s7'));
    }

    // 드리프트·반복성·직선성 요약바
    updateDriftSummary(range);
    updateRepSummary(range);
    updateLinSummary(range);
    return;
  }

  // ── 먹는물: TU/CL ─────────────────────────────────────────
  if (IS_WATER(code)) {
    if (!range) return;
    const repT = v => v * 0.04; // 반복성 2% RSD 기준 → ±4% 목표범위
    const z1=gv('z1'), s1=gv('s1');
    ['z2','z3','z4','z5'].forEach(id => {
      setHint(id, !isNaN(z1) ? z1-repT(z1) : NaN, !isNaN(z1) ? z1+repT(z1) : NaN, gv(id));
    });
    ['s2','s3','s4','s5'].forEach(id => {
      setHint(id, !isNaN(s1) ? s1-repT(s1) : NaN, !isNaN(s1) ? s1+repT(s1) : NaN, gv(id));
    });
    // 직선성 요약바
    updateLinSummary(range);
  }
}

function updateLinSummary(range) {
  const el = document.getElementById('pv_lin_summary');
  if (!el) return;
  const ref = range * 0.45;
  const vals = [gv('m1'), gv('m2'), gv('m3')].filter(v => !isNaN(v));
  if (!range || vals.length === 0) { el.className = 'pv-lin-summary'; el.innerHTML = ''; return; }

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const error = Math.abs((avg - ref) / ref * 100);
  const pass = error <= 5.0;
  const f = v => Number(v).toFixed(2);
  const lo = ref * 0.95, hi = ref * 1.05;

  el.className = 'pv-lin-summary pv-lin-summary--' + (pass ? 'ok' : 'ng');
  el.innerHTML =
    `<span class="pv-lin-summary__label">평균 ${f(avg)}</span>` +
    `<span class="pv-lin-summary__sep">·</span>` +
    `<span class="pv-lin-summary__range">목표 ${f(lo)} ~ ${f(hi)}</span>` +
    `<span class="pv-lin-summary__sep">·</span>` +
    `<span class="pv-lin-summary__status">${pass ? '✓ 적합' : '✗ ' + f(error) + '%'}</span>`;
}

function updateDriftSummary(range) {
  const el = document.getElementById('pv_drift_summary');
  if (!el) return;
  const f2 = v => Number(v).toFixed(2);
  const z1=gv('z1'),z2=gv('z2'),z3=gv('z3'),z4=gv('z4');
  const s1=gv('s1'),s2=gv('s2'),s3=gv('s3'),s4=gv('s4');
  const hasZ = [z1,z2,z3,z4].every(v=>!isNaN(v)&&v>0);
  const hasS = [s1,s2,s3,s4].every(v=>!isNaN(v)&&v>0);
  if (!range || (!hasZ && !hasS)) { el.className='pv-lin-summary'; el.innerHTML=''; return; }
  const zd = hasZ ? Math.abs(((z3+z4)/2 - (z1+z2)/2) / range * 100) : null;
  const sd = hasS ? Math.abs(((s3+s4)/2 - (s1+s2)/2) / range * 100) : null;
  const limit = 5;
  // 엑셀: ROUND(drift, 1) <= 5 기준
  const r1 = v => Math.round(v * 10) / 10;
  const zPass = zd !== null ? r1(zd) <= limit : null;
  const sPass = sd !== null ? r1(sd) <= limit : null;
  const allPass = [zPass,sPass].filter(v=>v!==null).every(Boolean);
  const parts = [];
  if (zd !== null) parts.push(`Z ${r1(zd).toFixed(1)}%`);
  if (sd !== null) parts.push(`S ${r1(sd).toFixed(1)}%`);
  parts.push(`기준 ≤${limit}%`);
  el.className = 'pv-lin-summary pv-lin-summary--' + (allPass ? 'ok' : 'ng');
  el.innerHTML = parts.map((t,i) => i<parts.length-1
    ? `<span class="pv-lin-summary__label">${t}</span><span class="pv-lin-summary__sep">·</span>`
    : `<span class="pv-lin-summary__status">${allPass?'✓':''} ${t} ${allPass?'적합':'부적합'}</span>`
  ).join('');
}

function updateRepSummary(range) {
  const el = document.getElementById('pv_rep_summary');
  if (!el) return;
  const zVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[g('z1'),g('z2')],[g('z3'),g('z4')]);
  const sVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[g('s1'),g('s2')],[g('s3'),g('s4')]);

  // 통과 불가 여부 확인 (힌트가 참고 상태 = 어떤 S5를 넣어도 부적합)
  const zr = computeRepZ5Range([g('z1'),g('z2')],[g('z3'),g('z4')], range);
  const sr = computeRepZ5Range([g('s1'),g('s2')],[g('s3'),g('s4')], range);
  const zImpossible = range > 0 && !zr.passable;
  const sImpossible = range > 0 && !sr.passable;
  // 음수 입력도 부적합
  const z5v = gv('z5'), s5v = gv('s5');
  const zNeg = !isNaN(z5v) && z5v < 0;
  const sNeg = !isNaN(s5v) && s5v < 0;

  const hasZ = zVals.length >= 2 || zImpossible || zNeg;
  const hasS = sVals.length >= 2 || sImpossible || sNeg;
  if (!range || (!hasZ && !hasS)) { el.className='pv-lin-summary'; el.innerHTML=''; return; }

  const stdDiv = (vals, r) => {
    if (vals.length < 2) return null;
    const m = vals.reduce((a,b)=>a+b,0)/vals.length;
    const s = Math.sqrt(vals.reduce((a,v)=>a+(v-m)**2,0)/(vals.length-1));
    return r > 0 ? s/r*100 : s/m*100;
  };
  const zRsd = stdDiv(zVals, range), sRsd = stdDiv(sVals, range);
  const limit = 3;
  const r1 = v => Math.round(v * 10) / 10;
  // 통과불가 또는 음수 → 강제 부적합
  const zPass = (zImpossible || zNeg) ? false : (zRsd !== null ? r1(zRsd) <= limit : null);
  const sPass = (sImpossible || sNeg) ? false : (sRsd !== null ? r1(sRsd) <= limit : null);
  const allPass = [zPass,sPass].filter(v=>v!==null).every(Boolean);
  const parts = [];
  if (hasZ) parts.push(`Z ${(zImpossible||zNeg) ? '부적합' : (zRsd!==null ? r1(zRsd).toFixed(1)+'%' : '')}`);
  if (hasS) parts.push(`S ${(sImpossible||sNeg) ? '부적합' : (sRsd!==null ? r1(sRsd).toFixed(1)+'%' : '')}`);
  parts.push(`기준 ≤${limit}%`);
  el.className = 'pv-lin-summary pv-lin-summary--' + (allPass ? 'ok' : 'ng');
  el.innerHTML = parts.map((t,i) => i<parts.length-1
    ? `<span class="pv-lin-summary__label">${t}</span><span class="pv-lin-summary__sep">·</span>`
    : `<span class="pv-lin-summary__status">${allPass?'✓':''} ${t} ${allPass?'적합':'부적합'}</span>`
  ).join('');
}

// ── 실시간 입력 가이드 (비활성: 인라인 힌트로 대체) ──────────
function updateGuide(code) {
  const el = document.getElementById('pv-input-guide');
  if (el) el.hidden = true;
  return;
  if (!['TOC','TN','TP','SS','COD','TU','CL'].includes(code)) { el.hidden = true; return; }

  const range = g('range');
  if (!range) { el.hidden = true; return; }

  const driftTol = range * 0.05;
  const fmtR = (v) => isNaN(v) ? '—' : fmt(v, 3);

  // Z 값
  const z1=gv('z1'), z2=gv('z2'), z3=gv('z3'), z4=gv('z4');
  const s1=gv('s1'), s2=gv('s2'), s3=gv('s3'), s4=gv('s4');

  const mean = (...vs) => { const f=vs.filter(v=>!isNaN(v)); return f.length?f.reduce((a,b)=>a+b,0)/f.length:NaN; };

  const ziMean = mean(z1, z2);
  const siMean = mean(s1, s2);
  const zRepMean = NaN; // 반복성 별도 측정 입력 전까지 미표시
  const sRepMean = NaN;

  function rangeHtml(base, tol, label, cls='') {
    if (isNaN(base)) return '';
    const lo = base - tol, hi = base + tol;
    return `<div class="pv-guide-row">
      <span class="pv-guide-row__label">${label}</span>
      <span class="pv-guide-row__range${cls ? ' '+cls : ''}">${fmtR(lo)} ~ ${fmtR(hi)}</span>
    </div>`;
  }

  const rows = [];

  // 드리프트 허용 편차 (제목줄에 표시)

  // Z 가이드
  const zRows = [
    rangeHtml(ziMean, driftTol, 'Z 최종구간 평균(Z3,Z4) 목표', 'pv-guide-row__range--ok'),
    !isNaN(zRepMean) ? rangeHtml(zRepMean, zRepMean*0.03, 'Z 반복성 목표(±3%)') : '',
  ].filter(Boolean);
  if (zRows.length) {
    rows.push(`<div class="pv-guide-group">
      <div class="pv-guide-group__hd pv-guide-group__hd--z">🔵 Z (제로) 목표범위</div>
      ${zRows.join('')}
    </div>`);
  }

  // S 가이드
  const sRows = [
    rangeHtml(siMean, driftTol, 'S 최종구간 평균(S3,S4) 목표', 'pv-guide-row__range--ok'),
    !isNaN(sRepMean) ? rangeHtml(sRepMean, sRepMean*0.03, 'S 반복성 목표(±3%)') : '',
  ].filter(Boolean);
  if (sRows.length) {
    rows.push(`<div class="pv-guide-group">
      <div class="pv-guide-group__hd pv-guide-group__hd--s">🟢 S (스팬) 목표범위</div>
      ${sRows.join('')}
    </div>`);
  }

  // 2줄 심플 요약
  const zLine = [
    !isNaN(ziMean) ? `Z3·Z4 평균: ${fmtR(ziMean-driftTol)}~${fmtR(ziMean+driftTol)}` : null,
    !isNaN(zRepMean) ? `Z 반복성: ${fmtR(zRepMean*0.97)}~${fmtR(zRepMean*1.03)}` : null,
  ].filter(Boolean).join('  |  ');
  const sLine = [
    !isNaN(siMean) ? `S3·S4 평균: ${fmtR(siMean-driftTol)}~${fmtR(siMean+driftTol)}` : null,
    !isNaN(sRepMean) ? `S 반복성: ${fmtR(sRepMean*0.97)}~${fmtR(sRepMean*1.03)}` : null,
  ].filter(Boolean).join('  |  ');

  el.innerHTML = `<div class="pv-guide-title">적합 목표범위 — 범위 ${fmtR(range)} / 드리프트 허용 ±${fmtR(driftTol)}</div>
    ${zLine ? `<div class="pv-guide-row"><span class="pv-guide-row__label pv-guide-group__hd--z">🔵 Z</span><span>${zLine}</span></div>` : ''}
    ${sLine ? `<div class="pv-guide-row"><span class="pv-guide-row__label pv-guide-group__hd--s">🟢 S</span><span>${sLine}</span></div>` : ''}`;
  el.hidden = !(zLine || sLine);
}

function calculate(tabId) {

  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  if (IS_PH(tab.code))    { calcPH(tab);    return; }
  if (IS_DO(tab.code))    { calcDO(tab);     return; }
  if (IS_WATER(tab.code)) { calcWater(tab);  return; }
  calcBasic(tab);
}

// ── 탭 전환 ───────────────────────────────────────────────
function switchTab(id) {
  if (activeId && activeId !== id) saveData(activeId);
  activeId = id;
  saveMeta();

  document.querySelectorAll('.pv-item-tab').forEach(b =>
    b.classList.toggle('is-active', b.dataset.id === id));

  const tab = tabs.find(t => t.id === id);
  const formArea = document.getElementById('pv-form-area');
  if (!formArea || !tab) return;
  
  stored = loadData(id);
  formArea.innerHTML = buildForm(tab.code);

  const fields = getFields(tab.code);
  fields.forEach(f => {
    document.getElementById(`pv_${f}`)?.addEventListener('input', () => {
      saveData(id);
      updateGuide(tab.code);
      updateInlineHints(tab.code);
      if (g('range')) updateLinSummary(g('range'));
      clearTimeout(calcTimer);
      calcTimer = setTimeout(() => calculate(id), 300);
    });
  });
  updateGuide(tab.code);
  updateInlineHints(tab.code);
  if (g('range')) updateLinSummary(g('range'));

  if (IS_DO(tab.code) || hasData(tab.code)) calculate(id);
}

function hasData(code) {
  if (IS_PH(code)) return g('ph7a') || g('ph4a');
  if (IS_DO(code)) return g('dos1');
  return g('range');
}

// ── 탭 바 렌더 ──────────────────────────────────────────
function renderTabs() {
  const bar = document.getElementById('pv-tab-list');
  if (!bar) return;
  bar.innerHTML = tabs.map(t => `
    <div class="pv-tab-item">
      <button class="pv-item-tab${t.id===activeId?' is-active':''}"
        data-id="${t.id}" data-pass="${t.pass||''}" type="button">${t.label}</button>
      <button class="pv-tab-del" data-id="${t.id}" type="button" title="삭제">×</button>
    </div>`).join('');
  bar.querySelectorAll('.pv-item-tab').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.id)));
  bar.querySelectorAll('.pv-tab-del').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); removeTab(b.dataset.id); }));
}

function renderEmpty() {
  const formArea = document.getElementById('pv-form-area');
  if (formArea) formArea.innerHTML =
    `<div class="card pv-empty-state">
      <p>+ 추가를 눌러 검사 항목을 선택하세요</p>
      <p class="micro">TOC, TN, TP, SS, pH, DO, COD, TU, CL 중 선택</p>
    </div>`;
}

// ── 폼 HTML ──────────────────────────────────────────────
function ni(id, label, placeholder='0') {
  const val = stored[id] ?? '';
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="pv_${id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="${placeholder}" value="${val}"/></label>`;
}

function zsCell(id, num, type) {
  const val = stored[id] ?? '';
  const cls = type === 'z' ? 'z' : 's';
  // Z1/Z2/S1/S2 = 드리프트 초기 기준값, Z5/S5 = 반복성 기준값
  const hintHtml = (num === '1' || num === '2')
    ? `<span class="pv-zs-range-hint pv-zs-range-hint--ref">기준값</span>`
    : `<span class="pv-zs-range-hint" id="pv_hint_${id}"></span>`;
  return `<div class="pv-zs-cell pv-zs-cell--${cls}">
    <span class="pv-zs-badge pv-zs-badge--${cls}">${type.toUpperCase()}${num}</span>
    <div class="pv-zs-input-wrap">
      <input class="field__control pv-zs-input" id="pv_${id}" type="number" step="any" placeholder="0" value="${val}" />
      ${hintHtml}
    </div>
  </div>`;
}

function buildForm(code) {
  if (IS_PH(code))    return buildFormPH();
  if (IS_DO(code))    return buildFormDO();
  if (IS_WATER(code)) return buildFormWater(code);
  return buildFormBasic(code);
}

// ── 폼: 기본형 (TOC/TN/TP/SS/COD) ───────────────────────
function buildFormBasic(code) {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">측정범위</h3>
    <div class="pv-row1">${ni('range','')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">드리프트 측정 <span class="pv-hint">|평균(Z3,Z4)−평균(Z1,Z2)| / 범위 ≤ 5%</span></h3>
    <div class="pv-zs-table">
      <div class="pv-zs-section-label">초기구간</div>
      <div class="pv-zs-row">${zsCell('z1','1','z')}${zsCell('s1','1','s')}</div>
      <div class="pv-zs-row">${zsCell('z2','2','z')}${zsCell('s2','2','s')}</div>
      <div class="pv-zs-section-label pv-zs-section-label--sep">최종구간 (4시간 후)</div>
      <div class="pv-zs-row">${zsCell('z3','3','z')}${zsCell('s3','3','s')}</div>
      <div class="pv-zs-row">${zsCell('z4','4','z')}${zsCell('s4','4','s')}</div>
    </div>
    <div id="pv_drift_summary" class="pv-lin-summary"></div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">반복성 측정 <span class="pv-hint">1차 필수 · 2·3차 선택</span></h3>
    <div class="pv-zs-table">
      <div class="pv-zs-section-label">1차 (필수)</div>
      <div class="pv-zs-row">${zsCell('z5','5','z')}${zsCell('s5','5','s')}</div>
      <div class="pv-zs-section-label pv-zs-section-label--sep">2·3차 (선택)</div>
      <div class="pv-zs-row">${zsCell('z6','6','z')}${zsCell('s6','6','s')}</div>
      <div class="pv-zs-row">${zsCell('z7','7','z')}${zsCell('s7','7','s')}</div>
    </div>
    <div id="pv_rep_summary" class="pv-lin-summary"></div>
  </div>

  <div id="pv-input-guide" class="pv-guide-panel" hidden></div>

  <div class="pv-section">
    <h3 class="pv-section__title">직선성 <span class="pv-hint">평균값 오차 ≤ 5%</span></h3>
    <div class="pv-lin-wrap">
      <div class="pv-lin-header">
        <span>M1 — 저농도</span><span>M2 — 중농도</span><span>M3 — 고농도</span>
      </div>
      <div class="pv-lin-inputs">
        <div class="pv-lin-cell">${ni('m1','')}</div>
        <div class="pv-lin-cell">${ni('m2','')}</div>
        <div class="pv-lin-cell">${ni('m3','')}</div>
      </div>
      <div id="pv_lin_summary" class="pv-lin-summary"></div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">현장적용계수 <span class="pv-hint">(선택)</span></h3>
    <div class="pv-field-rounds">
      <div class="pv-field-round">
        <div class="pv-field-round__label"><span class="pv-field-round__badge">1</span>측정 1회차</div>
        <div class="pv-field-round__inputs">
          ${ni('ci1','현장값 Ci₁')}${ni('ai1','수분석 Ai₁')}${ni('ai2','수분석 Ai₂')}
        </div>
      </div>
      <div class="pv-field-round">
        <div class="pv-field-round__label"><span class="pv-field-round__badge">2</span>측정 2회차</div>
        <div class="pv-field-round__inputs">
          ${ni('ci2','현장값 Ci₂')}${ni('ai3','수분석 Ai₃')}${ni('ai4','수분석 Ai₄')}
        </div>
      </div>
    </div>
  </div>

  ${code==='TOC' ? `
  <div class="pv-section">
    <div class="pv-discharge-wrap">
      <div class="pv-discharge-wrap .field__label">⚠️ TOC 배출허용기준 (mg/L)</div>
      ${ni('fdis','배출기준값 mg/L — 없으면 0 입력')}
    </div>
  </div>` : ''}

  ${code==='COD' ? `
  <div class="pv-section">
    <h3 class="pv-section__title">포도당변동성시험 <span class="pv-hint">(선택)</span></h3>
    <div class="pv-grid2">${ni('codmax','최댓값')}${ni('codmin','최솟값')}</div>
  </div>` : ''}

  ${code==='TOC' ? `
  <div class="pv-section">
    <h3 class="pv-section__title">응답시간 (T90) <span class="pv-hint">기준: 15분 이하</span></h3>
    <div style="max-width:200px">${ni('resp','측정값 (분)')}</div>
    <p class="pv-zs-note" style="margin-top:6px">기준값 고정 ≤ 15분. 측정값을 분(min) 단위로 입력하세요.</p>
  </div>` : ''}
</div>

${buildResultsPanel(code)}`;
}

// ── 폼: pH ───────────────────────────────────────────────
function buildFormPH() {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">반복성
      <span class="pv-hint">pH7·pH4 각 3회 측정 (RSD ≤ 3%)</span>
    </h3>
    <div class="pv-zs-table">
      <div class="pv-zs-header"><span></span><span>pH 7 (저농도)</span><span>pH 4 (고농도)</span></div>
      <div class="pv-zs-row"><span class="pv-zs-label">1회</span>${ni('ph7a','pH7 ①')}${ni('ph4a','pH4 ①')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">2회</span>${ni('ph7b','pH7 ②')}${ni('ph4b','pH4 ②')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">3회</span>${ni('ph7c','pH7 ③')}${ni('ph4c','pH4 ③')}</div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">드리프트
      <span class="pv-hint">초기 → 2시간 후, |차|/14×100 ≤ 5%</span>
    </h3>
    <div class="pv-grid2">${ni('phdi','시험 초기')}${ni('phdf','2시간 후')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">직선성
      <span class="pv-hint">pH4·pH7·pH10 측정, max-min/14×100 ≤ 5%</span>
    </h3>
    <div class="pv-grid3">${ni('phm4','pH4 측정')}${ni('phm7','pH7 측정')}${ni('phm10','pH10 측정')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">온도보상시험
      <span class="pv-hint">기준: pH4.00 완충액, max-min ≤ 0.1</span>
    </h3>
    <div class="pv-grid3">
      ${ni('pht10','10℃ 측정')}${ni('pht15','15℃ 측정')}${ni('pht20','20℃ 측정')}
      ${ni('pht25','25℃ 측정')}${ni('pht30','30℃ 측정')}
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">현장적용계수 <span class="pv-hint">(선택, |Ai평균-Ci평균| ≤ 0.3)</span></h3>
    <div class="pv-field-rounds">
      <div class="pv-field-round">
        <div class="pv-field-round__label">1회차</div>
        <div class="pv-field-round__inputs">
          ${ni('phci1','현장측정값 Ci₁')}${ni('phai1','수분석 Ai₁')}${ni('phai2','수분석 Ai₂')}
        </div>
      </div>
      <div class="pv-field-round">
        <div class="pv-field-round__label">2회차</div>
        <div class="pv-field-round__inputs">
          ${ni('phci2','현장측정값 Ci₂')}${ni('phai3','수분석 Ai₃')}${ni('phai4','수분석 Ai₄')}
        </div>
      </div>
    </div>
  </div>
</div>

${buildResultsPanel('PH')}`;
}

// ── 폼: DO ───────────────────────────────────────────────
function buildFormDO() {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">반복성
      <span class="pv-hint">25℃ Span(8.263) 기준 S 3회 (RSD ≤ 3%)</span>
    </h3>
    <div class="pv-grid3">${ni('dos1','S1')}${ni('dos2','S2')}${ni('dos3','S3')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">드리프트
      <span class="pv-hint">초기 → 2시간 후, |차|/20×100 ≤ 5%</span>
    </h3>
    <div class="pv-zs-table">
      <div class="pv-zs-header"><span></span><span>Z (제로)</span><span>S (스팬)</span></div>
      <div class="pv-zs-row"><span class="pv-zs-label">시험 초기</span>${ni('dozi','Z 초기')}${ni('dosi','S 초기')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">2시간 후</span>${ni('dozf','Z 2시간')}${ni('dosf','S 2시간')}</div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">직선성
      <span class="pv-hint">(max-min)/20×100 ≤ 5%</span>
    </h3>
    <div class="pv-grid2">${ni('domax','최댓값')}${ni('domin','최솟값')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">온도보상시험
      <span class="pv-hint">20℃ 기준 9.092, 30℃ 기준 7.559, 오차 ≤ 5%</span>
    </h3>
    <div class="pv-grid2">${ni('dot20','20℃ 측정값')}${ni('dot30','30℃ 측정값')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">응답시간 (T90) <span class="pv-hint">기준: 120초 이하</span></h3>
    <div style="max-width:200px">${ni('resp','측정값 (초)')}</div>
    <p class="pv-zs-note" style="margin-top:6px">기준값 고정 ≤ 120초. 측정값만 입력하세요.</p>
  </div>
</div>

${buildResultsPanel('DO')}`;
}

// ── 폼: 먹는물 (TU/CL) ──────────────────────────────────
function buildFormWater(code) {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">측정범위</h3>
    <div class="pv-row1">${ni('range','')}</div>
  </div>

  <div class="pv-section">
    <div class="pv-zs-wrap">
      <div class="pv-zs-table">
        <div class="pv-zs-section-label">드리프트 초기구간</div>
        <div class="pv-zs-row">${zsCell('z1','1','z')}${zsCell('s1','1','s')}</div>
        <div class="pv-zs-row">${zsCell('z2','2','z')}${zsCell('s2','2','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">드리프트 최종구간</div>
        <div class="pv-zs-row">${zsCell('z3','3','z')}${zsCell('s3','3','s')}</div>
        <div class="pv-zs-row">${zsCell('z4','4','z')}${zsCell('s4','4','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">반복성 (1차 필수·2·3차 선택)</div>
        <div class="pv-zs-row">${zsCell('z5','5','z')}${zsCell('s5','5','s')}</div>
        <div class="pv-zs-row">${zsCell('z6','6','z')}${zsCell('s6','6','s')}</div>
        <div class="pv-zs-row">${zsCell('z7','7','z')}${zsCell('s7','7','s')}</div>
      </div>
      <p class="pv-zs-note">드리프트: |평균(Z3,Z4)−평균(Z1,Z2)| / 범위 ≤ 3% | 반복성: 4콤보 MAX STDEV / 범위 ≤ 3%</p>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">직선성 — 주입농도값 M</h3>
    <div class="pv-row1">${ni('m1','M')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">응답시간 (T90)
      <span class="pv-hint">기준: S1 × 0.5 자동계산. 시약식은 해당 없음.</span>
    </h3>
    <div class="pv-resp-water">
      <label class="pv-resp-toggle">
        <input type="checkbox" id="pv_resp_skip" />
        <span>시약식 — 응답시간 시험 해당 없음</span>
      </label>
      <div id="pv_resp_fields" style="margin-top:8px">
        <div style="max-width:200px">${ni('resp','측정값 (mm)')}</div>
        <p class="pv-zs-note" style="margin-top:4px" id="pv_resp_criterion">기준: S1 입력 후 자동계산 (S1 × 0.5)</p>
      </div>
    </div>
  </div>
</div>

${buildResultsPanel(code)}`;
}

// ── 결과 패널 HTML ───────────────────────────────────────
function buildResultsPanel(code) {
  const extraBlocks = [];
  if (IS_PH(code) || IS_DO(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-tc-block" hidden>
      <h4 class="pv-res-block__title">온도보상시험</h4><div id="pv-res-tc"></div></div>`);
  }
  if (!IS_DO(code) && !IS_WATER(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-field-block" hidden>
      <h4 class="pv-res-block__title">현장적용계수</h4><div id="pv-res-field"></div></div>`);
  }
  if (IS_COD(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-gluc-block" hidden>
      <h4 class="pv-res-block__title">포도당변동성시험</h4><div id="pv-res-gluc"></div></div>`);
  }
  // 기본형(TOC/TN/TP/SS/COD)에는 측정범위 초과 블록 추가
  if (!IS_PH(code) && !IS_DO(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-range-block" hidden>
      <h4 class="pv-res-block__title">측정범위 검사</h4><div id="pv-res-range"></div></div>`);
  }
  // 응답시간: TOC, DO(buildFormDO에서 처리), TU, CL, pH(buildFormPH에서 처리)
  if (code === 'TOC' || IS_DO(code) || IS_WATER(code) || IS_PH(code)) {
    extraBlocks.push(`<div class="pv-res-block" id="pv-res-resp-block" hidden>
      <h4 class="pv-res-block__title">응답시간 (T90)</h4><div id="pv-res-resp"></div></div>`);
  }
  return `
<div id="pv-results" class="card pv-results-card" hidden>
  <h3 class="pv-section__title" style="margin-bottom:16px">검사 결과</h3>
  <div class="pv-res-grid">
    <div class="pv-res-block"><h4 class="pv-res-block__title">반복성 (RSD)</h4><div id="pv-res-rep"></div></div>
    <div class="pv-res-block"><h4 class="pv-res-block__title">드리프트</h4><div id="pv-res-drift"></div></div>
    <div class="pv-res-block"><h4 class="pv-res-block__title">직선성</h4><div id="pv-res-lin"></div></div>
    ${extraBlocks.join('\n    ')}
  </div>
  <div id="pv-final"></div>
  <div class="pv-legal-wrap">
    <div class="pv-legal-header">
      <span class="pv-legal-title">📋 법령근거 · 정도검사기준</span>
      <span class="pv-legal-badge">국가법령정보센터</span>
    </div>
    <div id="pv-legal-content" class="pv-legal-content"></div>
  </div>
  <div style="text-align:right;margin-top:12px">
    <button class="btn btn--ghost btn--mini" id="pv-cert-btn-result" type="button">성적서 출력</button>
  </div>
</div>`;
}

// ── 성적서 ───────────────────────────────────────────────
function certRow(l,v,p) {
  const color = p===null?'#888':p?'#1a7f37':'#cf222e';
  const verdict = p===null?'—':p?'적합':'부적합';
  return `<tr>
    <td style="padding:7px 10px;border:1px solid #ccc">${l}</td>
    <td style="padding:7px 10px;border:1px solid #ccc">${v}</td>
    <td style="padding:7px 10px;border:1px solid #ccc;font-weight:600;color:${color}">${verdict}</td></tr>`;
}

function showCert(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  const date = new Date().toLocaleDateString('ko-KR');
  let rows = '';
  let allPass = true;
  const addRow = (l, v, p) => { rows += certRow(l, v, p); if (!p) allPass = false; };

  if (IS_PH(tab.code)) {
    const rep = repeatability([g('ph7a'),g('ph7b'),g('ph7c')],[g('ph4a'),g('ph4b'),g('ph4c')]);
    const dr = drift(14,[g('phdi')],[g('phdf')],[g('phdi')],[g('phdf')]);
    const lin = phLinearity([g('phm4'),g('phm7'),g('phm10')]);
    addRow(`pH7 반복성 RSD ≤ ${rep.limit}%`, `${fmt(rep.zero.rsd)}%`, rep.zero.pass);
    addRow(`pH4 반복성 RSD ≤ ${rep.limit}%`, `${fmt(rep.span.rsd)}%`, rep.span.pass);
    addRow(`드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, `${fmt(dr.zeroDrift)}%`, dr.zeroPass);
    addRow(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, `${fmt(lin.error)}%`, lin.pass);
    const tc = phTemperatureComp({t10:g('pht10'),t15:g('pht15'),t20:g('pht20'),t25:g('pht25'),t30:g('pht30')});
    if (tc.pass !== null) addRow(`온도보상 max-min ≤ ${PRECISION_CRITERIA.phTempComp}`, fmt(tc.range,3), tc.pass);
  } else if (IS_DO(tab.code)) {
    const rep = repeatability([],[g('dos1'),g('dos2'),g('dos3')]);
    const dr = drift(20,[g('dozi')],[g('dozf')],[g('dosi')],[g('dosf')]);
    const lin = doLinearity(g('domax'),g('domin'),20);
    addRow(`DO 반복성 RSD ≤ ${rep.limit}%`, `${fmt(rep.span.rsd)}%`, rep.span.pass);
    addRow(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, `${fmt(dr.zeroDrift)}%`, dr.zeroPass);
    addRow(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, `${fmt(dr.spanDrift)}%`, dr.spanPass);
    addRow(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, `${fmt(lin.error)}%`, lin.pass);
    if (g('dot20')||g('dot30')) {
      const tc = doTemperatureComp(g('dot20'),g('dot30'),DO_SPAN_TABLE[25]);
      addRow(`20℃ 온도보상 ≤ ${PRECISION_CRITERIA.doTempComp}%`, `${fmt(tc.t20.error)}%`, tc.t20.pass);
      addRow(`30℃ 온도보상 ≤ ${PRECISION_CRITERIA.doTempComp}%`, `${fmt(tc.t30.error)}%`, tc.t30.pass);
    }
  } else {
    const range = g('range');
    const zRepVals = pickRepVals(gv('z5'),gv('z6'),gv('z7'),[g('z1'),g('z2')],[g('z3'),g('z4')]);
    const sRepVals = pickRepVals(gv('s5'),gv('s6'),gv('s7'),[g('s1'),g('s2')],[g('s3'),g('s4')]);
    const rep = repeatability(zRepVals, sRepVals, range);
    const isWater = IS_WATER(tab.code);
    const driftLim = isWater ? 3 : PRECISION_CRITERIA.zeroDrift;
    const dr = drift(range,[g('z1'),g('z2')],[g('z3'),g('z4')],[g('s1'),g('s2')],[g('s3'),g('s4')],
      isWater ? {zero:3,span:3} : undefined);
    const linRef = isWater && g('s1') > 0 ? g('s1')/2 : undefined;
    const lin = linearity(range, isWater ? [g('m1')] : [g('m1'),g('m2'),g('m3')], linRef);
    addRow(`저농도 반복성 RSD ≤ ${rep.limit}%`, rep.zero.pass===null?'—':`${fmt(rep.zero.rsd)}%`, rep.zero.pass);
    addRow(`고농도 반복성 RSD ≤ ${rep.limit}%`, rep.span.pass===null?'—':`${fmt(rep.span.rsd)}%`, rep.span.pass);
    addRow(`제로드리프트 ≤ ${driftLim}%`, `${fmt(dr.zeroDrift)}%`, dr.zeroPass);
    addRow(`스팬드리프트 ≤ ${driftLim}%`, `${fmt(dr.spanDrift)}%`, dr.spanPass);
    addRow(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, `${fmt(lin.error)}%`, lin.pass);
    const ci1=g('ci1'),ci2=g('ci2'),ai1=g('ai1'),ai2=g('ai2'),ai3=g('ai3'),ai4=g('ai4');
    if (ci1||ci2||ai1||ai2||ai3||ai4) {
      const fRes = fieldApplication(tab.code,[ai1,ai2,ai3,ai4],[ci1,ci2],{discharge:g('fdis')});
      addRow(`${tab.code} 현장적용계수`, `|Ai-Ci|=${fmt(Math.abs(fRes.labMean-fRes.siteMean),3)}`, fRes.pass);
    }
    if (IS_COD(tab.code) && (g('codmax')||g('codmin'))) {
      const gRes = codGlucoseVariability(g('codmax'),g('codmin'),range);
      addRow(`포도당변동성 ≤ ${PRECISION_CRITERIA.codGlucose}%`, `${fmt(gRes.error)}%`, gRes.pass);
    }
    const resp=g('resp'),respLimit=g('resp_limit');
    if (resp&&respLimit) addRow(`응답시간(T90) ≤ ${fmt(respLimit,0)}초`, `${fmt(resp,0)}초`, resp<=respLimit);
  }

  const ov = document.createElement('div');
  ov.id = 'cert-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#fff;color:#000;max-width:660px;width:100%;border-radius:12px;overflow:auto;max-height:90vh;padding:36px;font-family:sans-serif">
      <div style="text-align:center;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #000">
        <h2 style="font-size:20px;font-weight:700;margin:0">수질TMS 정도검사 성적서</h2>
        <p style="margin:4px 0 0;font-size:12px;color:#666">KTL 전문 계측 서비스</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px">
        <tr><td style="padding:4px 0;width:90px;color:#666">검사 항목</td><td style="font-weight:600">${tab.label}</td></tr>
        <tr><td style="padding:4px 0;color:#666">검사일</td><td>${date}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
        <thead><tr style="background:#f0f0f0">
          <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">검사항목</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">수치</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #ccc;width:70px">판정</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="border:2px solid ${allPass?'#1a7f37':'#cf222e'};border-radius:8px;padding:12px;text-align:center;font-size:17px;font-weight:700;color:${allPass?'#1a7f37':'#cf222e'}">
        최종 판정: ${allPass?'✅ 전 항목 적합':'❌ 부적합 항목 있음'}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button onclick="window.print()" style="padding:8px 18px;background:#0969da;color:#fff;border:0;border-radius:6px;cursor:pointer">인쇄/PDF</button>
        <button onclick="document.getElementById('cert-overlay').remove()" style="padding:8px 18px;background:#f0f0f0;border:0;border-radius:6px;cursor:pointer">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
}

// ── 초기화 ───────────────────────────────────────────────
function init() {
  const panel = document.getElementById('panel-precision');
  if (!panel) return;

  loadMeta();
  if (!activeId || !tabs.find(t => t.id === activeId)) {
    activeId = tabs.length ? tabs[0].id : null;
  }

  panel.innerHTML = `
<div class="pv-page">
  <div class="card pv-tab-card">
    <div class="pv-tab-bar">
      <div id="pv-tab-list" class="pv-item-tabs"></div>
      <div class="pv-add-wrap">
        <button class="btn btn--primary btn--mini pv-add-btn" id="pv-add-btn" type="button">+ 추가</button>
        <div id="pv-add-menu" class="pv-add-menu" hidden>
          ${ITEMS.map(it=>`<button class="pv-add-item" data-code="${it.code}" type="button">${it.label}</button>`).join('')}
        </div>
      </div>
      <button class="btn btn--ghost btn--mini" id="pv-cert-btn" type="button">성적서 출력</button>
    </div>
  </div>
  <div id="pv-form-area"></div>
</div>`;

  renderTabs();

  const addBtn = document.getElementById('pv-add-btn');
  const addMenu = document.getElementById('pv-add-menu');
  addBtn?.addEventListener('click', e => { e.stopPropagation(); addMenu.hidden = !addMenu.hidden; });
  document.addEventListener('click', () => { if (addMenu) addMenu.hidden = true; });
  panel.querySelectorAll('.pv-add-item').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); addMenu.hidden=true; addTab(b.dataset.code); }));

  document.getElementById('pv-cert-btn')?.addEventListener('click', () => {
    if (activeId) showCert(activeId);
  });
  panel.addEventListener('click', e => {
    if (e.target.id === 'pv-cert-btn-result' && activeId) showCert(activeId);
  });

  if (activeId) switchTab(activeId);
  else renderEmpty();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
