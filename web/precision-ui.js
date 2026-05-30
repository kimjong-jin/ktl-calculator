/**
 * 수질TMS 정도검사 UI
 * - 항목별 탭 (TOC/TN/TP/SS/pH/DO/COD/TU/CL)
 * - 탭마다 독립 입력값 + 결과 실시간 저장 (localStorage)
 * - 입력값 변경 시 자동 계산
 */
import {
  PRECISION_CRITERIA,
  repeatability, drift, linearity, fieldApplication,
} from '../src/precision.js';

const fmt = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : '–');

const ITEMS = [
  { code: 'TOC', label: 'TOC' },
  { code: 'TN',  label: 'TN' },
  { code: 'TP',  label: 'TP' },
  { code: 'SS',  label: 'SS' },
  { code: 'PH',  label: 'pH' },
  { code: 'DO',  label: 'DO' },
  { code: 'COD', label: 'COD' },
  { code: 'TU',  label: 'TU' },
  { code: 'CL',  label: 'CL' },
];

const FIELDS = ['range','z1','z2','z3','z4','z5','s1','s2','s3','s4','s5','m1','m2','m3','fa1','fa2','fs1','fs2','fdis'];

const STORAGE_KEY = code => `ktl-pv-${code}`;

function saveState(code) {
  const state = {};
  FIELDS.forEach(id => {
    const el = document.getElementById(`pv_${id}`);
    if (el) state[id] = el.value;
  });
  try { localStorage.setItem(STORAGE_KEY(code), JSON.stringify(state)); } catch {}
}

function loadState(code) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(code));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function g(id) { return parseFloat(document.getElementById(`pv_${id}`)?.value) || 0; }

function badge(label, pass) {
  if (pass === null) return `<div class="pv-badge pv-badge--na">— ${label}</div>`;
  return pass
    ? `<div class="pv-badge pv-badge--ok">✅ ${label} 적합</div>`
    : `<div class="pv-badge pv-badge--bad">❌ ${label} 부적합</div>`;
}
function row(k, v) {
  return `<div class="pv-line"><span>${k}</span><b>${v}</b></div>`;
}

function calculate(itemCode) {
  const range = g('range');
  if (!range) return; // 측정범위 없으면 계산 안 함

  const z1=g('z1'),z2=g('z2'),z3=g('z3'),z4=g('z4'),z5=g('z5');
  const s1=g('s1'),s2=g('s2'),s3=g('s3'),s4=g('s4'),s5=g('s5');
  const m1=g('m1'),m2=g('m2'),m3=g('m3');

  // 반복성 (RSD)
  const rep = repeatability([z1,z2,z3],[s1,s2,s3]);
  document.getElementById('pv-res-rep').innerHTML =
    `<div class="pv-lines">
      ${row('저농도 평균', fmt(rep.zero.mean,4))}
      ${row('저농도 RSD', `${fmt(rep.zero.rsd)}%`)}
      ${row('고농도 평균', fmt(rep.span.mean,4))}
      ${row('고농도 RSD', `${fmt(rep.span.rsd)}%`)}
    </div>
    <div class="pv-badges">
      ${badge(`저농도 RSD ≤ ${rep.limit}%`, rep.zero.pass)}
      ${badge(`고농도 RSD ≤ ${rep.limit}%`, rep.span.pass)}
    </div>`;

  // 드리프트
  const dr = drift(range,[z2,z3],[z4,z5],[s2,s3],[s4,s5]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('제로 드리프트', `${fmt(dr.zeroDrift)}%`)}
      ${row('스팬 드리프트', `${fmt(dr.spanDrift)}%`)}
    </div>
    <div class="pv-badges">
      ${badge(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift)}
      ${badge(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, dr.spanDrift<=PRECISION_CRITERIA.spanDrift)}
    </div>`;

  // 직선성
  const lin = linearity(range,[m1,m2,m3]);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값', fmt(lin.ref,4))}
      ${row('평균', fmt(lin.avg,4))}
      ${row('오차', `${fmt(lin.error)}%`)}
    </div>
    <div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  // 현장적용계수
  const fa1=g('fa1'),fa2=g('fa2'),fs1=g('fs1'),fs2=g('fs2');
  let fieldPass = null;
  const fieldBlock = document.getElementById('pv-res-field-block');
  if (fa1||fa2||fs1||fs2) {
    const fRes = fieldApplication(itemCode,[fa1,fa2],[fs1,fs2],{discharge:g('fdis')});
    document.getElementById('pv-res-field').innerHTML =
      `<div class="pv-lines">
        ${row('수분석 평균', fmt(fRes.labMean,3))}
        ${row('현장 평균', fmt(fRes.siteMean,3))}
        ${fRes.limit!=null ? row('허용오차',`±${fmt(fRes.limit,3)}`) : ''}
      </div>
      <div class="pv-badges">${badge(`${itemCode} 현장적용계수`,fRes.pass)}</div>`;
    fieldPass = fRes.pass;
    fieldBlock.hidden = false;
  } else {
    fieldBlock.hidden = true;
  }

  // 최종 판정
  const passes = [
    rep.zero.pass, rep.span.pass,
    dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift,
    dr.spanDrift<=PRECISION_CRITERIA.spanDrift,
    lin.pass,
  ];
  if (fieldPass !== null) passes.push(fieldPass);
  const allPass = passes.every(p => p===true);

  document.getElementById('pv-final').innerHTML =
    `<div class="pv-final-banner pv-final-banner--${allPass?'ok':'bad'}">
      ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
    </div>`;

  document.getElementById('pv-results').hidden = false;

  // 탭 뱃지 업데이트
  const tabBtn = document.querySelector(`.pv-item-tab[data-code="${itemCode}"]`);
  if (tabBtn) {
    tabBtn.dataset.pass = allPass ? 'ok' : 'bad';
  }
}

function buildForm() {
  return `
<div class="card pv-form-card">
  <!-- 측정범위 -->
  <div class="pv-section">
    <h3 class="pv-section__title">측정범위</h3>
    <div class="pv-row1">
      <label class="field"><span class="field__label">측정범위</span>
        <input id="pv_range" class="field__control" type="number" step="any" inputmode="decimal" placeholder="예: 100" /></label>
    </div>
  </div>

  <!-- Z/S 측정값 -->
  <div class="pv-section">
    <h3 class="pv-section__title">Z / S 측정값
      <span class="pv-hint">Z1·S1 = 기준, Z2~Z3·S2~S3 = 드리프트 초기(=반복성), Z4~Z5·S4~S5 = 드리프트 최종</span>
    </h3>
    <div class="pv-zs-table">
      <div class="pv-zs-header"><span></span><span>Z (제로)</span><span>S (스팬)</span></div>
      <div class="pv-zs-row">
        <span class="pv-zs-label">초기 기준</span>
        ${zsInput('z1','Z1')} ${zsInput('s1','S1')}
      </div>
      <div class="pv-zs-row">
        <span class="pv-zs-label">드리프트<br><small>초기구간</small></span>
        ${zsInput('z2','Z2')} ${zsInput('s2','S2')}
      </div>
      <div class="pv-zs-row">
        <span class="pv-zs-label"></span>
        ${zsInput('z3','Z3')} ${zsInput('s3','S3')}
      </div>
      <div class="pv-zs-row pv-zs-row--sep">
        <span class="pv-zs-label">드리프트<br><small>최종구간</small></span>
        ${zsInput('z4','Z4')} ${zsInput('s4','S4')}
      </div>
      <div class="pv-zs-row">
        <span class="pv-zs-label"></span>
        ${zsInput('z5','Z5')} ${zsInput('s5','S5')}
      </div>
    </div>
  </div>

  <!-- 직선성 -->
  <div class="pv-section">
    <h3 class="pv-section__title">직선성
      <span class="pv-hint">기준값 = 0.9 × 측정범위 ÷ 2, 오차 ≤ ${PRECISION_CRITERIA.linearity}%</span>
    </h3>
    <div class="pv-grid3">
      ${numField('m1','M1')} ${numField('m2','M2')} ${numField('m3','M3')}
    </div>
  </div>

  <!-- 현장적용계수 -->
  <div class="pv-section">
    <h3 class="pv-section__title">현장적용계수 <span class="pv-hint">(선택)</span></h3>
    <div class="pv-grid2">
      ${numField('fa1','수분석 1회')} ${numField('fa2','수분석 2회')}
      ${numField('fs1','현장측정 1회')} ${numField('fs2','현장측정 2회')}
      ${numField('fdis','TOC 배출허용기준 (TOC만, 없으면 0)')}
    </div>
  </div>
</div>

<!-- 결과 -->
<div id="pv-results" class="card pv-results-card" hidden>
  <h3 class="pv-section__title" style="margin-bottom:16px">검사 결과</h3>
  <div class="pv-res-grid">
    <div class="pv-res-block">
      <h4 class="pv-res-block__title">반복성 (RSD)</h4>
      <div id="pv-res-rep"></div>
    </div>
    <div class="pv-res-block">
      <h4 class="pv-res-block__title">드리프트</h4>
      <div id="pv-res-drift"></div>
    </div>
    <div class="pv-res-block">
      <h4 class="pv-res-block__title">직선성</h4>
      <div id="pv-res-lin"></div>
    </div>
    <div class="pv-res-block" id="pv-res-field-block" hidden>
      <h4 class="pv-res-block__title">현장적용계수</h4>
      <div id="pv-res-field"></div>
    </div>
  </div>
  <div id="pv-final"></div>
</div>`;
}

function zsInput(id, label) {
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="pv_${id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="0" /></label>`;
}
function numField(id, label) {
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="pv_${id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="0" /></label>`;
}

let currentCode = ITEMS[0].code;
let calcTimer = null;

function switchTab(code, formEl) {
  // 현재 탭 저장
  saveState(currentCode);
  currentCode = code;

  // 탭 UI 업데이트
  document.querySelectorAll('.pv-item-tab').forEach(b => b.classList.toggle('is-active', b.dataset.code === code));

  // 폼 + 결과 HTML 다시 그리기
  formEl.innerHTML = buildForm();

  // 저장된 값 복원
  const saved = loadState(code);
  FIELDS.forEach(id => {
    const el = document.getElementById(`pv_${id}`);
    if (el && saved[id] !== undefined) el.value = saved[id];
  });

  // 실시간 자동 계산 연결
  FIELDS.forEach(id => {
    document.getElementById(`pv_${id}`)?.addEventListener('input', () => {
      saveState(code);
      clearTimeout(calcTimer);
      calcTimer = setTimeout(() => calculate(code), 300);
    });
  });

  // 저장된 값 있으면 즉시 계산
  if (g('range')) calculate(code);
}

function init() {
  const panel = document.getElementById('panel-precision');
  if (!panel) return;

  panel.innerHTML = `
<div class="pv-page">
  <!-- 항목 탭 + 성적서 -->
  <div class="card pv-tab-card">
    <div class="pv-tab-bar">
      <div class="pv-item-tabs" role="tablist">
        ${ITEMS.map(it => `<button class="pv-item-tab${it.code===ITEMS[0].code?' is-active':''}" type="button" data-code="${it.code}" role="tab">${it.label}</button>`).join('')}
      </div>
      <button class="btn btn--ghost btn--mini" id="pv-cert-btn" type="button">성적서 출력</button>
    </div>
  </div>
  <div id="pv-form-area"></div>
</div>`;

  const formArea = document.getElementById('pv-form-area');

  // 탭 클릭
  document.querySelectorAll('.pv-item-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.code, formArea));
  });

  // 성적서
  document.getElementById('pv-cert-btn')?.addEventListener('click', () => {
    const finalEl = document.getElementById('pv-final');
    if (!finalEl || finalEl.innerHTML === '') { alert('먼저 측정범위를 입력해 계산하세요.'); return; }
    showCert(currentCode);
  });

  // 첫 탭 초기화
  switchTab(ITEMS[0].code, formArea);
}

function showCert(itemCode) {
  const item = ITEMS.find(i => i.code === itemCode);
  const date = new Date().toLocaleDateString('ko-KR');
  const range = g('range');

  const rep = repeatability([g('z1'),g('z2'),g('z3')],[g('s1'),g('s2'),g('s3')]);
  const dr  = drift(range,[g('z2'),g('z3')],[g('z4'),g('z5')],[g('s2'),g('s3')],[g('s4'),g('s5')]);
  const lin = linearity(range,[g('m1'),g('m2'),g('m3')]);

  const passes = [rep.zero.pass, rep.span.pass,
    dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift, dr.spanDrift<=PRECISION_CRITERIA.spanDrift, lin.pass];
  const allPass = passes.every(p=>p===true);

  const tr = (label, value, pass) =>
    `<tr><td style="padding:7px 10px;border:1px solid #ccc">${label}</td>
      <td style="padding:7px 10px;border:1px solid #ccc">${value}</td>
      <td style="padding:7px 10px;border:1px solid #ccc;font-weight:600;color:${pass?'#1a7f37':'#cf222e'}">${pass?'적합':'부적합'}</td></tr>`;

  const rows = [
    tr(`저농도 반복성 (RSD ≤ ${rep.limit}%)`, `${fmt(rep.zero.rsd)}%`, rep.zero.pass),
    tr(`고농도 반복성 (RSD ≤ ${rep.limit}%)`, `${fmt(rep.span.rsd)}%`, rep.span.pass),
    tr(`제로드리프트 (≤ ${PRECISION_CRITERIA.zeroDrift}%)`, `${fmt(dr.zeroDrift)}%`, dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift),
    tr(`스팬드리프트 (≤ ${PRECISION_CRITERIA.spanDrift}%)`, `${fmt(dr.spanDrift)}%`, dr.spanDrift<=PRECISION_CRITERIA.spanDrift),
    tr(`직선성 (≤ ${PRECISION_CRITERIA.linearity}%)`, `${fmt(lin.error)}%`, lin.pass),
  ].join('');

  const overlay = document.createElement('div');
  overlay.id = 'cert-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;color:#000;max-width:660px;width:100%;border-radius:12px;overflow:auto;max-height:90vh;padding:36px;font-family:sans-serif">
      <div style="text-align:center;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #000">
        <h2 style="font-size:20px;font-weight:700;margin:0">수질TMS 정도검사 성적서</h2>
        <p style="margin:4px 0 0;font-size:12px;color:#666">KTL 전문 계측 서비스</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px">
        <tr><td style="padding:4px 0;width:90px;color:#666">검사 항목</td><td style="font-weight:600">${itemCode} (${item?.label||''})</td></tr>
        <tr><td style="padding:4px 0;color:#666">측정범위</td><td>${range}</td></tr>
        <tr><td style="padding:4px 0;color:#666">검사일</td><td>${date}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
        <thead><tr style="background:#f0f0f0">
          <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">항목</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">수치</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #ccc;width:70px">판정</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="border:2px solid ${allPass?'#1a7f37':'#cf222e'};border-radius:8px;padding:12px;text-align:center;font-size:17px;font-weight:700;color:${allPass?'#1a7f37':'#cf222e'}">
        최종 판정: ${allPass?'✅ 전 항목 적합':'❌ 부적합 항목 있음'}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button onclick="window.print()" style="padding:8px 18px;background:#0969da;color:#fff;border:0;border-radius:6px;cursor:pointer">인쇄 / PDF</button>
        <button onclick="document.getElementById('cert-overlay').remove()" style="padding:8px 18px;background:#f0f0f0;border:0;border-radius:6px;cursor:pointer">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
