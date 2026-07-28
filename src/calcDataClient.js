/**
 * calcDataClient — 계산데이터(:3333 Mac Studio SQLite `calc_data`) 삭제 헬퍼.
 * 토큰(Blob)과 계산데이터(SQLite)는 별개 저장소라, 접수번호 기준으로 함께 지우기 위해 사용.
 */

const BASE = (process.env.PHOTO_STORAGE_URL || process.env.MAC_STUDIO_URL || '').replace(/\/$/, '');
const STUDIO_SECRET = process.env.STUDIO_SECRET || '';

/** 접수번호의 계산데이터 삭제. 성공 여부 반환(실패해도 throw 안 함 — 토큰 삭제는 계속돼야). */
export async function deleteCalcData(receiptNo) {
  if (!BASE || !receiptNo) return false;
  try {
    const r = await fetch(`${BASE}/api/calc/${encodeURIComponent(receiptNo)}`, {
      method: 'DELETE',
      headers: { 'x-studio-secret': STUDIO_SECRET },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
