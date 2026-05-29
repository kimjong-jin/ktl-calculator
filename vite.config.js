/**
 * Vite 설정 + KTL 정도검사 계산기 API 미들웨어.
 *
 * 프런트엔드(web/)는 vanilla JS로 동작하고, 서버사이드 전용인
 * excelClient.js(Version11_(2026).xlsx를 node:fs로 읽음)와 순수 함수 calculator.js를
 * Vite dev/preview 서버에 미들웨어로 직접 import 하여 /api 로 노출한다.
 *
 *   GET  /api/items          - 검사 항목 + 수수료 목록
 *   GET  /api/fee?item=TOC   - 특정 항목 수수료 조회
 *   POST /api/calculate      - 오차율 계산 및 합격 판정
 *
 * MCP 서버(src/index.js)와 동일한 로직 모듈을 공유하되 그 파일은 건드리지 않는다.
 */

import { defineConfig } from 'vite';
import { calculateAccuracy, supportedParameters } from './src/calculator.js';
import { listTestItems, getTestFee } from './src/excelClient.js';

/** 요청 본문(JSON)을 읽어 파싱한다. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('요청 본문이 너무 큽니다.'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON 본문을 파싱할 수 없습니다.'));
      }
    });
    req.on('error', reject);
  });
}

/** JSON 응답을 보낸다. */
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/** /api/* 요청을 처리하는 connect 미들웨어. */
async function handleApi(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return next();

  try {
    if (req.method === 'GET' && url.pathname === '/api/items') {
      // excelClient의 파싱 부산물(숫자 라벨)은 걸러 실제 항목만 노출한다.
      const items = listTestItems().filter((i) => /[A-Za-z]/.test(i.item));
      return sendJson(res, 200, { items });
    }

    if (req.method === 'GET' && url.pathname === '/api/fee') {
      const item = url.searchParams.get('item') ?? '';
      const fee = getTestFee(item);
      if (!fee) {
        return sendJson(res, 404, { error: `'${item}' 수수료 정보를 찾을 수 없습니다.` });
      }
      return sendJson(res, 200, fee);
    }

    if (req.method === 'POST' && url.pathname === '/api/calculate') {
      const body = await readJsonBody(req);
      const result = calculateAccuracy({
        parameter: body.parameter,
        measured: Number(body.measured),
        standard: Number(body.standard),
      });
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/parameters') {
      return sendJson(res, 200, { parameters: supportedParameters() });
    }

    return sendJson(res, 404, { error: '존재하지 않는 API 경로입니다.' });
  } catch (e) {
    // 내부 스택은 노출하지 않고 검증 메시지만 전달한다.
    const message = e instanceof Error ? e.message : '요청 처리에 실패했습니다.';
    console.error('[ktl-calculator-web] API 오류:', message);
    return sendJson(res, 400, { error: message });
  }
}

/** dev/preview 양쪽 서버에 API 미들웨어를 주입하는 플러그인. */
function ktlApiPlugin() {
  return {
    name: 'ktl-calculator-api',
    configureServer(server) {
      server.middlewares.use(handleApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleApi);
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [ktlApiPlugin()],
  server: {
    port: 3001,
    strictPort: true,
  },
  preview: {
    port: 3001,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
