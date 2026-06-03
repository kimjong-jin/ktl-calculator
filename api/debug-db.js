import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import XLSX from 'xlsx';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');
const xlsxPath = join(root, 'Version11_(2026).xlsx');

export default function handler(req, res) {
  const info = { path: xlsxPath, exists: existsSync(xlsxPath) };
  try {
    const buf = readFileSync(xlsxPath);
    info.size = buf.length;
    const wb = XLSX.read(buf, { type: 'buffer' });
    info.sheets = wb.SheetNames;
    info.ok = true;
  } catch (e) {
    info.error = e instanceof Error ? e.message : String(e);
    info.ok = false;
  }
  res.status(200).json(info);
}
