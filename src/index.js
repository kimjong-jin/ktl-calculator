#!/usr/bin/env node
/**
 * KTL 정도검사 계산기 MCP 서버 (stdio).
 *
 * 도구 8종
 *  1. list_test_items       - 검사 항목 및 수수료 목록
 *  2. get_test_fee          - 특정 항목 수수료 조회
 *  3. get_sheet_data        - 엑셀 DB(Version11) 시트 원본 데이터 조회
 *  4. calculate_accuracy    - 오차율 계산 및 합격 판정
 *  5. list_claydox_targets  - 파라미터별 Claydox target→셀 매핑 조회
 *  6. build_claydox_payload - Claydox phpEXCEL 전송 페이로드 생성
 *  7. search_laws           - 국가법령정보 법령명 검색
 *  8. get_law_content       - 법령 본문 조회 (MST)
 *  9. get_legal_basis       - 측정항목별 법령근거·정도검사기준 조회
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  getSheetNames,
  getSheetData,
  listTestItems,
  getTestFee,
} from './excelClient.js';
import { calculateAccuracy, supportedParameters } from './calculator.js';
import {
  CLAYDOX_PARAMS,
  getClaydoxTargets,
  buildClaydoxPayload,
} from './claydoxMappings.js';
import { getLegalBasis, supportedItems } from './lawMapping.js';

/** 객체를 MCP 텍스트 콘텐츠 결과로 감싼다. */
function jsonResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/** 에러를 MCP 오류 결과로 감싼다 (내부 스택은 노출하지 않는다). */
function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

const server = new McpServer({
  name: 'ktl-calculator-mcp',
  version: '1.0.0',
});

server.registerTool(
  'list_test_items',
  {
    title: '검사 항목 목록',
    description:
      'KTL 정도검사 항목과 각 항목의 수수료(원) 목록을 반환합니다.',
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult({ items: listTestItems() });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '항목 조회에 실패했습니다.');
    }
  },
);

server.registerTool(
  'get_test_fee',
  {
    title: '수수료 조회',
    description: '특정 검사 항목(TOC, TN, TP, SS, PH, COD, DO)의 수수료를 조회합니다.',
    inputSchema: {
      item: z.string().describe('검사 항목 코드 (예: TOC, TN, DO). 대소문자 무관.'),
    },
  },
  async ({ item }) => {
    try {
      const result = getTestFee(item);
      if (!result) {
        const available = listTestItems().map((i) => i.item).join(', ');
        return errorResult(`'${item}' 항목을 찾을 수 없습니다. 사용 가능: ${available}`);
      }
      return jsonResult(result);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '수수료 조회에 실패했습니다.');
    }
  },
);

server.registerTool(
  'get_sheet_data',
  {
    title: '시트 데이터 조회',
    description:
      '엑셀 DB의 특정 시트 원본 데이터를 2차원 배열로 반환합니다. ' +
      'sheetName 생략 시 사용 가능한 시트 이름 목록을 반환합니다.',
    inputSchema: {
      sheetName: z
        .string()
        .optional()
        .describe('시트 이름 (예: Sheet1). 생략하면 시트 목록 반환.'),
    },
  },
  async ({ sheetName }) => {
    try {
      if (!sheetName) {
        return jsonResult({ sheets: getSheetNames() });
      }
      return jsonResult(getSheetData(sheetName));
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '시트 조회에 실패했습니다.');
    }
  },
);

server.registerTool(
  'calculate_accuracy',
  {
    title: '오차율 계산',
    description:
      '오차율(=|측정값-표준값|/표준값×100)을 계산하고 합격 여부를 판정합니다. ' +
      '합격 기준: TOC/TN/TP/SS/COD ±10%, pH ±0.3, DO ±0.5.',
    inputSchema: {
      parameter: z
        .string()
        .describe(`파라미터 코드 (지원: ${supportedParameters().join(', ')})`),
      measured: z.number().describe('측정값'),
      standard: z.number().describe('표준값 (0이 될 수 없음)'),
    },
  },
  async ({ parameter, measured, standard }) => {
    try {
      return jsonResult(calculateAccuracy({ parameter, measured, standard }));
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '오차율 계산에 실패했습니다.');
    }
  },
);

server.registerTool(
  'list_claydox_targets',
  {
    title: 'Claydox 매핑 조회',
    description:
      '특정 파라미터의 Claydox target(논리명)→엑셀 셀/시트 매핑 목록을 반환합니다. ' +
      'param 생략 시 지원 파라미터 목록을 반환합니다.',
    inputSchema: {
      param: z
        .string()
        .optional()
        .describe(`파라미터 (지원: ${CLAYDOX_PARAMS.join(', ')}). 대소문자 무관. 생략 시 목록 반환.`),
    },
  },
  async ({ param }) => {
    try {
      if (!param) {
        return jsonResult({ parameters: CLAYDOX_PARAMS });
      }
      const targets = getClaydoxTargets(param);
      return jsonResult({ param, count: targets.length, targets });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : 'Claydox 매핑 조회에 실패했습니다.');
    }
  },
);

server.registerTool(
  'build_claydox_payload',
  {
    title: 'Claydox 페이로드 생성',
    description:
      'target→값 매핑(values)으로 Claydox phpEXCEL 전송 페이로드를 생성합니다. ' +
      '입력되지 않은 target은 빈 문자열로 채워집니다. ' +
      'target 목록은 list_claydox_targets로 확인하세요.',
    inputSchema: {
      param: z
        .string()
        .describe(`파라미터 (지원: ${CLAYDOX_PARAMS.join(', ')}). 대소문자 무관.`),
      values: z
        .record(z.string(), z.union([z.string(), z.number()]))
        .optional()
        .describe('target(논리명) → 값 매핑. 예: { "M1": 1.23, "Z1": 0 }'),
    },
  },
  async ({ param, values }) => {
    try {
      return jsonResult(buildClaydoxPayload(param, values ?? {}));
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : 'Claydox 페이로드 생성에 실패했습니다.');
    }
  },
);

server.registerTool(
  'get_legal_basis',
  {
    title: '측정항목 법령근거 조회',
    description:
      '측정항목 코드로 정도검사 법령근거와 기준값을 반환합니다. ' +
      '법령 본문을 실시간으로 조회해 정규식으로 파싱하므로 항상 최신 기준을 제공합니다. ' +
      '결과는 1일 캐시됩니다.',
    inputSchema: {
      item: z
        .string()
        .describe(`측정항목 코드 (지원: ${supportedItems().join(', ')}). 대소문자 무관.`),
    },
  },
  async ({ item }) => {
    try {
      return jsonResult(await getLegalBasis(item));
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '법령근거 조회에 실패했습니다.');
    }
  },
);

// ── 법령 검색 공통 ────────────────────────────────────────────────────────────

const LAW_BASE = 'https://www.law.go.kr/DRF';
const LAW_TIMEOUT_MS = 10_000;

function getLawOC() {
  return process.env.LAW_OC || 'kbisss_2026';
}

async function callLawApi(endpoint, params) {
  const search = new URLSearchParams({ OC: getLawOC(), type: 'XML', ...params });
  const url = `${LAW_BASE}/${endpoint}?${search.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(LAW_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`law.go.kr responded ${res.status}`);
  return await res.text();
}

server.registerTool(
  'search_laws',
  {
    title: '법령 검색',
    description:
      '국가법령정보센터(law.go.kr)에서 법령명을 검색합니다. ' +
      '검색 결과는 XML 문자열로 반환됩니다. ' +
      '특정 법령 본문이 필요하면 결과의 MST 값으로 get_law_content를 호출하세요.',
    inputSchema: {
      query: z.string().describe('검색할 법령명 (예: 대기환경보전법, 수질오염물질)'),
      target: z
        .enum(['law', 'admrul', 'ordin', 'trty'])
        .optional()
        .describe('검색 대상: law=법령(기본), admrul=행정규칙, ordin=자치법규, trty=조약'),
    },
  },
  async ({ query, target = 'law' }) => {
    try {
      const xml = await callLawApi('lawSearch.do', { target, query });
      return { content: [{ type: 'text', text: xml }] };
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '법령 검색에 실패했습니다.');
    }
  },
);

server.registerTool(
  'get_law_content',
  {
    title: '법령 본문 조회',
    description:
      '법령 고유번호(MST)로 법령 본문 전체를 XML로 반환합니다. ' +
      'MST는 search_laws 결과에서 확인할 수 있습니다.',
    inputSchema: {
      mst: z.string().describe('법령 고유번호 MST (예: 267581)'),
      target: z
        .enum(['law', 'admrul', 'ordin', 'trty'])
        .optional()
        .describe('대상 유형: law=법령(기본), admrul=행정규칙, ordin=자치법규, trty=조약'),
    },
  },
  async ({ mst, target = 'law' }) => {
    try {
      const xml = await callLawApi('lawService.do', { target, MST: mst });
      return { content: [{ type: 'text', text: xml }] };
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '법령 본문 조회에 실패했습니다.');
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio MCP 서버는 stdout을 프로토콜 전용으로 쓰므로 로그는 stderr로 출력한다.
  console.error('[ktl-calculator-mcp] 서버가 stdio로 시작되었습니다.');
}

main().catch((e) => {
  console.error('[ktl-calculator-mcp] 시작 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
