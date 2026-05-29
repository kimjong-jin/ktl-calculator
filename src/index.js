#!/usr/bin/env node
/**
 * KTL 정도검사 계산기 MCP 서버 (stdio).
 *
 * 도구 4종
 *  1. list_test_items   - 검사 항목 및 수수료 목록
 *  2. get_test_fee      - 특정 항목 수수료 조회
 *  3. get_sheet_data    - data.xlsx 시트 원본 데이터 조회
 *  4. calculate_accuracy - 오차율 계산 및 합격 판정
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
      'data.xlsx의 특정 시트 원본 데이터를 2차원 배열로 반환합니다. ' +
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
