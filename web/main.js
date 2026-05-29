/**
 * KTL 정도검사 계산기 — 프런트엔드 로직 (vanilla JS).
 *
 * 서버사이드 /api 엔드포인트(vite.config.js의 미들웨어)를 호출하여
 * 오차율 계산과 수수료 조회를 수행한다. 계산 로직 자체는 서버의
 * calculator.js / excelClient.js 가 단일 출처(SSOT)로 담당한다.
 */

/**
 * 화면에 표시할 검사 항목 9종.
 * code 는 서버 calculator.js 의 파라미터 키와 일치시킨다.
 * (TU=탁도, CL=잔류염소 는 합격 기준 미정의 → 판정 '-')
 */
const ITEMS = [
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
const CRITERIA_HINT = {
  TOC: '오차율 ±10% 이내 → 적합',
  TN: '오차율 ±10% 이내 → 적합',
  TP: '오차율 ±10% 이내 → 적합',
  SS: '오차율 ±10% 이내 → 적합',
  COD: '오차율 ±10% 이내 → 적합',
  PH: '절대 편차 ±0.3 이내 → 적합',
  DO: '절대 편차 ±0.5 이내 → 적합',
  TU: '합격 기준 미정의 — 수치만 계산',
  CL: '합격 기준 미정의 — 수치만 계산',
};

const $ = (id) => document.getElementById(id);

const els = {
  item: $('item'),
  measured: $('measured'),
  standard: $('standard'),
  criterionHint: $('criterion-hint'),
  calcBtn: $('calc-btn'),
  resetBtn: $('reset-btn'),
  error: $('error-msg'),
  result: $('result'),
  conn: $('conn-status'),
};

/** 원화 포맷. */
function formatKRW(value) {
  return new Intl.NumberFormat('ko-KR').format(value) + '원';
}

/** 선택된 항목 메타데이터를 반환한다. */
function currentItem() {
  return ITEMS.find((i) => i.code === els.item.value) ?? ITEMS[0];
}

/** 항목 셀렉트를 채운다. */
function populateItems() {
  els.item.innerHTML = ITEMS.map(
    (i) => `<option value="${i.code}">${i.label}</option>`,
  ).join('');
}

/** 선택 항목의 기준 안내 + 입력 단위 갱신. */
function updateHint() {
  const item = currentItem();
  const unit = item.unit ? ` (단위: ${item.unit})` : '';
  els.criterionHint.textContent = `${CRITERIA_HINT[item.code] ?? ''}${unit}`;
}

/** 에러 메시지를 표시/숨김 한다. */
function showError(message) {
  if (!message) {
    els.error.hidden = true;
    els.error.textContent = '';
    return;
  }
  els.error.hidden = false;
  els.error.textContent = message;
}

/** 판정값에 대응하는 CSS 수식어를 반환한다. */
function judgmentModifier(judgment) {
  if (judgment === '적합') return 'pass';
  if (judgment === '부적합') return 'fail';
  return 'neutral';
}

/** 수수료를 조회한다 (없으면 undefined). */
async function fetchFee(code) {
  const res = await fetch(`/api/fee?item=${encodeURIComponent(code)}`);
  if (!res.ok) return undefined;
  const data = await res.json();
  return typeof data.fee === 'number' ? data.fee : undefined;
}

/** 계산 결과 카드를 렌더링한다. */
function renderResult(result, item, fee) {
  const mod = judgmentModifier(result.judgment);
  const feeLine =
    typeof fee === 'number'
      ? formatKRW(fee)
      : '<span class="muted">수수료 정보 없음</span>';

  els.result.className = 'result';
  els.result.innerHTML = `
    <div class="verdict verdict--${mod}">
      <span class="verdict__label">${result.judgment}</span>
      <span class="verdict__item">${item.label}</span>
    </div>
    <dl class="metrics">
      <div class="metric">
        <dt>측정값</dt><dd>${result.measured}${item.unit ? ' ' + item.unit : ''}</dd>
      </div>
      <div class="metric">
        <dt>표준값</dt><dd>${result.standard}${item.unit ? ' ' + item.unit : ''}</dd>
      </div>
      <div class="metric">
        <dt>오차율</dt><dd class="metric--accent">${result.errorRate} %</dd>
      </div>
      <div class="metric">
        <dt>절대 편차</dt><dd>${result.deviation}</dd>
      </div>
      <div class="metric">
        <dt>합격 기준</dt><dd>${result.criterion}</dd>
      </div>
      <div class="metric">
        <dt>수수료</dt><dd>${feeLine}</dd>
      </div>
    </dl>
  `;
}

/** 오차율 계산을 수행한다. */
async function calculate() {
  showError('');

  const measured = els.measured.value.trim();
  const standard = els.standard.value.trim();

  if (measured === '' || standard === '') {
    showError('측정값과 표준값을 모두 입력하세요.');
    return;
  }

  const item = currentItem();
  els.calcBtn.disabled = true;

  try {
    const res = await fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parameter: item.code,
        measured: Number(measured),
        standard: Number(standard),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error ?? '계산에 실패했습니다.');
      return;
    }

    const fee = await fetchFee(item.code);
    renderResult(data, item, fee);
  } catch {
    showError('서버에 연결할 수 없습니다.');
  } finally {
    els.calcBtn.disabled = false;
  }
}

/** 입력/결과를 초기화한다. */
function reset() {
  els.measured.value = '';
  els.standard.value = '';
  showError('');
  els.result.className = 'result result--empty';
  els.result.innerHTML =
    '<p class="result__placeholder">측정값과 표준값을 입력하고 계산하세요.</p>';
  els.measured.focus();
}

/** 서버 연결 상태 표시 (항목 목록 호출로 확인). */
async function checkConnection() {
  try {
    const res = await fetch('/api/items');
    els.conn.classList.toggle('conn--ok', res.ok);
    els.conn.title = res.ok ? 'API 연결됨' : 'API 응답 오류';
  } catch {
    els.conn.classList.remove('conn--ok');
    els.conn.title = 'API 연결 실패';
  }
}

function init() {
  populateItems();
  updateHint();

  els.item.addEventListener('change', updateHint);
  els.calcBtn.addEventListener('click', calculate);
  els.resetBtn.addEventListener('click', reset);

  // Enter 키로 계산 실행
  [els.measured, els.standard].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calculate();
    });
  });

  void checkConnection();
}

init();
