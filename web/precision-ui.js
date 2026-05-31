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
    'z1','z2','z3','z4','z5','s1','s2','s3','s4','s5',
    'm1','resp','resp_limit',
  ];
  // TOC/TN/TP/SS/COD (기본형)
  const base = [
    'range',
    'z1','z2','z3','z4','z5',  // 드리프트+반복성
    's1','s2','s3','s4','s5',  // 드리프트+반복성
    'm1','m2','m3',             // 직선성
    'ci1','ai1','ai2','ci2','ai3','ai4','fdis', // 현장적용
  ];
  if (code === 'TOC') base.push('resp','resp_limit'); // TOC만 응답시간
  if (IS_COD(code)) base.push('codmax','codmin');    // COD 포도당변동성
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

/**
 * 게이지 바 생성.
 * @param {number} val   측정값 (%)
 * @param {number} limit 기준 (%)
 * @param {string} label 라벨
 * @param {boolean} lowerIsBetter 값이 작을수록 적합 (기본 true)
 */
function gauge(val, limit, label, lowerIsBetter = true) {
  if (!val && val !== 0) return '';
  const pass = lowerIsBetter ? val <= limit : val >= limit;
  const maxRange = lowerIsBetter ? Math.max(limit * 2.5, val * 1.2, 0.01) : Math.max(limit * 1.5, val * 1.2, 0.01);
  const limitPct = Math.min((limit / maxRange) * 100, 100);
  const fillPct  = Math.min((val / maxRange) * 100, 100);
  const cls = pass ? 'ok' : 'bad';
  return `
<div class="pv-gauge">
  <div class="pv-gauge__header">
    <span class="pv-gauge__val pv-gauge__val--${cls}">${fmt(val, 2)}%</span>
    <span class="pv-gauge__limit-label">${label} 기준 ${lowerIsBetter ? '≤' : '≥'} ${limit}%</span>
  </div>
  <div class="pv-gauge__track">
    <div class="pv-gauge__zone-bad" style="left:${limitPct}%"></div>
    <div class="pv-gauge__limit-line" style="left:${limitPct}%"></div>
    <div class="pv-gauge__fill pv-gauge__fill--${cls}" style="width:${fillPct}%"></div>
  </div>
  <div class="pv-gauge__footer">
    <span>0%</span>
    <span class="pv-gauge__footer-limit">기준 ${limit}%</span>
    <span>${fmt(maxRange,1)}%</span>
  </div>
</div>`;
}

// ── 계산: 기본형 (TOC/TN/TP/SS/COD) ─────────────────────
function calcBasic(tab) {
  const range = g('range');
  if (!range) return;

  // 반복성: Z1,Z3,Z5 / S1,S3,S5
  const rep = repeatability([g('z1'),g('z3'),g('z5')], [g('s1'),g('s3'),g('s5')]);
  document.getElementById('pv-res-rep').innerHTML =
    `<div class="pv-lines">
      ${row('저농도(Z) 평균', fmt(rep.zero.mean,4))} ${row('RSD', `${fmt(rep.zero.rsd)}%`)}
      ${row('고농도(S) 평균', fmt(rep.span.mean,4))} ${row('RSD', `${fmt(rep.span.rsd)}%`)}
    </div>
    ${gauge(rep.zero.rsd, rep.limit, '저농도 RSD')}
    ${gauge(rep.span.rsd, rep.limit, '고농도 RSD')}
    <div class="pv-badges">
      ${badge(`저농도 RSD ≤ ${rep.limit}%`, rep.zero.pass)}
      ${badge(`고농도 RSD ≤ ${rep.limit}%`, rep.span.pass)}
    </div>`;

  // 드리프트: 초기[Z1,Z2] → 최종[Z3,Z4] / 초기[S1,S2] → 최종[S3,S4]
  const dr = drift(range, [g('z1'),g('z2')], [g('z3'),g('z4')], [g('s1'),g('s2')], [g('s3'),g('s4')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('제로드리프트', `${fmt(dr.zeroDrift)}%`)}
      ${row('스팬드리프트', `${fmt(dr.spanDrift)}%`)}
    </div>
    ${gauge(dr.zeroDrift, PRECISION_CRITERIA.zeroDrift, '제로드리프트')}
    ${gauge(dr.spanDrift, PRECISION_CRITERIA.spanDrift, '스팬드리프트')}
    <div class="pv-badges">
      ${badge(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, dr.zeroPass)}
      ${badge(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, dr.spanPass)}
    </div>`;

  // 직선성: M1,M2,M3
  const lin = linearity(range, [g('m1'),g('m2'),g('m3')]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값', fmt(lin.ref,4))} ${row('평균', fmt(lin.avg,4))} ${row('오차', `${fmt(lin.error)}%`)}
    </div>
    ${gauge(lin.error, PRECISION_CRITERIA.linearity, '직선성 오차')}
    <div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  const passes = [rep.zero.pass, rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass];

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

  // 응답시간 (TOC 전용)
  if (tab.code === 'TOC') {
    const resp = g('resp');
    const respLimit = 900;
    let respPass = null;
    const respBlock = document.getElementById('pv-res-resp-block');
    if (resp) {
      respPass = resp <= respLimit;
      document.getElementById('pv-res-resp').innerHTML =
        `<div class="pv-lines">
          ${row('측정값 (T90)', `${fmt(resp,0)}초`)}
          ${row('기준', '≤ 900초 (15분)')}
        </div><div class="pv-badges">${badge(`응답시간 ≤ 900초`, respPass)}</div>`;
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
  document.getElementById('pv-res-rep').innerHTML =
    `<div class="pv-lines">
      ${row('pH7 평균', fmt(rep.zero.mean,3))} ${row('RSD', `${fmt(rep.zero.rsd)}%`)}
      ${row('pH4 평균', fmt(rep.span.mean,3))} ${row('RSD', `${fmt(rep.span.rsd)}%`)}
    </div><div class="pv-badges">
      ${badge(`pH7 RSD ≤ ${rep.limit}%`, rep.zero.pass)}
      ${badge(`pH4 RSD ≤ ${rep.limit}%`, rep.span.pass)}
    </div>`;

  const dr = drift(14, [g('phdi')], [g('phdf')], [g('phdi')], [g('phdf')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('드리프트 초기', fmt(g('phdi'),3))}
      ${row('드리프트 2시간후', fmt(g('phdf'),3))}
      ${row('드리프트', `${fmt(dr.zeroDrift)}%`)}
    </div><div class="pv-badges">
      ${badge(`드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, dr.zeroPass)}
    </div>`;

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

  const rep = repeatability([span,span,span], [g('dos1'),g('dos2'),g('dos3')]);
  document.getElementById('pv-res-rep').innerHTML =
    `<div class="pv-lines">
      ${row('S1', fmt(g('dos1'),3))} ${row('S2', fmt(g('dos2'),3))} ${row('S3', fmt(g('dos3'),3))}
      ${row('평균', fmt(rep.span.mean,3))} ${row('RSD', `${fmt(rep.span.rsd)}%`)}
    </div><div class="pv-badges">
      ${badge(`DO 반복성 RSD ≤ ${rep.limit}%`, rep.span.pass)}
    </div>`;

  const dr = drift(range, [g('dozi')], [g('dozf')], [g('dosi')], [g('dosf')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('Z초기', fmt(g('dozi'),3))} ${row('Z2시간', fmt(g('dozf'),3))} ${row('제로드리프트', `${fmt(dr.zeroDrift)}%`)}
      ${row('S초기', fmt(g('dosi'),3))} ${row('S2시간', fmt(g('dosf'),3))} ${row('스팬드리프트', `${fmt(dr.spanDrift)}%`)}
    </div><div class="pv-badges">
      ${badge(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, dr.zeroPass)}
      ${badge(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, dr.spanPass)}
    </div>`;

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
  const pfx = tab.code + '_';
  const range = g('range');
  if (!range) return;
  const rep = repeatability([g('z1'),g('z3'),g('z5')], [g('s1'),g('s3'),g('s5')]);
  document.getElementById('pv-res-rep').innerHTML =
    `<div class="pv-lines">
      ${row('Z 평균', fmt(rep.zero.mean,4))} ${row('Z RSD', `${fmt(rep.zero.rsd)}%`)}
      ${row('S 평균', fmt(rep.span.mean,4))} ${row('S RSD', `${fmt(rep.span.rsd)}%`)}
    </div><div class="pv-badges">
      ${badge(`Z RSD ≤ ${rep.limit}%`, rep.zero.pass)}
      ${badge(`S RSD ≤ ${rep.limit}%`, rep.span.pass)}
    </div>`;
  const dr = drift(range, [g('z1'),g('z2')], [g('z3'),g('z4')], [g('s1'),g('s2')], [g('s3'),g('s4')]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('제로드리프트', `${fmt(dr.zeroDrift)}%`)} ${row('스팬드리프트', `${fmt(dr.spanDrift)}%`)}
    </div><div class="pv-badges">
      ${badge(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, dr.zeroPass)}
      ${badge(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, dr.spanPass)}
    </div>`;
  const lin = linearity(range, [g('m1'),g('m1'),g('m1')]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('주입농도 M', fmt(g('m1'),3))} ${row('오차', `${fmt(lin.error)}%`)}
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
  const passes = [rep.zero.pass, rep.span.pass, dr.zeroPass, dr.spanPass, lin.pass];
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
}

// ── 실시간 입력 가이드 ───────────────────────────────────────
function updateGuide(code) {
  const el = document.getElementById('pv-input-guide');
  if (!el) return;
  if (!['TOC','TN','TP','SS','COD','TU','CL'].includes(code)) { el.hidden = true; return; }

  const range = g('range');
  if (!range) { el.hidden = true; return; }

  const driftTol = range * 0.05;
  const fmtR = (v) => isNaN(v) ? '—' : fmt(v, 3);

  // Z 값
  const z1=gv('z1'), z2=gv('z2'), z3=gv('z3'), z4=gv('z4'), z5=gv('z5');
  const s1=gv('s1'), s2=gv('s2'), s3=gv('s3'), s4=gv('s4'), s5=gv('s5');

  const mean = (...vs) => { const f=vs.filter(v=>!isNaN(v)); return f.length?f.reduce((a,b)=>a+b,0)/f.length:NaN; };

  const ziMean = mean(z1, z2);
  const siMean = mean(s1, s2);
  const zRepMean = mean(z1, z3, z5);
  const sRepMean = mean(s1, s3, s5);

  function rangeHtml(base, tol, label, cls='') {
    if (isNaN(base)) return '';
    const lo = base - tol, hi = base + tol;
    return `<div class="pv-guide-row">
      <span class="pv-guide-row__label">${label}</span>
      <span class="pv-guide-row__range${cls ? ' '+cls : ''}">${fmtR(lo)} ~ ${fmtR(hi)}</span>
    </div>`;
  }

  const rows = [];

  // 드리프트 허용 편차
  rows.push(`<div class="pv-guide-row">
    <span class="pv-guide-row__label">드리프트 허용 편차 (범위×5%)</span>
    <span class="pv-guide-row__range">≤ ${fmtR(driftTol)}</span>
  </div>`);

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

  el.innerHTML = `
    <div class="pv-guide-title">📌 입력 가이드 &nbsp;|&nbsp; 측정범위 ${fmtR(range)}</div>
    ${rows.join('')}`;
  el.hidden = false;
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
      clearTimeout(calcTimer);
      calcTimer = setTimeout(() => calculate(id), 300);
    });
  });
  updateGuide(tab.code);

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
  return `<div class="pv-zs-cell pv-zs-cell--${cls}">
    <span class="pv-zs-badge pv-zs-badge--${cls}">${type.toUpperCase()}${num}</span>
    <input class="field__control pv-zs-input" id="pv_${id}" type="number" step="any" placeholder="0" value="${val}" />
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
    <div class="pv-row1">${ni('range','측정범위')}</div>
  </div>

  <div class="pv-section">
    <div class="pv-zs-wrap">
      <div class="pv-zs-table">
        <div class="pv-zs-header">
          <div class="pv-zs-col-z">Z (제로)</div>
          <div class="pv-zs-col-s">S (스팬)</div>
        </div>
        <div class="pv-zs-section-label">드리프트 초기구간</div>
        <div class="pv-zs-row">${zsCell('z1','1','z')}${zsCell('s1','1','s')}</div>
        <div class="pv-zs-row">${zsCell('z2','2','z')}${zsCell('s2','2','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">드리프트 최종구간 (4시간 후)</div>
        <div class="pv-zs-row">${zsCell('z3','3','z')}${zsCell('s3','3','s')}</div>
        <div class="pv-zs-row">${zsCell('z4','4','z')}${zsCell('s4','4','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">반복성 추가 측정</div>
        <div class="pv-zs-row">${zsCell('z5','5','z')}${zsCell('s5','5','s')}</div>
      </div>
      <p class="pv-zs-note">반복성: RSD(Z1·Z3·Z5) &amp; RSD(S1·S3·S5) ≤ 3% &nbsp;|&nbsp; 드리프트: |평균(Z3,Z4)−평균(Z1,Z2)| / 범위 ≤ 5%</p>
    </div>
  </div>

  <div id="pv-input-guide" class="pv-guide-panel" hidden></div>

  <div class="pv-section">
    <h3 class="pv-section__title">직선성 <span class="pv-hint">오차 ≤ 5%</span></h3>
    <div class="pv-lin-wrap">
      <div class="pv-lin-header">
        <span>M1</span><span>M2</span><span>M3</span>
      </div>
      <div class="pv-lin-inputs">
        <div class="pv-lin-cell">${ni('m1','M1')}<span class="pv-lin-cell-label">저농도</span></div>
        <div class="pv-lin-cell">${ni('m2','M2')}<span class="pv-lin-cell-label">중농도</span></div>
        <div class="pv-lin-cell">${ni('m3','M3')}<span class="pv-lin-cell-label">고농도</span></div>
      </div>
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
    <h3 class="pv-section__title">응답시간 (T90) <span class="pv-hint">기준: 900초(15분) 이하</span></h3>
    <div style="max-width:200px">${ni('resp','측정값 (초)')}</div>
    <p class="pv-zs-note" style="margin-top:6px">기준값 고정 ≤ 900초(15분). 측정값만 입력하세요.</p>
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
    <div class="pv-row1">${ni('range','측정범위')}</div>
  </div>

  <div class="pv-section">
    <div class="pv-zs-wrap">
      <div class="pv-zs-table">
        <div class="pv-zs-header">
          <div class="pv-zs-col-z">Z (제로)</div>
          <div class="pv-zs-col-s">S (스팬)</div>
        </div>
        <div class="pv-zs-section-label">드리프트 초기구간</div>
        <div class="pv-zs-row">${zsCell('z1','1','z')}${zsCell('s1','1','s')}</div>
        <div class="pv-zs-row">${zsCell('z2','2','z')}${zsCell('s2','2','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">드리프트 최종구간</div>
        <div class="pv-zs-row">${zsCell('z3','3','z')}${zsCell('s3','3','s')}</div>
        <div class="pv-zs-row">${zsCell('z4','4','z')}${zsCell('s4','4','s')}</div>
        <div class="pv-zs-section-label pv-zs-section-label--sep">반복성 추가</div>
        <div class="pv-zs-row">${zsCell('z5','5','z')}${zsCell('s5','5','s')}</div>
      </div>
      <p class="pv-zs-note">반복성: RSD(Z1·Z3·Z5) &amp; RSD(S1·S3·S5) | 드리프트: |평균(Z3,Z4)−평균(Z1,Z2)| / 범위 ≤ 5%</p>
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
  <div style="text-align:right;margin-top:12px">
    <button class="btn btn--ghost btn--mini" id="pv-cert-btn-result" type="button">성적서 출력</button>
  </div>
</div>`;
}

// ── 성적서 ───────────────────────────────────────────────
function certRow(l,v,p) {
  return `<tr>
    <td style="padding:7px 10px;border:1px solid #ccc">${l}</td>
    <td style="padding:7px 10px;border:1px solid #ccc">${v}</td>
    <td style="padding:7px 10px;border:1px solid #ccc;font-weight:600;color:${p?'#1a7f37':'#cf222e'}">${p?'적합':'부적합'}</td></tr>`;
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
    const rep = repeatability([g('z1'),g('z3'),g('z5')],[g('s1'),g('s3'),g('s5')]);
    const dr = drift(range,[g('z1'),g('z2')],[g('z3'),g('z4')],[g('s1'),g('s2')],[g('s3'),g('s4')]);
    const lin = IS_WATER(tab.code)
      ? linearity(range,[g('m1'),g('m1'),g('m1')])
      : linearity(range,[g('m1'),g('m2'),g('m3')]);
    addRow(`저농도 반복성 RSD ≤ ${rep.limit}%`, `${fmt(rep.zero.rsd)}%`, rep.zero.pass);
    addRow(`고농도 반복성 RSD ≤ ${rep.limit}%`, `${fmt(rep.span.rsd)}%`, rep.span.pass);
    addRow(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, `${fmt(dr.zeroDrift)}%`, dr.zeroPass);
    addRow(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, `${fmt(dr.spanDrift)}%`, dr.spanPass);
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
