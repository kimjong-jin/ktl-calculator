/**
 * KTL 정도검사 계산기 — 프런트엔드 진입점 (vanilla JS, ES 모듈).
 *
 * 계산/수수료/DB 로직은 서버(calculator.js·excelClient.js)가 단일 출처(SSOT).
 * 이 파일은 상수·DOM 바인딩·흐름 제어만 담당하고 세부 기능은 모듈로 분리한다.
 *   api.js(서버 호출) · history.js(localStorage) · exporter.js(CSV/JSON) · render.js(DOM)
 */

import { ITEMS, CRITERIA_HINT, UNJUDGED, itemByCode } from './constants.js';
import { postCalculate, getFee, getDbStatus } from './api.js';
import * as history from './history.js';
import { exportCsv, exportJson } from './exporter.js';
import {
  renderResult,
  renderResultEmpty,
  renderHistory,
  renderStatusChip,
} from './render.js';

const $ = (id) => document.getElementById(id);
const els = {
  item: $('item'),
  measured: $('measured'),
  standard: $('standard'),
  hint: $('criterion-hint'),
  calcBtn: $('calc-btn'),
  resetBtn: $('reset-btn'),
  error: $('error-msg'),
  result: $('result'),
  chip: $('status-chip'),
  themeBtn: $('theme-btn'),
  histTitle: $('hist-title'),
  histSummary: $('hist-summary'),
  histList: $('history'),
  exportCsv: $('export-csv'),
  exportJson: $('export-json'),
  clearHist: $('clear-hist'),
};

let entries = [];

/** 항목 셀렉트를 채운다. */
function populateItems() {
  els.item.replaceChildren(
    ...ITEMS.map((i) => {
      const opt = document.createElement('option');
      opt.value = i.code;
      opt.textContent = i.label;
      return opt;
    }),
  );
}

/** 선택 항목의 기준 안내 + 단위 갱신. */
function updateHint() {
  const item = itemByCode(els.item.value);
  const unit = item.unit ? ` (단위: ${item.unit})` : '';
  els.hint.textContent = `${CRITERIA_HINT[item.code] ?? ''}${unit}`;
  els.hint.classList.toggle('hint--neutral', UNJUDGED.has(item.code));
}

/** 에러 메시지 표시/숨김. */
function showError(message) {
  els.error.hidden = !message;
  els.error.textContent = message ?? '';
}

/** 짧은 시각 라벨 (MM-DD HH:mm). */
function nowLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 이력 카드(목록·카운트·요약·버튼)를 다시 그린다. */
function refreshHistory() {
  renderHistory(els.histList, entries, handleDelete);
  els.histTitle.textContent = `계산 이력 (${entries.length}건)`;
  const s = history.summary(entries);
  els.histSummary.textContent = entries.length
    ? `적합 ${s.pass} · 부적합 ${s.fail} · 비대상 ${s.neutral}`
    : '';
  const empty = entries.length === 0;
  els.exportCsv.disabled = empty;
  els.exportJson.disabled = empty;
  els.clearHist.disabled = empty;
}

/** 오차율 계산 실행. */
async function calculate() {
  showError('');
  const measured = els.measured.value.trim();
  const standard = els.standard.value.trim();
  if (measured === '' || standard === '') {
    showError('측정값과 표준값을 모두 입력하세요.');
    return;
  }

  const item = itemByCode(els.item.value);
  els.calcBtn.disabled = true;
  try {
    const result = await postCalculate({
      parameter: item.code,
      measured: Number(measured),
      standard: Number(standard),
    });
    const fee = await getFee(item.code);
    renderResult(els.result, result, item, fee);
    entries = history.add({
      code: item.code,
      label: item.label,
      ts: nowLabel(),
      measured: result.measured,
      standard: result.standard,
      errorRate: result.errorRate,
      deviation: result.deviation,
      criterion: result.criterion,
      judgment: result.judgment,
      fee: typeof fee === 'number' ? fee : null,
    });
    refreshHistory();
    els.measured.focus();
  } catch (e) {
    showError(e instanceof Error ? e.message : '서버에 연결할 수 없습니다.');
  } finally {
    els.calcBtn.disabled = false;
  }
}

/** 입력/현재 결과만 초기화 (이력 보존). */
function reset() {
  els.measured.value = '';
  els.standard.value = '';
  showError('');
  renderResultEmpty(els.result);
  els.measured.focus();
}

/** 이력 한 건 삭제. */
function handleDelete(id) {
  entries = history.removeById(id);
  refreshHistory();
}

/** 이력 전체 삭제 (확인 1단계). */
function handleClear() {
  if (!entries.length) return;
  if (!confirm('계산 이력을 모두 삭제할까요?')) return;
  entries = history.clear();
  refreshHistory();
}

/** 테마 적용 + 저장. */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('ktl-theme', theme);
  } catch {
    /* 저장 실패는 무시 (테마는 기능 비핵심) */
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
}

/** DB 연동 상태를 조회해 칩을 갱신한다. */
async function refreshStatus() {
  renderStatusChip(els.chip, 'checking');
  const status = await getDbStatus();
  renderStatusChip(els.chip, status);
}

function init() {
  const saved = (() => {
    try {
      return localStorage.getItem('ktl-theme');
    } catch {
      return null;
    }
  })();
  if (saved) applyTheme(saved);

  populateItems();
  updateHint();
  entries = history.load();
  refreshHistory();

  els.item.addEventListener('change', updateHint);
  els.calcBtn.addEventListener('click', calculate);
  els.resetBtn.addEventListener('click', reset);
  els.themeBtn.addEventListener('click', toggleTheme);
  els.exportCsv.addEventListener('click', () => exportCsv(entries));
  els.exportJson.addEventListener('click', () => exportJson(entries));
  els.clearHist.addEventListener('click', handleClear);

  [els.measured, els.standard].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calculate();
      if (e.key === 'Escape') reset();
    });
  });

  void refreshStatus();
}

init();
