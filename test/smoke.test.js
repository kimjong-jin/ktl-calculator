/**
 * 핵심 로직 스모크 테스트 (MCP 전송 계층 없이 모듈 직접 검증).
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import {
  listTestItems,
  getTestFee,
  getSheetNames,
  getSheetData,
} from '../src/excelClient.js';
import { calculateAccuracy } from '../src/calculator.js';
import {
  CLAYDOX_PARAMS,
  getClaydoxTargets,
  buildClaydoxPayload,
} from '../src/claydoxMappings.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('excelClient');
check('시트 6개를 읽는다', () => {
  assert.equal(getSheetNames().length, 6);
});
check('항목 목록에 TOC가 있고 수수료는 854000원', () => {
  const toc = listTestItems().find((i) => i.item === 'TOC');
  assert.ok(toc, 'TOC 항목 존재');
  assert.equal(toc.fee, 854000);
});
check('get_test_fee는 대소문자 무관', () => {
  assert.equal(getTestFee('do').fee, 421000);
  assert.equal(getTestFee('DO').fee, 421000);
});
check('없는 항목은 undefined', () => {
  assert.equal(getTestFee('XYZ'), undefined);
});
check('getSheetData는 행 배열 반환', () => {
  const d = getSheetData('Sheet5');
  assert.ok(d.rowCount > 0);
  assert.ok(Array.isArray(d.rows[0]));
});

console.log('calculator');
check('TOC 오차 5% → 적합', () => {
  const r = calculateAccuracy({ parameter: 'TOC', measured: 105, standard: 100 });
  assert.equal(r.errorRate, '5.00');
  assert.equal(r.judgment, '적합');
});
check('TOC 오차 12% → 부적합', () => {
  const r = calculateAccuracy({ parameter: 'TOC', measured: 112, standard: 100 });
  assert.equal(r.judgment, '부적합');
});
check('pH 편차 0.2 → 적합 (±0.3 절대기준)', () => {
  const r = calculateAccuracy({ parameter: 'pH', measured: 7.2, standard: 7.0 });
  assert.equal(r.judgment, '적합');
});
check('pH 편차 0.4 → 부적합', () => {
  const r = calculateAccuracy({ parameter: 'pH', measured: 7.4, standard: 7.0 });
  assert.equal(r.judgment, '부적합');
});
check('DO 편차 0.5 → 적합 (경계값 포함)', () => {
  const r = calculateAccuracy({ parameter: 'DO', measured: 8.5, standard: 8.0 });
  assert.equal(r.judgment, '적합');
});
check('표준값 0이면 에러', () => {
  assert.throws(() => calculateAccuracy({ parameter: 'TOC', measured: 1, standard: 0 }));
});
check('기준 미정의 파라미터는 판정 "-"', () => {
  const r = calculateAccuracy({ parameter: 'TU', measured: 10, standard: 9 });
  assert.equal(r.judgment, '-');
});

console.log('claydoxMappings');
check('9개 파라미터를 지원한다', () => {
  assert.equal(CLAYDOX_PARAMS.length, 9);
  assert.ok(CLAYDOX_PARAMS.includes('TOC'));
  assert.ok(CLAYDOX_PARAMS.includes('pH'));
});
check('target 조회는 대소문자 무관 (PH→pH)', () => {
  assert.deepEqual(getClaydoxTargets('PH'), getClaydoxTargets('pH'));
  assert.ok(getClaydoxTargets('toc').length > 0);
});
check('없는 파라미터는 에러', () => {
  assert.throws(() => getClaydoxTargets('XYZ'));
});
check('페이로드 구조: phpEXCEL.INPUT_DATA, target 수 일치', () => {
  const payload = buildClaydoxPayload('TOC', { M1: 1.23 });
  assert.equal(payload.phpEXCEL.FILE_UID, 'excel');
  assert.equal(payload.phpEXCEL.INPUT_DATA.length, getClaydoxTargets('TOC').length);
});
check('입력값은 문자열로, 미입력 target은 빈 문자열로 채운다', () => {
  const payload = buildClaydoxPayload('TOC', { M1: 1.23 });
  const m1 = payload.phpEXCEL.INPUT_DATA.find((d) => d.target === 'M1');
  assert.equal(m1.value, '1.23');
  assert.equal(m1.cellName, 'D12');
  assert.equal(m1.targetType, 'multi_text');
  const blank = payload.phpEXCEL.INPUT_DATA.find((d) => d.value === '');
  assert.ok(blank, '미입력 target은 빈 문자열');
});

console.log(`\n${passed}개 테스트 통과 ✅`);
