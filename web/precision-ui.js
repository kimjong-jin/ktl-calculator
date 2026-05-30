/**
 * 수질TMS 정도검사 UI
 * - 빈 시작 상태, + 추가로 항목 탭 생성
 * - 탭마다 독립 저장/실시간계산
 * - 현장적용: Ci1(수분석Ai1·Ai2) + Ci2(수분석Ai3·Ai4)
 * - 응답시간(T90) 포함
 */
import {
  PRECISION_CRITERIA,
  repeatability, drift, linearity, fieldApplication,
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

const FIELDS = [
  'range',
  'z1','z2','z3','z4','z5',
  's1','s2','s3','s4','s5',
  'm1','m2','m3',
  'ci1','ai1','ai2',
  'ci2','ai3','ai4',
  'fdis',
  'resp','resp_limit',
];

// ── 탭 상태 ───────────────────────────────────────────────────────
let tabs = [];
let activeId = null;
let calcTimer = null;

function saveMeta() {
  try { localStorage.setItem('ktl-tabs', JSON.stringify(tabs.map(({id,code,label,pass})=>({id,code,label,pass})))); } catch {}
  try { localStorage.setItem('ktl-tab-active', activeId||''); } catch {}
}
function loadMeta() {
  try { const r = localStorage.getItem('ktl-tabs'); if (r) tabs = JSON.parse(r); } catch {}
  try { activeId = localStorage.getItem('ktl-tab-active') || null; } catch {}
}
function saveData(id) {
  const s = {};
  FIELDS.forEach(f => { const el = document.getElementById(`pv_${f}`); if (el) s[f] = el.value; });
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

// ── 계산 ──────────────────────────────────────────────────────────
function g(id) { return parseFloat(document.getElementById(`pv_${id}`)?.value) || 0; }

function badge(label, pass) {
  if (pass === null) return `<div class="pv-badge pv-badge--na">— ${label}</div>`;
  return pass
    ? `<div class="pv-badge pv-badge--ok">✅ ${label} 적합</div>`
    : `<div class="pv-badge pv-badge--bad">❌ ${label} 부적합</div>`;
}
function row(k, v) { return `<div class="pv-line"><span>${k}</span><b>${v}</b></div>`; }

function calculate(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const range = g('range');
  if (!range) return;

  const z = [1,2,3,4,5].map(i => g(`z${i}`));
  const s = [1,2,3,4,5].map(i => g(`s${i}`));
  const m = [1,2,3].map(i => g(`m${i}`));

  // 반복성
  const rep = repeatability([z[0],z[1],z[2]], [s[0],s[1],s[2]]);
  document.getElementById('pv-res-rep').innerHTML =
    `<div class="pv-lines">
      ${row('저농도 평균', fmt(rep.zero.mean,4))} ${row('저농도 RSD', `${fmt(rep.zero.rsd)}%`)}
      ${row('고농도 평균', fmt(rep.span.mean,4))} ${row('고농도 RSD', `${fmt(rep.span.rsd)}%`)}
    </div><div class="pv-badges">
      ${badge(`저농도 RSD ≤ ${rep.limit}%`, rep.zero.pass)}
      ${badge(`고농도 RSD ≤ ${rep.limit}%`, rep.span.pass)}
    </div>`;

  // 드리프트
  const dr = drift(range, [z[1],z[2]], [z[3],z[4]], [s[1],s[2]], [s[3],s[4]]);
  document.getElementById('pv-res-drift').innerHTML =
    `<div class="pv-lines">
      ${row('제로 드리프트', `${fmt(dr.zeroDrift)}%`)}
      ${row('스팬 드리프트', `${fmt(dr.spanDrift)}%`)}
    </div><div class="pv-badges">
      ${badge(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`, dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift)}
      ${badge(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`, dr.spanDrift<=PRECISION_CRITERIA.spanDrift)}
    </div>`;

  // 직선성
  const lin = linearity(range, m);
  document.getElementById('pv-res-lin').innerHTML =
    `<div class="pv-lines">
      ${row('기준값', fmt(lin.ref,4))} ${row('평균', fmt(lin.avg,4))} ${row('오차', `${fmt(lin.error)}%`)}
    </div><div class="pv-badges">
      ${badge(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`, lin.pass)}
    </div>`;

  // 현장적용계수
  const ci1=g('ci1'), ci2=g('ci2');
  const ai1=g('ai1'), ai2=g('ai2'), ai3=g('ai3'), ai4=g('ai4');
  let fieldPass = null;
  const fieldBlock = document.getElementById('pv-res-field-block');
  if (ci1||ci2||ai1||ai2||ai3||ai4) {
    const fRes = fieldApplication(tab.code, [ai1,ai2,ai3,ai4], [ci1,ci2], {discharge:g('fdis')});
    document.getElementById('pv-res-field').innerHTML =
      `<div class="pv-lines">
        ${row('수분석 평균 (Ai)', fmt(fRes.labMean,3))}
        ${row('현장측정 평균 (Ci)', fmt(fRes.siteMean,3))}
        ${fRes.limit!=null ? row('허용오차', `±${fmt(fRes.limit,3)}`) : ''}
      </div><div class="pv-badges">${badge(`${tab.code} 현장적용계수`, fRes.pass)}</div>`;
    fieldPass = fRes.pass;
    if (fieldBlock) fieldBlock.hidden = false;
  } else {
    if (fieldBlock) fieldBlock.hidden = true;
  }

  // 응답시간
  const resp = g('resp'), respLimit = g('resp_limit');
  let respPass = null;
  const respBlock = document.getElementById('pv-res-resp-block');
  if (resp && respLimit) {
    respPass = resp <= respLimit;
    document.getElementById('pv-res-resp').innerHTML =
      `<div class="pv-lines">
        ${row('측정값 (T90)', `${fmt(resp,0)}초`)}
        ${row('기준 (≤)', `${fmt(respLimit,0)}초`)}
      </div><div class="pv-badges">
        ${badge(`응답시간 ≤ ${fmt(respLimit,0)}초`, respPass)}
      </div>`;
    if (respBlock) respBlock.hidden = false;
  } else {
    if (respBlock) respBlock.hidden = true;
  }

  // 통합 판정
  const passes = [
    rep.zero.pass, rep.span.pass,
    dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift,
    dr.spanDrift<=PRECISION_CRITERIA.spanDrift,
    lin.pass,
  ];
  if (fieldPass !== null) passes.push(fieldPass);
  if (respPass !== null) passes.push(respPass);
  const allPass = passes.every(p=>p===true);

  document.getElementById('pv-final').innerHTML =
    `<div class="pv-final-banner pv-final-banner--${allPass?'ok':'bad'}">
      ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
    </div>`;

  document.getElementById('pv-results').hidden = false;

  tab.pass = allPass ? 'ok' : 'bad';
  saveMeta();
  const btn = document.querySelector(`.pv-item-tab[data-id="${tabId}"]`);
  if (btn) btn.dataset.pass = tab.pass;
}

// ── 탭 전환 ──────────────────────────────────────────────────────
function switchTab(id) {
  if (activeId && activeId !== id) saveData(activeId);
  activeId = id;
  saveMeta();

  document.querySelectorAll('.pv-item-tab').forEach(b =>
    b.classList.toggle('is-active', b.dataset.id === id));

  const formArea = document.getElementById('pv-form-area');
  if (!formArea) return;
  formArea.innerHTML = buildForm();

  const saved = loadData(id);
  FIELDS.forEach(f => {
    const el = document.getElementById(`pv_${f}`);
    if (el && saved[f] !== undefined) el.value = saved[f];
  });

  FIELDS.forEach(f => {
    document.getElementById(`pv_${f}`)?.addEventListener('input', () => {
      saveData(id);
      clearTimeout(calcTimer);
      calcTimer = setTimeout(() => calculate(id), 300);
    });
  });

  if (g('range')) calculate(id);
}

// ── 탭 바 렌더 ────────────────────────────────────────────────────
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

// ── 폼 HTML ───────────────────────────────────────────────────────
function ni(id, label) {
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="pv_${id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="0"/></label>`;
}
function zsInput(id, label) { return ni(id, label); }

function buildForm() {
  return `
<div class="card pv-form-card">
  <div class="pv-section">
    <h3 class="pv-section__title">측정범위</h3>
    <div class="pv-row1">${ni('range','측정범위')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">Z / S 측정값
      <span class="pv-hint">Z1·S1=기준 / Z2~Z3·S2~S3=드리프트초기(반복성) / Z4~Z5·S4~S5=드리프트최종</span>
    </h3>
    <div class="pv-zs-table">
      <div class="pv-zs-header"><span></span><span>Z (제로)</span><span>S (스팬)</span></div>
      <div class="pv-zs-row"><span class="pv-zs-label">초기 기준</span>${zsInput('z1','Z1')}${zsInput('s1','S1')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label">드리프트<br><small>초기구간</small></span>${zsInput('z2','Z2')}${zsInput('s2','S2')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label"></span>${zsInput('z3','Z3')}${zsInput('s3','S3')}</div>
      <div class="pv-zs-row pv-zs-row--sep"><span class="pv-zs-label">드리프트<br><small>최종구간</small></span>${zsInput('z4','Z4')}${zsInput('s4','S4')}</div>
      <div class="pv-zs-row"><span class="pv-zs-label"></span>${zsInput('z5','Z5')}${zsInput('s5','S5')}</div>
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">직선성 <span class="pv-hint">오차 ≤ ${PRECISION_CRITERIA.linearity}%</span></h3>
    <div class="pv-grid3">${ni('m1','M1')}${ni('m2','M2')}${ni('m3','M3')}</div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">현장적용계수 <span class="pv-hint">(선택)</span></h3>
    <div class="pv-field-rounds">
      <div class="pv-field-round">
        <div class="pv-field-round__label">측정 1회차</div>
        <div class="pv-field-round__inputs">
          ${ni('ci1','현장측정값 Ci₁')}
          ${ni('ai1','수분석 Ai₁')}
          ${ni('ai2','수분석 Ai₂')}
        </div>
      </div>
      <div class="pv-field-round">
        <div class="pv-field-round__label">측정 2회차</div>
        <div class="pv-field-round__inputs">
          ${ni('ci2','현장측정값 Ci₂')}
          ${ni('ai3','수분석 Ai₃')}
          ${ni('ai4','수분석 Ai₄')}
        </div>
      </div>
      ${ni('fdis','TOC 배출허용기준 mg/L (TOC만, 없으면 0)')}
    </div>
  </div>

  <div class="pv-section">
    <h3 class="pv-section__title">응답시간 (T90) <span class="pv-hint">(선택)</span></h3>
    <div class="pv-grid2">
      ${ni('resp','측정값 (초)')}
      ${ni('resp_limit','기준값 (초, 예: DO=120, pH=30)')}
    </div>
  </div>
</div>

<div id="pv-results" class="card pv-results-card" hidden>
  <h3 class="pv-section__title" style="margin-bottom:16px">검사 결과</h3>
  <div class="pv-res-grid">
    <div class="pv-res-block"><h4 class="pv-res-block__title">반복성 (RSD)</h4><div id="pv-res-rep"></div></div>
    <div class="pv-res-block"><h4 class="pv-res-block__title">드리프트</h4><div id="pv-res-drift"></div></div>
    <div class="pv-res-block"><h4 class="pv-res-block__title">직선성</h4><div id="pv-res-lin"></div></div>
    <div class="pv-res-block" id="pv-res-field-block" hidden><h4 class="pv-res-block__title">현장적용계수</h4><div id="pv-res-field"></div></div>
    <div class="pv-res-block" id="pv-res-resp-block" hidden><h4 class="pv-res-block__title">응답시간 (T90)</h4><div id="pv-res-resp"></div></div>
  </div>
  <div id="pv-final"></div>
  <div style="text-align:right;margin-top:12px">
    <button class="btn btn--ghost btn--mini" id="pv-cert-btn-result" type="button">성적서 출력</button>
  </div>
</div>`;
}

// ── 성적서 ────────────────────────────────────────────────────────
function showCert(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || !g('range')) { alert('먼저 측정범위를 입력해 계산하세요.'); return; }
  const date = new Date().toLocaleDateString('ko-KR');
  const range = g('range');
  const z = [1,2,3,4,5].map(i=>g(`z${i}`));
  const s = [1,2,3,4,5].map(i=>g(`s${i}`));
  const rep = repeatability([z[0],z[1],z[2]],[s[0],s[1],s[2]]);
  const dr  = drift(range,[z[1],z[2]],[z[3],z[4]],[s[1],s[2]],[s[3],s[4]]);
  const lin = linearity(range,[g('m1'),g('m2'),g('m3')]);
  const passes = [rep.zero.pass,rep.span.pass,
    dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift,dr.spanDrift<=PRECISION_CRITERIA.spanDrift,lin.pass];

  // 현장적용
  let fieldRow = '';
  const ci1=g('ci1'),ci2=g('ci2'),ai1=g('ai1'),ai2=g('ai2'),ai3=g('ai3'),ai4=g('ai4');
  if(ci1||ci2||ai1||ai2||ai3||ai4){
    const fRes = fieldApplication(tab.code,[ai1,ai2,ai3,ai4],[ci1,ci2],{discharge:g('fdis')});
    fieldRow = tr(`${tab.code} 현장적용계수`, `|Ai평균-Ci평균|=${fmt(Math.abs(fRes.labMean-fRes.siteMean),3)}`, fRes.pass);
    passes.push(fRes.pass);
  }

  // 응답시간
  let respRow = '';
  const resp=g('resp'),respLimit=g('resp_limit');
  if(resp&&respLimit){
    const respPass = resp<=respLimit;
    respRow = tr(`응답시간(T90) ≤ ${fmt(respLimit,0)}초`, `${fmt(resp,0)}초`, respPass);
    passes.push(respPass);
  }

  const allPass = passes.every(p=>p===true);

  const rows = [
    tr(`저농도 반복성(RSD ≤ ${rep.limit}%)`,`${fmt(rep.zero.rsd)}%`,rep.zero.pass),
    tr(`고농도 반복성(RSD ≤ ${rep.limit}%)`,`${fmt(rep.span.rsd)}%`,rep.span.pass),
    tr(`제로드리프트 ≤ ${PRECISION_CRITERIA.zeroDrift}%`,`${fmt(dr.zeroDrift)}%`,dr.zeroDrift<=PRECISION_CRITERIA.zeroDrift),
    tr(`스팬드리프트 ≤ ${PRECISION_CRITERIA.spanDrift}%`,`${fmt(dr.spanDrift)}%`,dr.spanDrift<=PRECISION_CRITERIA.spanDrift),
    tr(`직선성 ≤ ${PRECISION_CRITERIA.linearity}%`,`${fmt(lin.error)}%`,lin.pass),
    fieldRow, respRow,
  ].join('');

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
        <tr><td style="padding:4px 0;color:#666">측정범위</td><td>${range}</td></tr>
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

function tr(l,v,p) {
  return `<tr>
    <td style="padding:7px 10px;border:1px solid #ccc">${l}</td>
    <td style="padding:7px 10px;border:1px solid #ccc">${v}</td>
    <td style="padding:7px 10px;border:1px solid #ccc;font-weight:600;color:${p?'#1a7f37':'#cf222e'}">${p?'적합':'부적합'}</td></tr>`;
}

// ── 초기화 ────────────────────────────────────────────────────────
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
