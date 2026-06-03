import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

function ls(dir) {
  try { return readdirSync(dir).filter(f => !f.startsWith('node_modules')).slice(0, 30); }
  catch { return []; }
}

export default function handler(req, res) {
  res.status(200).json({
    __dir,
    root,
    rootFiles: ls(root),
    apiFiles: ls(__dir),
    xlsxExists: existsSync(join(root, 'Version11_(2026).xlsx')),
  });
}
