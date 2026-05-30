/**
 * Claydox 전송 데이터 — 정적 JSON 매핑 로드 + phpEXCEL 페이로드 생성 (클라이언트).
 *
 * 정적 배포(Vercel)에는 /api(vite 미들웨어)가 없으므로, 서버 호출 대신
 * web/claydox-mappings.json(SSOT인 src/claydoxMappings.js 기준 자동 생성)을 fetch 한다.
 * 페이로드 형식은 서버 buildClaydoxPayload 와 동일하게 맞춘다.
 */

let cache;

/** 매핑 JSON 을 한 번만 fetch 해 캐시한다. 실패 시 throw. */
export async function loadClaydoxMappings() {
  if (cache) return cache;
  const res = await fetch('./claydox-mappings.json', {
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error('Claydox 매핑 데이터를 불러올 수 없습니다.');
  cache = await res.json();
  return cache;
}

/** 표시 코드(대문자) → 원본 파라미터 키. 예: "PH"→"pH", "CL"→"Cl". 없으면 undefined. */
function resolveParam(mappings, code) {
  const upper = String(code).trim().toUpperCase();
  return mappings.params.find((p) => p.toUpperCase() === upper);
}

/** 특정 항목의 target 매핑 목록(원본 순서). 미지원이면 빈 배열. */
export function targetsFor(mappings, code) {
  const key = resolveParam(mappings, code);
  return key ? mappings.mappings[key] : [];
}

/**
 * 항목별 "입력칸" 목록을 반환한다 — 동일 target 이 여러 셀/시트에 미러링되는 경우
 * 입력은 1개만 받는다(값은 페이로드에서 모든 셀로 복제). 원본 등장 순서를 보존한다.
 * @returns {Array<{target:string, cell:string, sheet:string}>}
 */
export function inputTargets(mappings, code) {
  const seen = new Set();
  return targetsFor(mappings, code).filter((t) => {
    if (seen.has(t.target)) return false;
    seen.add(t.target);
    return true;
  });
}

/**
 * target→값(values)으로 Claydox phpEXCEL 전송 페이로드를 만든다.
 * 서버 buildClaydoxPayload 와 동일 형식. 입력되지 않은 target 은 빈 문자열.
 * @returns {{phpEXCEL:{FILE_UID:string,INPUT_DATA:Array<object>}}}
 */
export function buildPayload(mappings, code, values) {
  const key = resolveParam(mappings, code);
  if (!key) throw new Error(`Claydox 미지원 항목: ${code}`);
  const INPUT_DATA = mappings.mappings[key].map((m) => ({
    target: m.target,
    cellName: m.cell,
    sheetName: m.sheet,
    targetType: 'multi_text',
    value: String(values?.[m.target] ?? ''),
  }));
  return { phpEXCEL: { FILE_UID: 'excel', INPUT_DATA } };
}
