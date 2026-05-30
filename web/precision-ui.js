/**
 * 정도검사 상세 계산 UI (반복성/드리프트/직선성/현장적용/통합).
 * 계산은 src/precision.js 순수 엔진(단위테스트 완료)을 그대로 재사용한다.
 * 이 파일은 폼 생성·입력 수집·결과 렌더·탭 전환만 담당한다.
 */
import {
  PRECISION_CRITERIA,
  repeatability, drift, linearity, fieldApplication, total,
} from '../src/precision.js';

const fmt = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : '–');

/* ── 계산기 정의 (spec) ──────────────────────────────────────────
 * groups: 입력 그룹. fields: {id,label,ph} 또는 select.
 * run(g): g(id)=숫자, gs(id)=문자열 → { lines:[{k,v}], verdicts:[{label,pass}] } */
const CALCS = [
  {
    key: 'repeatability', title: '반복성',
    desc: `RSD = 표본표준편차 ÷ 평균 × 100, 적합 ≤ ${PRECISION_CRITERIA.repeatabilityRsd}%`,
    groups: [
      { label: '저농도 (Z) 3회', fields: ['z1', 'z2', 'z3'].map((s) => ({ id: `rep_${s}` })) },
      { label: '고농도 (S) 3회', fields: ['s1', 's2', 's3'].map((s) => ({ id: `rep_${s}` })) },
    ],
    run(g) {
      const r = repeatability(
        [g('rep_z1'), g('rep_z2'), g('rep_z3')],
        [g('rep_s1'), g('rep_s2'), g('rep_s3')]);
      return {
        lines: [
          { k: '저농도 평균', v: fmt(r.zero.mean, 4) }, { k: '저농도 RSD', v: `${fmt(r.zero.rsd)}%` },
          { k: '고농도 평균', v: fmt(r.span.mean, 4) }, { k: '고농도 RSD', v: `${fmt(r.span.rsd)}%` },
        ],
        verdicts: [
          { label: `저농도 반복성 (RSD ≤ ${r.limit}%)`, pass: r.zero.pass },
          { label: `고농도 반복성 (RSD ≤ ${r.limit}%)`, pass: r.span.pass },
        ],
      };
    },
  },
  {
    key: 'drift', title: '제로/스팬 드리프트',
    desc: `드리프트 = |후평균 − 전평균| ÷ 측정범위 × 100, 적합 ≤ ${PRECISION_CRITERIA.zeroDrift}%`,
    groups: [
      { label: '측정범위', fields: [{ id: 'drift_range', label: '측정범위' }] },
      { label: '제로 — 전(2)/후(2)', fields: ['z1', 'z2', 'z3', 'z4'].map((s) => ({ id: `drift_${s}` })) },
      { label: '스팬 — 전(2)/후(2)', fields: ['s1', 's2', 's3', 's4'].map((s) => ({ id: `drift_${s}` })) },
    ],
    run(g) {
      const d = drift(g('drift_range'),
        [g('drift_z1'), g('drift_z2')], [g('drift_z3'), g('drift_z4')],
        [g('drift_s1'), g('drift_s2')], [g('drift_s3'), g('drift_s4')]);
      return {
        lines: [
          { k: '제로 드리프트', v: `${fmt(d.zeroDrift)}%` },
          { k: '스팬 드리프트', v: `${fmt(d.spanDrift)}%` },
        ],
        verdicts: [
          { label: '제로 드리프트', pass: d.zeroPass },
          { label: '스팬 드리프트', pass: d.spanPass },
        ],
      };
    },
  },
  {
    key: 'linearity', title: '직선성',
    desc: `기준값 = 0.9 × 측정범위 ÷ 2, 오차 = |평균−기준|÷기준×100, 적합 ≤ ${PRECISION_CRITERIA.linearity}%`,
    groups: [
      { label: '측정범위', fields: [{ id: 'lin_range', label: '측정범위' }] },
      { label: '측정 3회', fields: ['m1', 'm2', 'm3'].map((s) => ({ id: `lin_${s}` })) },
    ],
    run(g) {
      const l = linearity(g('lin_range'), [g('lin_m1'), g('lin_m2'), g('lin_m3')]);
      return {
        lines: [
          { k: '평균값', v: fmt(l.avg, 3) },
          { k: '기준값', v: fmt(l.ref, 3) },
          { k: '직선성 오차', v: `${fmt(l.error)}%` },
        ],
        verdicts: [{ label: `직선성 (오차 ≤ ${PRECISION_CRITERIA.linearity}%)`, pass: l.pass }],
      };
    },
  },
  {
    key: 'field', title: '현장적용계수',
    desc: '적합 = |수분석평균 − 현장측정평균| ≤ 허용오차 (일부 파라미터는 자동 적합)',
    groups: [
      { label: '파라미터', fields: [{ id: 'field_param', type: 'select',
        options: ['TOC', 'TN', 'TP', 'SS', 'COD'] }] },
      { label: '수분석 2회', fields: ['a1', 'a2'].map((s) => ({ id: `field_${s}` })) },
      { label: '현장측정 2회', fields: ['s1', 's2'].map((s) => ({ id: `field_${s}` })) },
      { label: 'TOC 배출허용기준 (TOC만, 없으면 0)', fields: [{ id: 'field_discharge' }] },
    ],
    run(g, gs) {
      const param = gs('field_param');
      const f = fieldApplication(param, [g('field_a1'), g('field_a2')],
        [g('field_s1'), g('field_s2')], { discharge: g('field_discharge') });
      const lines = [
        { k: `${param} 수분석 평균`, v: `${fmt(f.labMean, 3)} mg/L` },
        { k: `${param} 현장 평균`, v: `${fmt(f.siteMean, 3)} mg/L` },
      ];
      if (f.auto) lines.push({ k: '판정', v: '수분석 기준 이상 → 자동 적합' });
      else if (f.limit != null) lines.push({ k: '허용 오차', v: `±${fmt(f.limit, 3)} mg/L` });
      const verdicts = f.pass === null
        ? [{ label: `${param}: 기준 미정의`, pass: null }]
        : [{ label: `${param} 현장적용계수`, pass: f.pass }];
      return { lines, verdicts };
    },
  },
  {
    key: 'total', title: '통합',
    desc: '드리프트 + 최종 반복성(가장 먼 ZZ/SS vs Z1/S1) + 직선성',
    groups: [
      { label: '측정범위 / 기준값', fields: [
        { id: 'tot_range', label: '측정범위' }, { id: 'tot_z1', label: 'Z1(저농도)' }, { id: 'tot_s1', label: 'S1(고농도)' }] },
      { label: '제로 후속 Z2~Z5', fields: ['z2', 'z3', 'z4', 'z5'].map((s) => ({ id: `tot_${s}` })) },
      { label: '스팬 후속 S2~S5', fields: ['s2', 's3', 's4', 's5'].map((s) => ({ id: `tot_${s}` })) },
      { label: '직선성 측정 3회', fields: ['m1', 'm2', 'm3'].map((s) => ({ id: `tot_${s}` })) },
    ],
    run(g) {
      const t = total({
        range: g('tot_range'), z1: g('tot_z1'), s1: g('tot_s1'),
        zSeq: [g('tot_z2'), g('tot_z3'), g('tot_z4'), g('tot_z5')],
        sSeq: [g('tot_s2'), g('tot_s3'), g('tot_s4'), g('tot_s5')],
        mVals: [g('tot_m1'), g('tot_m2'), g('tot_m3')],
      });
      return {
        lines: [
          { k: '제로 드리프트', v: `${fmt(t.drift.zeroDrift)}%` },
          { k: '스팬 드리프트', v: `${fmt(t.drift.spanDrift)}%` },
          { k: '저농도 최종 반복성', v: `${fmt(t.finalRepeatability.zero.pct)}%` },
          { k: '고농도 최종 반복성', v: `${fmt(t.finalRepeatability.span.pct)}%` },
          { k: '직선성 오차', v: `${fmt(t.linearity.error)}%` },
        ],
        verdicts: [
          { label: `저농도 최종 반복성 (≤ ${PRECISION_CRITERIA.finalRepZero}%)`, pass: t.finalRepeatability.zero.pass },
          { label: `고농도 최종 반복성 (≤ ${PRECISION_CRITERIA.finalRepSpan}%)`, pass: t.finalRepeatability.span.pass },
          { label: `직선성 (≤ ${PRECISION_CRITERIA.linearity}%)`, pass: t.linearity.pass },
        ],
      };
    },
  },
];

/* ── 렌더링 ─────────────────────────────────────────────────────── */
function fieldHtml(f) {
  const label = f.label || f.id.split('_').pop().toUpperCase();
  if (f.type === 'select') {
    const opts = f.options.map((o) => `<option value="${o}">${o}</option>`).join('');
    return `<label class="field"><span class="field__label">${label}</span>
      <select id="pv_${f.id}" class="field__control">${opts}</select></label>`;
  }
  return `<label class="field"><span class="field__label">${label}</span>
    <input id="pv_${f.id}" class="field__control" type="number" step="any" inputmode="decimal" placeholder="0" /></label>`;
}

function calcFormHtml(c) {
  const groups = c.groups.map((grp) => `
    <div class="pv-group">
      <span class="pv-group__label">${grp.label}</span>
      <div class="pv-grid">${grp.fields.map(fieldHtml).join('')}</div>
    </div>`).join('');
  return `
    <div class="pv-form" id="pvform-${c.key}" hidden>
      <p class="hint">${c.desc}</p>
      ${groups}
      <div class="actions">
        <button class="btn btn--primary" type="button" data-run="${c.key}">계산</button>
      </div>
      <div class="pv-result" id="pvres-${c.key}"></div>
    </div>`;
}

function resultHtml(out) {
  const lines = out.lines.map((l) => `<div class="pv-line"><span>${l.k}</span><b>${l.v}</b></div>`).join('');
  const badges = out.verdicts.map((v) => {
    if (v.pass === null) return `<div class="pv-badge pv-badge--na">⚪ ${v.label}</div>`;
    return v.pass
      ? `<div class="pv-badge pv-badge--ok">✅ ${v.label} 적합</div>`
      : `<div class="pv-badge pv-badge--bad">❌ ${v.label} 부적합</div>`;
  }).join('');
  return `<div class="pv-lines">${lines}</div><div class="pv-badges">${badges}</div>`;
}

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

function init() {
  const panel = document.getElementById('panel-precision');
  if (!panel) return;

  panel.innerHTML = `
    <section class="card">
      <div class="pv-item-bar">
        <label class="pv-item-label">검사 항목</label>
        <select id="pv-item-select" class="field__control pv-item-select">
          ${ITEMS.map(it => `<option value="${it.code}">${it.label}</option>`).join('')}
        </select>
      </div>
      <div class="pv-subtabs" role="tablist">
        ${CALCS.map((c, i) => `<button class="pv-subtab${i === 0 ? ' is-active' : ''}" type="button" data-tab="${c.key}">${c.title}</button>`).join('')}
      </div>
      ${CALCS.map(calcFormHtml).join('')}
    </section>`;

  const g = (id) => parseFloat(document.getElementById(`pv_${id}`)?.value) || 0;
  const gs = (id) => document.getElementById(`pv_${id}`)?.value || '';

  // 서브탭 전환
  const forms = CALCS.map((c) => document.getElementById(`pvform-${c.key}`));
  function showTab(key) {
    panel.querySelectorAll('.pv-subtab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === key));
    forms.forEach((f) => { f.hidden = f.id !== `pvform-${key}`; });
  }
  panel.querySelectorAll('.pv-subtab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab(CALCS[0].key);

  // 계산 실행
  panel.querySelectorAll('[data-run]').forEach((btn) => btn.addEventListener('click', () => {
    const c = CALCS.find((x) => x.key === btn.dataset.run);
    const out = c.run(g, gs);
    document.getElementById(`pvres-${c.key}`).innerHTML = resultHtml(out);
  }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
