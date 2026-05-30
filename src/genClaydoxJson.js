#!/usr/bin/env node
/**
 * web/claydox-mappings.json 생성기.
 *
 * 단일 출처(SSOT)인 src/claydoxMappings.js(엑셀 Version11_(2026).xlsx 기준
 * target→셀 매핑)를 정적 JSON 으로 추출한다.
 *
 * 정적 배포(Vercel)에서는 /api(vite 미들웨어)가 존재하지 않으므로, 웹은 이 JSON 을
 * 직접 fetch 하여 Claydox phpEXCEL 페이로드를 클라이언트에서 생성한다.
 *
 *   node src/genClaydoxJson.js   (또는 npm run gen:claydox)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CLAYDOX_MAPPINGS, CLAYDOX_PARAMS } from './claydoxMappings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// vite 의 publicDir(web/public) → 빌드 시 dist 루트로 복사되고, dev 에서도 루트로 서빙된다.
const OUT_DIR = join(__dirname, '..', 'web', 'public');
const OUT = join(OUT_DIR, 'claydox-mappings.json');

const data = {
  source: 'Version11_(2026).xlsx',
  note: '자동 생성 — src/claydoxMappings.js 가 단일 출처. 직접 편집 금지 (npm run gen:claydox 로 재생성).',
  params: CLAYDOX_PARAMS,
  mappings: CLAYDOX_MAPPINGS,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.error(
  `[gen:claydox] ${OUT} 생성 완료 (파라미터 ${CLAYDOX_PARAMS.length}종).`,
);
