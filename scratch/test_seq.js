import fs from 'fs';
import path from 'path';
import assert from 'assert';

// mock globals
global.stored = {
  rep_extra: false,
  resp_skip: false
};

const filePath = path.join(process.cwd(), 'web/precision-ui.js');
const content = fs.readFileSync(filePath, 'utf-8');

// Helper functions and states
const helpers = `
const IS_PH    = c => c === 'PH';
const IS_DO    = c => c === 'DO';
const IS_WATER = c => ['TU','CL'].includes(c);
function isRepExtraOpen(code) { return global.stored.rep_extra === true; }
`;

// Helper to cut out a function by start marker and end marker
function cutFunction(content, name, nextMarker) {
  const startIdx = content.indexOf(`function ${name}`);
  if (startIdx === -1) {
    throw new Error(`Function ${name} not found`);
  }
  const endIdx = content.indexOf(nextMarker, startIdx);
  if (endIdx === -1) {
    throw new Error(`Next marker ${nextMarker} not found`);
  }
  return content.substring(startIdx, endIdx);
}

const func1 = cutFunction(content, 'getDefaultPipelineSteps', 'function sortStepsChronologically');
const func2 = cutFunction(content, 'parseSequenceString', 'function getPipelineSteps');

const finalCode = `
${helpers}
${func1}
${func2}
return { parseSequenceString };
`;

const runner = new Function(finalCode);
const { parseSequenceString } = runner();

console.log('--- Running Improved Sequence Parser Unit Tests ---');

// Test Case 1: MMMZZSSZSZZSS (TOC) - 반복성 중간 측정형
const result1 = parseSequenceString('TOC', 'MMMZZSSZSZZSS');
const ids1 = result1.map(r => r.id);
console.log('TOC MMMZZSSZSZZSS result ids:', ids1);
const expected1 = ['m1', 'm2', 'm3', 'z1', 'z2', 's1', 's2', 'z5', 's5', 'z3', 'z4', 's3', 's4'];
assert.deepStrictEqual(ids1, expected1, 'TOC MMMZZSSZSZZSS should map correctly');
console.log('✅ Test Case 1 Passed!');

// Test Case 2: MMMZZSSZZSSZSZSZS (TOC, rep_extra=true) - 반복성 후기 몰아서 측정형
global.stored.rep_extra = true;
const result2 = parseSequenceString('TOC', 'MMMZZSSZZSSZSZSZS');
const ids2 = result2.map(r => r.id);
console.log('TOC MMMZZSSZZSSZSZSZS result ids:', ids2);
const expected2 = [
  'm1', 'm2', 'm3',
  'z1', 'z2', 's1', 's2', // 1차 드리프트
  'z3', 'z4', 's3', 's4', // 2차 드리프트 (중간에 매핑)
  'z5', 's5', 'z6', 's6', 'z7', 's7' // 반복성 3회 (뒤에 매핑)
];
assert.deepStrictEqual(ids2, expected2, 'TOC MMMZZSSZZSSZSZSZS should map correctly');
console.log('✅ Test Case 2 Passed!');

// Test Case 3: ZS (TOC, rep_extra=false) - 단독 반복성 1회
global.stored.rep_extra = false;
const result3 = parseSequenceString('TOC', 'ZS');
const ids3 = result3.map(r => r.id);
console.log('TOC ZS result ids:', ids3);
assert.deepStrictEqual(ids3, ['z5', 's5'], 'TOC ZS should map to repeatability (z5, s5)');
console.log('✅ Test Case 3 Passed!');

// Test Case 4: ZZSS (TOC, rep_extra=true) - 단독 반복성 2회 (Z/S 개수가 3개 이하라 자동 반복성 z5, z6 매핑되어야 함)
global.stored.rep_extra = true;
const result4 = parseSequenceString('TOC', 'ZZSS');
const ids4 = result4.map(r => r.id);
console.log('TOC ZZSS (rep_extra=true) result ids:', ids4);
assert.deepStrictEqual(ids4, ['z5', 'z6', 's5', 's6'], 'TOC ZZSS (total <= 3) should map to repeatability (z5, z6, s5, s6) via fallback');
console.log('✅ Test Case 4 Passed!');

// Test Case 4-2: ZZSS (TOC, rep_extra=false) - 단독 반복성 2회이나 rep_extra=false인 경우 (z5, s5만 있어야 함)
global.stored.rep_extra = false;
const result4_2 = parseSequenceString('TOC', 'ZZSS');
const ids4_2 = result4_2.map(r => r.id);
console.log('TOC ZZSS (rep_extra=false) result ids:', ids4_2);
assert.deepStrictEqual(ids4_2, ['z5', 's5'], 'TOC ZZSS (rep_extra=false) should only have z5, s5');
console.log('✅ Test Case 4-2 Passed!');

// Test Case 5: 변칙적인 입력 - MMM Z Z S S Z Z (TOC, rep_extra=false, 단독 Z/S 남음)
const result5 = parseSequenceString('TOC', 'MMMZZSSZZ');
const ids5 = result5.map(r => r.id);
console.log('TOC MMMZZSSZZ result ids:', ids5);
const expected5 = [
  'm1', 'm2', 'm3',
  'z1', 'z2', 's5', // ZZSS 패턴 매칭 중 poolS가 [s5]만 있어서 s5만 추가됨 (s2는 poolS 부족으로 누락)
  'z5', 'z3' // 남은 ZZ 단독 매핑 시 poolZ=[z5, z3, z4] 에서 순서대로 할당됨 (폴백)
];
assert.deepStrictEqual(ids5, expected5, 'TOC MMMZZSSZZ should map correctly with fallback');
console.log('✅ Test Case 5 Passed!');

console.log('All tests passed successfully!');
