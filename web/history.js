/**
 * 계산 이력 저장소 — localStorage 영속(이 브라우저에만 보관).
 *
 * 서버에는 저장하지 않는다(단일 페이지 계산기 스코프 + 12-Factor stateless).
 * 최대 200건까지만 보관하고 초과 시 오래된 항목을 버린다.
 */

const KEY = 'ktl-calc-history';
const MAX = 200;

/** 저장된 이력을 읽는다 (최신순). 파싱 실패 시 빈 배열. */
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('[ktl-calculator-web] 이력 로드 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** 이력 배열을 저장한다. */
function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.error('[ktl-calculator-web] 이력 저장 실패:', e instanceof Error ? e.message : e);
  }
}

/** 새 항목을 최신순(맨 앞)으로 추가하고 갱신된 이력을 반환한다. */
export function add(entry) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
  const next = [{ id, ...entry }, ...load()].slice(0, MAX);
  save(next);
  return next;
}

/** id 로 한 건 삭제하고 갱신된 이력을 반환한다. */
export function removeById(id) {
  const next = load().filter((e) => e.id !== id);
  save(next);
  return next;
}

/** 전체 이력을 비운다. */
export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.error('[ktl-calculator-web] 이력 삭제 실패:', e instanceof Error ? e.message : e);
  }
  return [];
}

/** 적합/부적합/비대상 건수 요약. */
export function summary(list) {
  return list.reduce(
    (acc, e) => {
      if (e.judgment === '적합') acc.pass++;
      else if (e.judgment === '부적합') acc.fail++;
      else acc.neutral++;
      return acc;
    },
    { pass: 0, fail: 0, neutral: 0 },
  );
}
