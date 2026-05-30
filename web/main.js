/**
 * KTL 전문 계측 서비스 — 프런트엔드 진입점 (vanilla JS, ES 모듈).
 *
 * 계산/수수료/DB 로직은 서버(calculator.js·excelClient.js)가 단일 출처(SSOT).
 * 이 파일은 상수·DOM 바인딩·흐름 제어만 담당하고 세부 기능은 모듈로 분리한다.
 *   api.js(서버 호출) · history.js(localStorage) · exporter.js(CSV/JSON) · render.js(DOM)
 *   chat.js(AI 법령 해석 챗봇)
 */

import { ITEMS, CRITERIA_HINT, UNJUDGED, itemByCode } from './constants.js';
import { postCalculate, getFee, getDbStatus } from './api.js';
import * as history from './history.js';
import { exportCsv, exportJson, exportClaydoxPayload } from './exporter.js';
import { loadClaydoxMappings, inputTargets, buildPayload } from './claydox.js';
import {
  renderResult,
  renderResultEmpty,
  renderHistory,
  renderStatusChip,
  renderClaydoxForm,
  renderClaydoxJson,
} from './render.js';
import { initChat } from './chat.js';

const $ = (id) => document.getElementById(id);

// ── 인증 ────────────────────────────────────────────────────────────────────

function getStoredToken() {
  try { return localStorage.getItem('ktl-auth'); } catch { return null; }
}

function storeToken(token) {
  try { localStorage.setItem('ktl-auth', token); } catch { /* 무시 */ }
}

function tokenValid(token) {
  if (!token || !token.includes('.')) return false;
  try {
    const [payload] = token.split('.');
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.exp === 'number' && Date.now() / 1000 < decoded.exp;
  } catch { return false; }
}

function showAuthError(msg) {
  const el = $('auth-err');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg ?? '';
}

function setupAuthGate(onSuccess) {
  const passEl = $('auth-pass');
  const btn = $('auth-btn');
  if (!passEl || !btn) return;

  passEl.focus();

  async function attempt() {
    btn.disabled = true;
    btn.textContent = '확인 중…';
    showAuthError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passEl.value }),
      });
      // AUTH 미설정 환경(개발)에서는 그냥 진행
      if (res.status === 500 && import.meta.env.DEV) {
        console.warn('[auth] DEV: AUTH_SECRET 미설정, 인증 우회');
        onSuccess();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        showAuthError(data.error || '비밀번호가 올바르지 않습니다.');
        return;
      }
      storeToken(data.token);
      onSuccess();
    } catch {
      showAuthError('서버에 연결할 수 없습니다.');
    } finally {
      btn.disabled = false;
      btn.textContent = '접속하기';
    }
  }

  btn.addEventListener('click', attempt);
  passEl.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
}

function showApp() {
  const gate = $('auth-gate');
  const app = $('main-app');
  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
}

/** 인증 확인 → 완료 시 onReady() 호출. */
function guardAuth(onReady) {
  if (tokenValid(getStoredToken())) {
    showApp();
    onReady();
    return;
  }
  setupAuthGate(() => { showApp(); onReady(); });
}

// ── 서비스 탭 ────────────────────────────────────────────────────────────────

let chatInited = false;

function initSvcTabs() {
  const tabs = document.querySelectorAll('.svc-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const svc = tab.dataset.svc;
      $('svc-calc').hidden = svc !== 'calc';
      $('svc-chat').hidden = svc !== 'chat';
      if (svc === 'chat' && !chatInited) {
        initChat();
        chatInited = true;
      }
    });
  });
}

// ── 계산기 ────────────────────────────────────────────────────────────────────

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
  cdxMeta: $('cdx-meta'),
  cdxFields: $('cdx-fields'),
  cdxOutput: $('cdx-output'),
  cdxBuild: $('cdx-build'),
  cdxCopy: $('cdx-copy'),
  cdxDownload: $('cdx-download'),
};

let entries = [];
let claydoxMappings;
let lastPayload;

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

function updateHint() {
  const item = itemByCode(els.item.value);
  const unit = item.unit ? ` (단위: ${item.unit})` : '';
  els.hint.textContent = `${CRITERIA_HINT[item.code] ?? ''}${unit}`;
  els.hint.classList.toggle('hint--neutral', UNJUDGED.has(item.code));
}

function showError(message) {
  els.error.hidden = !message;
  els.error.textContent = message ?? '';
}

function nowLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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

function reset() {
  els.measured.value = '';
  els.standard.value = '';
  showError('');
  renderResultEmpty(els.result);
  els.measured.focus();
}

function handleDelete(id) {
  entries = history.removeById(id);
  refreshHistory();
}

function handleClear() {
  if (!entries.length) return;
  if (!confirm('계산 이력을 모두 삭제할까요?')) return;
  entries = history.clear();
  refreshHistory();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ktl-theme', theme); } catch { /* 무시 */ }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
}

function resetClaydoxOutput() {
  lastPayload = undefined;
  els.cdxOutput.hidden = true;
  els.cdxOutput.textContent = '';
  els.cdxCopy.disabled = true;
  els.cdxDownload.disabled = true;
}

function updateClaydox() {
  if (!claydoxMappings) return;
  const item = itemByCode(els.item.value);
  const inputs = inputTargets(claydoxMappings, item.code);
  renderClaydoxForm(els.cdxFields, els.cdxMeta, item, inputs);
  els.cdxBuild.disabled = inputs.length === 0;
  resetClaydoxOutput();
}

function buildClaydox() {
  if (!claydoxMappings) return;
  const item = itemByCode(els.item.value);
  const values = {};
  els.cdxFields.querySelectorAll('input[data-target]').forEach((input) => {
    const v = input.value.trim();
    if (v !== '') values[input.dataset.target] = v;
  });
  try {
    lastPayload = buildPayload(claydoxMappings, item.code, values);
    renderClaydoxJson(els.cdxOutput, lastPayload);
    els.cdxCopy.disabled = false;
    els.cdxDownload.disabled = false;
  } catch (e) {
    console.error('[claydox] 페이로드 생성 실패:', e instanceof Error ? e.message : e);
    els.cdxMeta.textContent = 'Claydox 페이로드 생성에 실패했습니다.';
  }
}

async function copyClaydox() {
  if (!lastPayload) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
    els.cdxCopy.textContent = '복사됨';
    setTimeout(() => { els.cdxCopy.textContent = '복사'; }, 1_500);
  } catch (e) {
    console.error('[claydox] 클립보드 복사 실패:', e instanceof Error ? e.message : e);
  }
}

async function initClaydox() {
  try {
    claydoxMappings = await loadClaydoxMappings();
    updateClaydox();
  } catch (e) {
    console.error('[claydox] 매핑 로드 실패:', e instanceof Error ? e.message : e);
    els.cdxMeta.textContent = 'Claydox 매핑을 불러오지 못했습니다.';
    els.cdxBuild.disabled = true;
  }
}

async function refreshStatus() {
  renderStatusChip(els.chip, 'checking');
  const status = await getDbStatus();
  renderStatusChip(els.chip, status);
}

// ── 진입점 ────────────────────────────────────────────────────────────────────

function init() {
  const saved = (() => { try { return localStorage.getItem('ktl-theme'); } catch { return null; } })();
  if (saved) applyTheme(saved);

  populateItems();
  updateHint();
  entries = history.load();
  refreshHistory();

  initSvcTabs();

  els.item.addEventListener('change', updateHint);
  els.item.addEventListener('change', updateClaydox);
  els.cdxBuild.addEventListener('click', buildClaydox);
  els.cdxCopy.addEventListener('click', copyClaydox);
  els.cdxDownload.addEventListener('click', () => {
    if (lastPayload) exportClaydoxPayload(lastPayload, itemByCode(els.item.value).code);
  });
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
  void initClaydox();
}

guardAuth(init);
