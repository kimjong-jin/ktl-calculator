import { listTestItems, getSheetNames, getDataFileName } from '../../src/excelClient.js';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
    const cwd = process.cwd();
    let cwdFiles = [];
    try { cwdFiles = readdirSync(cwd).filter(f => !f.startsWith('node_')).slice(0, 20); } catch {}
    return res.status(503).json({
      connected: false,
      _cwd: cwd,
      _cwdFiles: cwdFiles,
      _xlsxExists: existsSync(join(cwd, 'Version11_(2026).xlsx')),
      _err: e instanceof Error ? e.message : String(e),
    });
  }
}
