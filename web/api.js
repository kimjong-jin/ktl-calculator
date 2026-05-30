/**
 * 서버 /api 엔드포인트 호출 래퍼 (vite.config.js 미들웨어).
 *
 * 계산·수수료·DB 상태는 모두 서버가 단일 출처(SSOT)로 담당하고,
 * 여기서는 fetch 와 에러 표준화만 한다. 모든 호출은 await 한다.
 */

/** 응답을 JSON 으로 파싱하되 실패 시 표준 에러로 변환한다. */
async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? '요청에 실패했습니다.');
  }
  return data;
}

/** 오차율 계산 (서버 calculator.js). */
export async function postCalculate({ parameter, measured, standard }) {
  const res = await fetch('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameter, measured, standard }),
  });
  return parseJson(res);
}

/** 특정 항목 수수료(원). 없으면 undefined. */
export async function getFee(code) {
  const res = await fetch(`/api/fee?item=${encodeURIComponent(code)}`);
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  return typeof data.fee === 'number' ? data.fee : undefined;
}

/** 엑셀 DB 연동 상태. 실패 시 { connected:false }. */
export async function getDbStatus() {
  try {
    const res = await fetch('/api/db/status');
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { connected: false };
  } catch {
    return { connected: false };
  }
}
