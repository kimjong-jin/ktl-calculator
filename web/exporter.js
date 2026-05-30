/**
 * 계산 이력 내보내기 — CSV / JSON.
 *
 * 서버 라운드트립 없이 클라이언트에서 Blob 으로 파일을 만든다.
 * (엑셀 DB 원본 파일은 노출 정책상 다운로드하지 않는다 — 사용자가 만든 이력만.)
 */

const COLUMNS = [
  ['시각', (e) => e.ts],
  ['항목', (e) => e.label],
  ['측정값', (e) => e.measured],
  ['표준값', (e) => e.standard],
  ['오차율(%)', (e) => e.errorRate],
  ['절대편차', (e) => e.deviation],
  ['판정', (e) => e.judgment],
  ['합격기준', (e) => e.criterion],
  ['수수료(원)', (e) => (typeof e.fee === 'number' ? e.fee : '')],
];

/** CSV 한 셀을 안전하게 escaping 한다. */
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 이력 → CSV 문자열 (UTF-8 BOM 포함, 엑셀 한글 깨짐 방지). */
export function toCSV(history) {
  const header = COLUMNS.map((c) => c[0]).join(',');
  const lines = history.map((e) =>
    COLUMNS.map((c) => csvCell(c[1](e))).join(','),
  );
  return '﻿' + [header, ...lines].join('\r\n');
}

/** 이력 → 보기 좋은 JSON 문자열. */
export function toJSON(history) {
  return JSON.stringify(history, null, 2);
}

/** YYYYMMDD-HHMM 형식 타임스탬프. */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/** 문자열을 파일로 내려받는다 (Blob + anchor, URL 해제 포함). */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 이력을 CSV 파일로 내보낸다. */
export function exportCsv(history) {
  download(`ktl-calc-history-${stamp()}.csv`, toCSV(history), 'text/csv;charset=utf-8');
}

/** 이력을 JSON 파일로 내보낸다. */
export function exportJson(history) {
  download(`ktl-calc-history-${stamp()}.json`, toJSON(history), 'application/json');
}
