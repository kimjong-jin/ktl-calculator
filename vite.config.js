/**
 * Vite 설정 + KTL 정도검사 계산기 API 미들웨어.
 *
 * 프런트엔드(web/)는 vanilla JS로 동작하고, 서버사이드 전용인
 * excelClient.js(Version11_(2026).xlsx를 node:fs로 읽음)와 순수 함수 calculator.js를
 * Vite dev/preview 서버에 미들웨어로 직접 import 하여 /api 로 노출한다.
 *
 *   GET  /api/items                  - 검사 항목 + 수수료 목록
 *   GET  /api/fee?item=TOC           - 특정 항목 수수료 조회
 *   POST /api/calculate              - 오차율 계산 및 합격 판정
 *   GET  /api/db/status              - 엑셀 DB 연동 상태(파일명·시트수·항목수·항목)
 *   GET  /api/claydox/targets?param= - Claydox target→셀 매핑 (생략 시 파라미터 목록)
 *   POST /api/claydox/payload        - Claydox phpEXCEL 전송 페이로드 생성
 *
 * MCP 서버(src/index.js)와 동일한 로직 모듈을 공유하되 그 파일은 건드리지 않는다.
 */

import { defineConfig } from 'vite';
import { calculateAccuracy, supportedParameters } from './src/calculator.js';
import {
  listTestItems,
  getTestFee,
  getSheetNames,
  getDataFileName,
} from './src/excelClient.js';
import {
  CLAYDOX_PARAMS,
  getClaydoxTargets,
  buildClaydoxPayload,
} from './src/claydoxMappings.js';
import { verifyAccess, verifyToken } from './src/authService.js';

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
    // 인증 엔드포인트
    if (url.pathname === '/api/auth') {
      if (req.method === 'GET') {
        const token = url.searchParams.get('token') ?? '';
        return sendJson(res, 200, verifyToken(String(token)));
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        // verifyAccess(password, now, id) — Vercel api/auth.js 와 동일 시그니처
        const result = verifyAccess(String(body.password ?? ''), Date.now(), String(body.id ?? ''));
        if (!result.ok) return sendJson(res, result.code || 401, { error: result.error });
        // role 포함 (Vercel 프로덕션과 동일)
        return sendJson(res, 200, { token: result.token, exp: result.exp, role: result.role });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/items') {
      // excelClient의 파싱 부산물(숫자 라벨)은 걸러 실제 항목만 노출한다.
      const items = listTestItems().filter((i) => /[A-Za-z]/.test(i.item));
      return sendJson(res, 200, { items });
    }

    if (req.method === 'GET' && url.pathname === '/api/db/status') {
      // 엑셀 DB 연동 상태. 파일명(베이스네임)·시트수·항목수만 노출하고
      // 절대경로/process.env/내부 스택은 절대 노출하지 않는다.
      try {
        const items = listTestItems().filter((i) => /[A-Za-z]/.test(i.item));
        return sendJson(res, 200, {
          connected: true,
          fileName: getDataFileName(),
          sheetCount: getSheetNames().length,
          itemCount: items.length,
          items,
        });
      } catch (e) {
        console.error('[ktl-calculator-web] DB 연동 확인 실패:', e instanceof Error ? e.message : e);
        return sendJson(res, 503, { connected: false });
      }
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

    if (req.method === 'GET' && url.pathname === '/api/claydox/targets') {
      const param = url.searchParams.get('param');
      if (!param) {
        return sendJson(res, 200, { parameters: CLAYDOX_PARAMS });
      }
      const targets = getClaydoxTargets(param);
      return sendJson(res, 200, { param, count: targets.length, targets });
    }

    if (req.method === 'POST' && url.pathname === '/api/claydox/payload') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, buildClaydoxPayload(body.param, body.values ?? {}));
    }

    // /api/lawSearch — law.go.kr DRF 프록시 (DEV 전용)
    // Vercel api/lawSearch.js 와 동일 로직으로 채팅 패널 법령 연결 상태가 정상 표시됨
    if (req.method === 'GET' && url.pathname === '/api/lawSearch') {
      const LAW_BASE = 'https://www.law.go.kr/DRF';
      const LAW_OC = process.env.LAW_OC || 'kbisss_2026';
      const query = url.searchParams.get('query') || url.searchParams.get('q') || '';
      const mst = url.searchParams.get('mst') || url.searchParams.get('MST') || '';
      const target = url.searchParams.get('target') || 'law';
      if (!query && !mst) return sendJson(res, 400, { error: 'query 또는 mst 파라미터가 필요합니다.' });
      try {
        const params = new URLSearchParams({ OC: LAW_OC, type: 'XML', target, ...(mst ? { MST: mst } : { query }) });
        const endpoint = mst ? 'lawService.do' : 'lawSearch.do';
        const upRes = await fetch(`${LAW_BASE}/${endpoint}?${params}`, { signal: AbortSignal.timeout(10_000) });
        const xml = await upRes.text();
        res.statusCode = upRes.status;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        return res.end(xml);
      } catch (e) {
        console.error('[ktl-calculator-web] lawSearch 오류:', e instanceof Error ? e.message : e);
        return sendJson(res, 502, { error: '법령 정보를 불러오지 못했습니다.' });
      }
    }

    // /api/calcData — Mac Studio 서버 프록시 (DEV 전용)
    // Vercel api/calcData.js 와 동일 로직으로 정도검사 데이터 저장/불러오기 연동
    if (url.pathname === '/api/calcData') {
      const STUDIO_BASE = (process.env.MAC_STUDIO_URL || process.env.LOCATION_SERVER_URL || '').replace(/\/$/, '');
      const STUDIO_SECRET = process.env.STUDIO_SECRET || '';
      const ADMIN_TOKEN = process.env.AUTH_SECRET || '';

      if (!STUDIO_BASE) {
        return sendJson(res, 503, { error: 'MAC_STUDIO_URL 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.' });
      }
      try {
        let upUrl;
        const fetchOpts = {
          method: req.method === 'DELETE' ? 'DELETE' : req.method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (req.method === 'GET') {
          const action = url.searchParams.get('action');
          const receiptNo = url.searchParams.get('receiptNo');
          const userName = url.searchParams.get('userName');
          if (action === 'list') {
            const token = url.searchParams.get('token') || '';
            if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return sendJson(res, 401, { error: '관리자 인증 필요' });
            upUrl = `${STUDIO_BASE}/api/calc/list`;
            fetchOpts.headers['x-studio-secret'] = STUDIO_SECRET;
          } else {
            if (!receiptNo || !userName) return sendJson(res, 400, { error: 'receiptNo, userName 필수' });
            upUrl = `${STUDIO_BASE}/api/calc?receiptNo=${encodeURIComponent(receiptNo)}&userName=${encodeURIComponent(userName)}`;
          }
        } else if (req.method === 'POST') {
          const body = await readJsonBody(req);
          if (!body.receiptNo || !body.userName) return sendJson(res, 400, { error: 'receiptNo, userName 필수' });
          upUrl = `${STUDIO_BASE}/api/calc`;
          fetchOpts.body = JSON.stringify(body);
        } else if (req.method === 'DELETE') {
          const receiptNo = url.searchParams.get('receiptNo');
          const userName = url.searchParams.get('userName');
          const token = url.searchParams.get('token') || '';
          if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return sendJson(res, 401, { error: '관리자 인증 필요' });
          if (!receiptNo) return sendJson(res, 400, { error: 'receiptNo 필수' });
          const qs = userName ? `?userName=${encodeURIComponent(userName)}` : '';
          upUrl = `${STUDIO_BASE}/api/calc/${encodeURIComponent(receiptNo)}${qs}`;
          fetchOpts.headers['x-studio-secret'] = STUDIO_SECRET;
        } else {
          return sendJson(res, 405, { error: 'Method Not Allowed' });
        }
        const upRes = await fetch(upUrl, { ...fetchOpts, signal: AbortSignal.timeout(8000) });
        const data = await upRes.json().catch(() => ({}));
        return sendJson(res, upRes.status, data);
      } catch (e) {
        console.error('[ktl-calculator-web] calcData 오류:', e instanceof Error ? e.message : e);
        return sendJson(res, 502, { error: `Mac Studio 연결 실패: ${e instanceof Error ? e.message : e}` });
      }
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
