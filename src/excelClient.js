/**
 * 엑셀 DB 파싱 클라이언트.
 *
 * 데이터 소스(우선순위):
 *   1. 환경변수 KTL_DATA_FILE (서버 전용, 절대 클라이언트 노출 금지)
 *   2. Version11_(2026).xlsx  (기본 DB)
 *   3. data.xlsx              (구버전 폴백)
 *
 * 수수료 정보는 Sheet5에 다음 형태로 들어 있다:
 *   ... | "항목"   | TOC    | TN     | TP     | SS     | PH     | COD    | DO     | ...
 *   ... | "수수료" | 854000 | 851000 | 851000 | 698000 | 651000 | 851000 | 421000 | ...
 *
 * "항목" 행과 "수수료" 행을 동적으로 찾아 매핑하므로, 시트 위치가
 * 약간 바뀌어도 동작한다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join } from 'node:path';
import XLSX from 'xlsx';

// 번들링 환경(Vercel esbuild)에서 import.meta.url이 entry 파일을 가리킬 수 있으므로
// process.cwd()를 우선, import.meta.url 기반을 폴백으로 사용
const _metaDir = dirname(fileURLToPath(import.meta.url));
const _cwdRoot  = process.cwd();
// src/ 하위에 있으면 한 단계 올라가고, 아니면 그대로 사용
const PROJECT_ROOT = (() => {
  // import.meta.url 기반 경로에서 실제 파일 확인
  const fromMeta = join(_metaDir, '..');
  for (const name of ['Version11_(2026).xlsx', 'data.xlsx']) {
    if (existsSync(join(fromMeta, name))) return fromMeta;
    if (existsSync(join(_cwdRoot, name))) return _cwdRoot;
  }
  return fromMeta; // 폴백
})();

/** 기본 DB 파일명(우선순위 순). 첫 번째로 존재하는 파일을 사용한다. */
const DEFAULT_DATA_FILES = ['Version11_(2026).xlsx', 'data.xlsx'];

/** 수수료 정보가 들어 있는 시트 이름. */
const FEE_SHEET = 'Sheet5';

/** 실제로 읽을 엑셀 DB 경로를 결정한다. */
function resolveDataPath() {
  // 1. 환경변수 우선 (배포 환경에서 경로 교체 가능).
  const fromEnv = process.env.KTL_DATA_FILE;
  if (fromEnv) {
    const envPath = isAbsolute(fromEnv) ? fromEnv : join(PROJECT_ROOT, fromEnv);
    if (existsSync(envPath)) return envPath;
    // cwd 기반도 시도
    const cwdPath = isAbsolute(fromEnv) ? fromEnv : join(_cwdRoot, fromEnv);
    if (existsSync(cwdPath)) return cwdPath;
    throw new Error(`KTL_DATA_FILE이 가리키는 파일을 찾을 수 없습니다: ${fromEnv}`);
  }
  // 2. 기본 후보 중 존재하는 첫 파일 (PROJECT_ROOT, cwd 순으로 탐색).
  for (const base of [PROJECT_ROOT, _cwdRoot]) {
    for (const name of DEFAULT_DATA_FILES) {
      const candidate = join(base, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(
    `엑셀 DB 파일을 찾을 수 없습니다 (${DEFAULT_DATA_FILES.join(', ')}). cwd=${_cwdRoot}`,
  );
}

let cachedWorkbook;

/** 워크북을 한 번만 읽어 캐시한다. */
function getWorkbook() {
  if (!cachedWorkbook) {
    const buf = readFileSync(resolveDataPath());
    cachedWorkbook = XLSX.read(buf, { type: 'buffer' });
  }
  return cachedWorkbook;
}

/** 시트를 2차원 배열(행 우선)로 반환한다. */
function sheetToRows(sheetName) {
  const wb = getWorkbook();
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);
  }
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

/** 워크북의 모든 시트 이름을 반환한다. */
export function getSheetNames() {
  return getWorkbook().SheetNames;
}

/**
 * 현재 사용 중인 엑셀 DB 파일명(베이스네임)만 반환한다.
 * 절대경로/디렉터리는 노출하지 않는다 (내부 경로 비노출 원칙).
 * @returns {string}
 */
export function getDataFileName() {
  return basename(resolveDataPath());
}

/**
 * 특정 시트의 원본 데이터를 반환한다.
 * @param {string} sheetName
 * @returns {{ sheetName: string, rowCount: number, rows: unknown[][] }}
 */
export function getSheetData(sheetName) {
  const rows = sheetToRows(sheetName);
  return { sheetName, rowCount: rows.length, rows };
}

/** 한글 항목명 → 표준 약어 매핑 (TU·CL 섹션용) */
const KO_TO_ABBR = {
  '탁도':     'TU',
  '잔류염소': 'CL',
};

/** Sheet5에서 모든 "항목"/"수수료" 쌍을 찾아 {항목: 수수료} 맵을 만든다. */
function buildFeeMap() {
  const rows = sheetToRows(FEE_SHEET);

  /** @type {Map<string, { item: string, fee: number }>} */
  const map = new Map();

  for (let r = 0; r < rows.length; r++) {
    if (String(rows[r][0]).trim() !== '항목') continue;
    const itemRow = rows[r];
    const feeRow  = rows[r + 1];
    if (!feeRow || String(feeRow[0]).trim() !== '수수료') continue;

    for (let col = 1; col < itemRow.length; col++) {
      const rawName = String(itemRow[col]).trim();
      if (!rawName) continue;
      const fee = feeRow[col];
      if (typeof fee !== 'number' || fee <= 0) continue;

      // 숫자로만 된 항목명, 복합 항목(슬래시 포함) 제외
      if (/^\d+$/.test(rawName) || rawName.includes('/')) continue;

      // 한글명은 표준 약어로 변환, 나머지는 대문자 유지
      const abbr = KO_TO_ABBR[rawName] ?? rawName.toUpperCase();
      if (!map.has(abbr)) {
        map.set(abbr, { item: abbr, fee });
      }
    }
  }

  if (map.size === 0) {
    throw new Error(`${FEE_SHEET}에서 "항목"/"수수료" 데이터를 찾을 수 없습니다.`);
  }
  return map;
}

let cachedFeeMap;
function getFeeMap() {
  if (!cachedFeeMap) cachedFeeMap = buildFeeMap();
  return cachedFeeMap;
}

/**
 * 검사 가능한 항목 목록과 수수료를 반환한다.
 * @returns {{ item: string, fee: number }[]}
 */
export function listTestItems() {
  return [...getFeeMap().values()];
}

/**
 * 특정 항목의 수수료를 조회한다.
 * @param {string} item - 예: "TOC", "tn", "DO"
 * @returns {{ item: string, fee: number } | undefined}
 */
export function getTestFee(item) {
  if (typeof item !== 'string') return undefined;
  return getFeeMap().get(item.trim().toUpperCase());
}
