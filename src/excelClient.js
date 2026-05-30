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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

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
    throw new Error(`KTL_DATA_FILE이 가리키는 파일을 찾을 수 없습니다: ${fromEnv}`);
  }
  // 2. 기본 후보 중 존재하는 첫 파일.
  for (const name of DEFAULT_DATA_FILES) {
    const candidate = join(PROJECT_ROOT, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `엑셀 DB 파일을 찾을 수 없습니다 (${DEFAULT_DATA_FILES.join(', ')}).`,
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

/** Sheet5에서 "항목" 행과 "수수료" 행을 찾아 {항목: 수수료} 맵을 만든다. */
function buildFeeMap() {
  const rows = sheetToRows(FEE_SHEET);

  const itemRow = rows.find((r) => String(r[0]).trim() === '항목');
  const feeRow = rows.find((r) => String(r[0]).trim() === '수수료');

  if (!itemRow || !feeRow) {
    throw new Error(`${FEE_SHEET}에서 "항목"/"수수료" 행을 찾을 수 없습니다.`);
  }

  /** @type {Map<string, number>} */
  const map = new Map();
  // 첫 칸(라벨)은 건너뛰고 항목명-수수료를 짝지운다.
  for (let col = 1; col < itemRow.length; col++) {
    const name = String(itemRow[col]).trim();
    const fee = feeRow[col];
    if (name && typeof fee === 'number') {
      map.set(name.toUpperCase(), { item: name, fee });
    }
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
