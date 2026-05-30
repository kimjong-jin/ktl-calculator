/**
 * 수질TMS 정도검사 UI — 한 페이지 통합 입력/계산.
 * 탭 없이 측정범위+Z/S 5회+직선성M3+현장적용을 한 화면에서 입력,
 * "전체 계산" 한 번으로 반복성·드리프트·직선성·현장적용·통합 판정 모두 출력.
 */
import {
  PRECISION_CRITERIA,
  repeatability, drift, linearity, fieldApplication, total,
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

/** 숫자 입력 필드 HTML */
function numField(id, label, placeholder = '0') {
  return `<label class="field pv-field">
    <span class="field__label pv-field__label">${label}</span>
    <input id="pv_${id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="${placeholder}" />
  </label>`;
}

/** 판정 배지 HTML */
function badge(label, pass) {
  if (pass === null) return `<div class="pv-badge pv-badge--na">⚪ ${label}</div>`;
  return pass
    ? `<div class="pv-badge pv-badge--ok">✅ ${label} — 적합</div>`
    : `<div class="pv-badge pv-badge--bad">❌ ${label} — 부적합</div>`;
}

/** 결과 행 HTML */
function resultRow(label, value) {
  return `<div class="pv-line"><span>${label}</span><b>${value}</b></div>`;
}

function init() {
  const panel = document.getElementById('panel-precision');
  if (!panel) return;

  panel.innerHTML = `
<div class="pv-page">
  <!-- 항목 선택 + 성적서 -->
  <div class="card pv-header-card">
    <div class="pv-top-bar">
      <div class="pv-item-bar">
        <span class="pv-item-label">검사 항목</span>
        <select id="pv-item" class="field__control pv-item-select">
          ${ITEMS.map(it => `<option value="${it.code}">${it.label}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn--ghost" id="pv-cert-btn" type="button">성적서 출력</button>
    </div>
  </div>

  <!-- 입력 폼 -->
  <div class="card pv-form-card">
    <!-- 측정범위 -->
    <div class="pv-section">
      <h3 class="pv-section__title">측정범위</h3>
      <div class="pv-row1">
        ${numField('range', '측정범위', '예: 100')}
      </div>
    </div>

    <!-- Z/S 측정값 -->
    <div class="pv-section">
      <h3 class="pv-section__title">
        Z/S 측정값 입력
        <span class="pv-hint">Z1·S1 = 기준값, Z2~Z5·S2~S5 = 드리프트/반복성 측정</span>
      </h3>
      <div class="pv-zs-table">
        <div class="pv-zs-header">
          <span></span><span>Z (제로)</span><span>S (스팬)</span>
        </div>
        <div class="pv-zs-row">
          <span class="pv-zs-label">초기 (기준)</span>
          ${numField('z1', 'Z1')}${numField('s1', 'S1')}
        </div>
        <div class="pv-zs-row pv-zs-row--group">
          <span class="pv-zs-label">드리프트<br><small>초기구간</small></span>
          ${numField('z2', 'Z2')}${numField('s2', 'S2')}
        </div>
        <div class="pv-zs-row pv-zs-row--group">
          <span class="pv-zs-label"></span>
          ${numField('z3', 'Z3')}${numField('s3', 'S3')}
        </div>
        <div class="pv-zs-row pv-zs-row--sep">
          <span class="pv-zs-label">드리프트<br><small>최종구간</small></span>
          ${numField('z4', 'Z4')}${numField('s4', 'S4')}
        </div>
        <div class="pv-zs-row pv-zs-row--group">
          <span class="pv-zs-label"></span>
          ${numField('z5', 'Z5')}${numField('s5', 'S5')}
        </div>
      </div>
      <p class="micro" style="margin-top:8px">반복성(RSD): Z1·Z2·Z3 / S1·S2·S3 &nbsp;|&nbsp; 최종반복성: Z1 기준 최대편차</p>
    </div>

    <!-- 직선성 -->
    <div class="pv-section">
      <h3 class="pv-section__title">직선성 측정 <span class="pv-hint">기준값 = 0.9 × 측정범위 ÷ 2, 오차 ≤ ${PRECISION_CRITERIA.linearity}%</span></h3>
      <div class="pv-grid3">
        ${numField('m1', 'M1')}${numField('m2', 'M2')}${numField('m3', 'M3')}
      </div>
    </div>

    <!-- 현장적용계수 (선택) -->
    <div class="pv-section">
      <h3 class="pv-section__title">현장적용계수 <span class="pv-hint">(선택) 미입력 시 생략</span></h3>
      <div class="pv-grid2">
        ${numField('fa1', '수분석 1회')}${numField('fa2', '수분석 2회')}
        ${numField('fs1', '현장측정 1회')}${numField('fs2', '현장측정 2회')}
        ${numField('fdis', 'TOC 배출허용기준 (TOC만, 없으면 0)')}
      </div>
    </div>

    <!-- 계산 버튼 -->
    <div style="text-align:center;margin:20px 0 4px">
      <button class="btn btn--primary pv-calc-btn" id="pv-calc" type="button">전체 계산</button>
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
      <div class="pv-res-block" id="pv-res-field-block">
        <h4 class="pv-res-block__title">현장적용계수</h4>
        <div id="pv-res-field"></div>
      </div>
    </div>

    <div id="pv-final" class="pv-final-verdict"></div>
  </div>
</div>`;

  const g = id => parseFloat(document.getElementById(`pv_${id}`)?.value) || 0;
  const gs = id => document.getElementById(`pv_${id}`)?.value || '';

  // 마지막 계산 결과 저장 (성적서용)
  let lastResults = null;

  document.getElementById('pv-calc')?.addEventListener('click', () => {
    const item = document.getElementById('pv-item')?.value || 'TOC';
    const range = g('range');
    const z1 = g('z1'), s1 = g('s1');
    const z2=g('z2'),z3=g('z3'),z4=g('z4'),z5=g('z5');
    const s2=g('s2'),s3=g('s3'),s4=g('s4'),s5=g('s5');
    const m1=g('m1'), m2=g('m2'), m3=g('m3');

    // 반복성 (RSD)
    const rep = repeatability([z1,z2,z3], [s1,s2,s3]);
    document.getElementById('pv-res-rep').innerHTML =
      `<div class="pv-lines">
        ${resultRow('저농도 평균', fmt(rep.zero.mean,4))}
        ${resultRow('저농도 RSD', `${fmt(rep.zero.rsd)}%`)}
        ${resultRow('고농도 평균', fmt(rep.span.mean,4))}
        ${resultRow('고농도 RSD', `${fmt(rep.span.rsd)}%`)}
      </div>
      <div class="pv-badges">
        ${badge(`저농도 반복성 (RSD ≤ ${rep.limit}%)`, rep.zero.pass)}
        ${badge(`고농도 반복성 (RSD ≤ ${rep.limit}%)`, rep.span.pass)}
      </div>`;

    // 드리프트
    const dr = drift(range, [z2,z3], [z4,z5], [s2,s3], [s4,s5]);
    document.getElementById('pv-res-drift').innerHTML =
      `<div class="pv-lines">
        ${resultRow('제로 드리프트', `${fmt(dr.zeroDrift)}%`)}
        ${resultRow('스팬 드리프트', `${fmt(dr.spanDrift)}%`)}
      </div>
      <div class="pv-badges">
        ${badge(`제로드리프트 (≤ ${PRECISION_CRITERIA.zeroDrift}%)`, dr.zeroDrift <= PRECISION_CRITERIA.zeroDrift)}
        ${badge(`스팬드리프트 (≤ ${PRECISION_CRITERIA.spanDrift}%)`, dr.spanDrift <= PRECISION_CRITERIA.spanDrift)}
      </div>`;

    // 직선성
    const lin = linearity(range, [m1,m2,m3]);
    document.getElementById('pv-res-lin').innerHTML =
      `<div class="pv-lines">
        ${resultRow('기준값', fmt(lin.ref,4))}
        ${resultRow('측정 평균', fmt(lin.avg,4))}
        ${resultRow('직선성 오차', `${fmt(lin.error)}%`)}
      </div>
      <div class="pv-badges">
        ${badge(`직선성 (≤ ${PRECISION_CRITERIA.linearity}%)`, lin.pass)}
      </div>`;

    // 현장적용계수 (입력 있을 때만)
    const fa1=g('fa1'), fa2=g('fa2'), fs1=g('fs1'), fs2=g('fs2');
    let fieldPass = null;
    if (fa1 || fa2 || fs1 || fs2) {
      const fdis = g('fdis');
      const fRes = fieldApplication(item, [fa1,fa2], [fs1,fs2], { discharge: fdis });
      document.getElementById('pv-res-field').innerHTML =
        `<div class="pv-lines">
          ${resultRow('수분석 평균', fmt(fRes.labMean,3))}
          ${resultRow('현장 평균', fmt(fRes.siteMean,3))}
          ${fRes.limit != null ? resultRow('허용오차', `±${fmt(fRes.limit,3)}`) : ''}
        </div>
        <div class="pv-badges">
          ${badge(`${item} 현장적용계수`, fRes.pass)}
        </div>`;
      fieldPass = fRes.pass;
      document.getElementById('pv-res-field-block').hidden = false;
    } else {
      document.getElementById('pv-res-field-block').hidden = true;
    }

    // 통합 판정
    const passes = [
      rep.zero.pass, rep.span.pass,
      dr.zeroDrift <= PRECISION_CRITERIA.zeroDrift,
      dr.spanDrift <= PRECISION_CRITERIA.spanDrift,
      lin.pass,
    ];
    if (fieldPass !== null) passes.push(fieldPass);
    const allPass = passes.every(p => p === true);

    document.getElementById('pv-final').innerHTML =
      `<div class="pv-final-banner pv-final-banner--${allPass ? 'ok' : 'bad'}">
        ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
      </div>`;

    lastResults = { rep, dr, lin, fieldPass, item, range, allPass };
    document.getElementById('pv-results').hidden = false;
    document.getElementById('pv-results').scrollIntoView({ behavior: 'smooth' });
  });

  // 성적서 출력
  document.getElementById('pv-cert-btn')?.addEventListener('click', () => {
    if (!lastResults) { alert('먼저 전체 계산을 실행하세요.'); return; }
    showCert(lastResults);
  });
}

function showCert({ rep, dr, lin, fieldPass, item, allPass }) {
  const date = new Date().toLocaleDateString('ko-KR');
  const itemLabel = ITEMS.find(i => i.code === item)?.label || item;
  const tr = (label, value, pass) =>
    `<tr>
      <td style="padding:7px 10px;border:1px solid #ccc">${label}</td>
      <td style="padding:7px 10px;border:1px solid #ccc">${value}</td>
      <td style="padding:7px 10px;border:1px solid #ccc;color:${pass===null?'#666':pass?'#1a7f37':'#cf222e'};font-weight:600">
        ${pass===null?'—':pass?'적합':'부적합'}
      </td>
    </tr>`;

  const rows = [
    tr(`저농도 반복성 (RSD ≤ ${rep.limit}%)`, `${fmt(rep.zero.rsd)}%`, rep.zero.pass),
    tr(`고농도 반복성 (RSD ≤ ${rep.limit}%)`, `${fmt(rep.span.rsd)}%`, rep.span.pass),
    tr(`제로드리프트 (≤ ${PRECISION_CRITERIA.zeroDrift}%)`, `${fmt(dr.zeroDrift)}%`, dr.zeroDrift <= PRECISION_CRITERIA.zeroDrift),
    tr(`스팬드리프트 (≤ ${PRECISION_CRITERIA.spanDrift}%)`, `${fmt(dr.spanDrift)}%`, dr.spanDrift <= PRECISION_CRITERIA.spanDrift),
    tr(`직선성 (≤ ${PRECISION_CRITERIA.linearity}%)`, `${fmt(lin.error)}%`, lin.pass),
    ...(fieldPass !== null ? [tr('현장적용계수', '', fieldPass)] : []),
  ].join('');

  const overlay = document.createElement('div');
  overlay.id = 'cert-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;color:#000;max-width:680px;width:100%;border-radius:12px;overflow:auto;max-height:90vh;padding:40px;font-family:'Pretendard','Apple SD Gothic Neo',sans-serif">
      <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #000">
        <h2 style="font-size:20px;font-weight:700;margin:0">수질TMS 정도검사 성적서</h2>
        <p style="margin:4px 0 0;font-size:12px;color:#666">Korea Testing Laboratory · KTL 전문 계측 서비스</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px">
        <tr><td style="padding:5px 0;width:100px;color:#666">검사 항목</td><td style="font-weight:600">${itemLabel}</td></tr>
        <tr><td style="padding:5px 0;color:#666">검사일</td><td>${date}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead>
          <tr style="background:#f0f0f0">
            <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">검사 항목</th>
            <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">수치</th>
            <th style="padding:8px 10px;text-align:left;border:1px solid #ccc;width:80px">판정</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="border:2px solid ${allPass?'#1a7f37':'#cf222e'};border-radius:8px;padding:12px 16px;text-align:center;font-size:17px;font-weight:700;color:${allPass?'#1a7f37':'#cf222e'}">
        최종 판정: ${allPass ? '✅ 전 항목 적합' : '❌ 부적합 항목 있음'}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
        <button onclick="window.print()" style="padding:8px 18px;background:#0969da;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:14px">인쇄 / PDF 저장</button>
        <button onclick="document.getElementById('cert-overlay').remove()" style="padding:8px 18px;background:#f0f0f0;color:#000;border:0;border-radius:6px;cursor:pointer;font-size:14px">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
