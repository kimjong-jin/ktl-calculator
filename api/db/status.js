import { listTestItems, getSheetNames, getDataFileName } from '../../src/excelClient.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const _d = dirname(fileURLToPath(import.meta.url));
const _cwd = process.cwd();

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
    const msg = e instanceof Error ? e.message : String(e);
    const dbg = {
      connected: false, _debug: msg, _dir: _d, _cwd,
      p1: existsSync(join(_cwd, 'Version11_(2026).xlsx')),
      p2: existsSync(join(_d, '../../Version11_(2026).xlsx')),
      p3: existsSync(join(_d, '../../../Version11_(2026).xlsx')),
    };
    return res.status(503).json(dbg);
  }
}
