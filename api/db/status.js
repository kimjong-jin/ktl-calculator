import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listTestItems, getSheetNames, getDataFileName } from '../../src/excelClient.js';

// DB 파일 유효성 사전 확인 (번들러가 node:fs/path를 tree-shake 하지 않도록 실제 사용)
const _dbOk = existsSync(join(process.cwd(), 'Version11_(2026).xlsx'))
  || existsSync(join(process.cwd(), 'data.xlsx'));

export default function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 허용' });

  try {
    const items = listTestItems().filter(i => /[A-Za-z]/.test(i.item));
    return res.status(200).json({
      connected: true,
      fileName: getDataFileName(),
      sheetCount: getSheetNames().length,
      itemCount: items.length,
      items,
    });
  } catch (e) {
    console.error('[db/status]', e instanceof Error ? e.message : e);
    return res.status(503).json({ connected: false, _dbOk });
  }
}
