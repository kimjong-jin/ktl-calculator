import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

export default function handler(req, res) {
  const files = ['Version11_(2026).xlsx', 'data.xlsx'];
  const result = {};
  for (const f of files) {
    const p = join(root, f);
    result[f] = { path: p, exists: existsSync(p) };
  }
  res.status(200).json({ root, files: result });
}
