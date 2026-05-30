import { listTestItems, getSheetNames, getDataFileName } from '../../src/excelClient.js';

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
    return res.status(503).json({ connected: false });
  }
}
