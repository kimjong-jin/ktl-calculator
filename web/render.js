/**
 * DOM 렌더링 — 판정 hero / 계산 이력 / DB 연동 칩.
 *
 * 동적 값은 textContent 로만 넣어 XSS 를 차단한다.
 * 모든 수치는 서버에서 toFixed(2) 된 문자열을 그대로 표시한다.
 */

import { PARAM_COLOR, UNJUDGED } from './constants.js';

/** 간단한 엘리먼트 빌더. props.class / props.text / dataset 지원. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/** 원화 포맷. */
export function formatKRW(value) {
  return new Intl.NumberFormat('ko-KR').format(value) + '원';
}

/** 판정값 → { mod, text }. */
function verdict(judgment, code) {
  if (judgment === '적합') return { mod: 'pass', text: '적합' };
  if (judgment === '부적합') return { mod: 'fail', text: '부적합' };
  return { mod: 'neutral', text: UNJUDGED.has(code) ? '판정 비대상' : '판정 보류' };
}

/** 보조 메트릭 한 칸. */
function metric(label, value, accent) {
  return el('div', { class: 'metric' }, [
    el('dt', { text: label }),
    el('dd', { class: accent ? 'metric__v metric__v--accent' : 'metric__v', text: value }),
  ]);
}

/** 판정 hero 카드를 그린다. */
export function renderResult(container, result, item, fee) {
  const v = verdict(result.judgment, item.code);
  const unit = item.unit ? ` ${item.unit}` : '';
  container.className = 'result';
  container.style.setProperty('--accent', PARAM_COLOR[item.code] ?? 'var(--accent-base)');

  const badge = el('div', { class: `verdict verdict--${v.mod}` }, [
    el('span', { class: 'verdict__label', text: v.text }),
    el('span', { class: 'verdict__item', text: item.label }),
  ]);
  const hero = el('div', { class: 'hero-rate' }, [
    el('span', { class: 'hero-rate__num', text: result.errorRate }),
    el('span', { class: 'hero-rate__unit', text: '% 오차율' }),
  ]);
  const metrics = el('dl', { class: 'metrics' }, [
    metric('측정값', `${result.measured}${unit}`),
    metric('표준값', `${result.standard}${unit}`),
    metric('절대 편차', result.deviation),
    metric('합격 기준', result.criterion),
    metric('수수료', typeof fee === 'number' ? formatKRW(fee) : '정보 없음'),
  ]);

  container.replaceChildren(badge, hero, metrics);
  if (v.mod === 'neutral') {
    container.appendChild(el('p', { class: 'note', text: '이 항목은 판정 기준이 없어 수치만 계산합니다.' }));
  }
}

/** 결과 카드를 빈 상태로 되돌린다. */
export function renderResultEmpty(container) {
  container.className = 'result result--empty';
  container.style.removeProperty('--accent');
  container.replaceChildren(
    el('p', { class: 'placeholder', text: '측정값과 표준값을 입력하고 계산하세요.' }),
  );
}

/** 이력 행 하나. onDelete(id) 콜백. */
function historyRow(entry, onDelete) {
  const v = verdict(entry.judgment, entry.code);
  const dot = el('span', { class: 'param-dot' });
  dot.style.background = PARAM_COLOR[entry.code] ?? 'var(--text-dim)';

  const del = el('button', { class: 'icon-btn', title: '이 항목 삭제', text: '✕' });
  del.setAttribute('aria-label', `${entry.label} 이력 삭제`);
  del.addEventListener('click', () => onDelete(entry.id));

  return el('li', { class: 'hist__row' }, [
    dot,
    el('span', { class: 'hist__item', text: entry.label }),
    el('span', { class: `pill pill--${v.mod}`, text: v.text }),
    el('span', { class: 'hist__rate', text: `${entry.errorRate}%` }),
    el('span', { class: 'hist__time', text: entry.ts }),
    del,
  ]);
}

/** 이력 리스트를 그린다 (빈 상태 포함). */
export function renderHistory(listEl, history, onDelete) {
  if (history.length === 0) {
    listEl.replaceChildren(
      el('li', { class: 'hist__empty', text: '아직 계산 이력이 없습니다.' }),
    );
    return;
  }
  listEl.replaceChildren(...history.map((e) => historyRow(e, onDelete)));
}

/**
 * Claydox 입력 폼을 그린다 — 항목별 고유 target 마다 입력칸 1개.
 * 동적 값은 textContent/placeholder 로만 넣어 XSS 를 차단한다.
 * @param {HTMLElement} container  입력칸이 들어갈 그리드
 * @param {HTMLElement} metaEl     안내 문구 노드
 * @param {{label:string, code:string}} item
 * @param {Array<{target:string, cell:string, sheet:string}>} inputs  inputTargets() 결과
 */
export function renderClaydoxForm(container, metaEl, item, inputs) {
  metaEl.textContent = inputs.length
    ? `${item.label} · 입력 항목 ${inputs.length}개 → 엑셀 ${inputs[0].sheet} 셀에 매핑`
    : `${item.label} 은(는) Claydox 전송 매핑이 없습니다.`;

  container.replaceChildren(
    ...inputs.map((t) => {
      const input = el('input', { class: 'field__control field__control--mini' });
      input.type = 'text';
      input.dataset.target = t.target;
      input.setAttribute('inputmode', 'decimal');
      input.placeholder = `셀 ${t.cell}`;
      return el('label', { class: 'field field--mini', title: `${t.sheet} · ${t.cell}` }, [
        el('span', { class: 'field__label', text: t.target }),
        input,
      ]);
    }),
  );
}

/** 생성된 Claydox 페이로드(JSON)를 출력 영역에 표시한다. */
export function renderClaydoxJson(outputEl, payload) {
  outputEl.hidden = false;
  outputEl.textContent = JSON.stringify(payload, null, 2);
}

/** DB 연동 상태 칩을 그린다. state: 'ok' | 'down' | 'checking'. */
export function renderStatusChip(chipEl, status) {
  const ok = status && status.connected;
  const state = status === 'checking' ? 'checking' : ok ? 'ok' : 'down';
  const label =
    state === 'checking' ? '연동 확인 중' : ok ? 'DB 연동됨' : '연동 끊김';
  const meta =
    ok && status.fileName
      ? `${status.fileName} · 시트 ${status.sheetCount}개 · 항목 ${status.itemCount}종`
      : '';

  chipEl.className = `status-chip status-chip--${state}`;
  chipEl.replaceChildren(
    el('span', { class: 'status-chip__dot' }),
    el('span', { class: 'status-chip__label', text: label }),
    meta ? el('span', { class: 'status-chip__meta', text: meta }) : el('span'),
  );
}
