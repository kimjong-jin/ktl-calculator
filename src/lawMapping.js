// 측정항목 → 법령 매핑 + 정도검사기준 실시간 조회 (토큰 0원, 정규식 파싱)

const LAW_BASE = 'https://www.law.go.kr/DRF';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1일

function getOC() { return process.env.LAW_OC || 'kbisss_2026'; }

// 항목별 메타 테이블
export const ITEM_MAP = {
  TU: {
    name: '탁도(Turbidity)',
    unit: 'NTU',
    분야: '먹는물',
    기기명: '탁도 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '278905',        name: '먹는물 수질기준 및 검사 등에 관한 규칙',            기관: '기후에너지환경부' },
    ],
    섹션키워드: '탁도 연속자동측정기',
  },
  CL: {
    name: '잔류염소(Chlorine)',
    unit: 'mg/L',
    분야: '먹는물',
    기기명: '잔류염소 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '278905',        name: '먹는물 수질기준 및 검사 등에 관한 규칙',            기관: '기후에너지환경부' },
    ],
    섹션키워드: '잔류염소 연속자동측정기',
  },
  TOC: {
    name: '총유기탄소(TOC)',
    unit: 'mg/L',
    분야: '수질TMS',
    기기명: '총유기탄소 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '총유기탄소',
  },
  TN: {
    name: '총질소(TN)',
    unit: 'mg/L',
    분야: '수질TMS',
    기기명: '총질소 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '총질소',
  },
  TP: {
    name: '총인(TP)',
    unit: 'mg/L',
    분야: '수질TMS',
    기기명: '총인 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '총인',
  },
  SS: {
    name: '부유물질(SS)',
    unit: 'mg/L',
    분야: '수질TMS',
    기기명: '부유물질 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '부유물질',
  },
  COD: {
    name: '화학적산소요구량(COD)',
    unit: 'mg/L',
    분야: '수질TMS',
    기기명: '화학적산소요구량 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '화학적산소요구량',
  },
  DO: {
    name: '용존산소(DO)',
    unit: 'mg/L',
    분야: '수질TMS',
    기기명: '용존산소 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '용존산소',
  },
  PH: {
    name: '수소이온농도(pH)',
    unit: 'pH',
    분야: '수질TMS',
    기기명: 'pH 연속자동측정기',
    정도검사주기: '2년',
    법령: [
      { type: 'admrul', ref: '2100000269484', name: '환경측정기기의 형식승인·정도검사 등에 관한 고시',    기관: '국립환경과학원' },
      { type: 'law',    ref: '276829',        name: '환경분야 시험·검사 등에 관한 법률',                기관: '환경부' },
      { type: 'law',    ref: '284921',        name: '환경분야 시험·검사 등에 관한 법률 시행령',          기관: '환경부' },
      { type: 'law',    ref: '285097',        name: '환경분야 시험·검사 등에 관한 법률 시행규칙',        기관: '환경부' },
      { type: 'law',    ref: '283441',        name: '물환경보전법',                                    기관: '기후에너지환경부' },
    ],
    섹션키워드: '수소이온농도',
  },
};

// XML 캐시 — 같은 법령(고시)을 여러 항목이 공유하므로 ref 단위로 캐시
const _xmlCache = new Map();

async function fetchXmlCached(type, ref) {
  const key = `${type}_${ref}`;
  const hit = _xmlCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  const params = type === 'admrul'
    ? new URLSearchParams({ OC: getOC(), type: 'XML', target: 'admrul', ID: ref })
    : new URLSearchParams({ OC: getOC(), type: 'XML', target: 'law', MST: ref });

  const res = await fetch(`${LAW_BASE}/lawService.do?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`law.go.kr responded ${res.status}`);
  const data = await res.text();
  _xmlCache.set(key, { ts: Date.now(), data });
  return data;
}

function extractCdata(xml) {
  let out = '';
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out += m[1] + '\n';
  return out;
}

// 정도검사 기준 섹션("성능 확인" 포함)을 우선 선택, 없으면 첫 번째 매치 사용
function findSection(text, keyword, maxLen = 4000) {
  let start = 0;
  let first = -1;
  let withCheck = -1;

  while (withCheck === -1) {
    const idx = text.indexOf(keyword, start);
    if (idx === -1) break;
    if (first === -1) first = idx;
    if (/성능 확인/.test(text.slice(idx, idx + maxLen))) {
      withCheck = idx;
    }
    start = idx + 1;
  }

  const best = withCheck !== -1 ? withCheck : first;
  return best === -1 ? text.slice(0, maxLen) : text.slice(best, best + maxLen);
}

// 정도검사 기준값 정규식 추출 — 라인 단위로 파싱
function parseStandards(section) {
  const result = {};
  const lines = section.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/반복성/.test(line) && /%/.test(line)) {
      const m = line.match(/([\d.]+)\s*%/);
      if (m && !result.반복성) result.반복성 = `측정범위의 ${m[1]}% 이하`;
    }
    if (/직선성/.test(line) && /%/.test(line)) {
      const m = line.match(/±\s*([\d.]+)\s*%/);
      if (m && !result.직선성) result.직선성 = `주입농도값의 ±${m[1]}% 이하`;
    }
    if (/제로드리프트/.test(line) && /%/.test(line)) {
      const m = line.match(/([\d.]+)\s*%/);
      if (m && !result.제로드리프트) result.제로드리프트 = `측정범위의 ${m[1]}% 이하`;
    }
    if (/스팬드리프트/.test(line) && /%/.test(line)) {
      const m = line.match(/([\d.]+)\s*%/);
      if (m && !result.스팬드리프트) result.스팬드리프트 = `측정범위의 ${m[1]}% 이하`;
    }
    if (/응답시간/.test(line) && /분/.test(line)) {
      const m = line.match(/([\d.]+)\s*분/);
      if (m && !result.응답시간) result.응답시간 = `${m[1]}분(90%) 이하`;
    }
    // 현장적용계수
    if (/현장적용계수/.test(line) && /%/.test(line)) {
      const m = line.match(/([\d.]+)\s*%\s*이하/);
      if (m && !result.현장적용계수) result.현장적용계수 = `${m[1]}% 이하`;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function buildLinks(법령목록) {
  return 법령목록.map(l => ({
    법령명: l.name,
    소관기관: l.기관,
    링크: l.type === 'admrul'
      ? `https://www.law.go.kr/DRF/lawService.do?OC=${getOC()}&target=admrul&ID=${l.ref}&type=HTML`
      : `https://www.law.go.kr/DRF/lawService.do?OC=${getOC()}&target=law&MST=${l.ref}&type=HTML`,
  }));
}

export async function getLegalBasis(item) {
  const key = item.toUpperCase();
  const meta = ITEM_MAP[key];
  if (!meta) {
    throw new Error(`지원하지 않는 항목: ${item}. 지원 항목: ${Object.keys(ITEM_MAP).join(', ')}`);
  }

  const primaryLaw = meta.법령[0]; // 항상 고시(admrul)
  const xml = await fetchXmlCached(primaryLaw.type, primaryLaw.ref);
  const text = extractCdata(xml);
  const section = findSection(text, meta.섹션키워드);
  const standards = parseStandards(section);

  return {
    항목코드: key,
    항목명: meta.name,
    단위: meta.unit,
    분야: meta.분야,
    기기명: meta.기기명,
    정도검사주기: meta.정도검사주기,
    정도검사기준: standards,
    법령근거: buildLinks(meta.법령),
    조회일시: new Date().toISOString().slice(0, 10),
    출처: '국가법령정보센터 (law.go.kr)',
  };
}

export const supportedItems = () => Object.keys(ITEM_MAP);
